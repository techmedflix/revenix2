export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'
import { buildCashflowProjection, remainingPipelineValue } from '@/lib/finance'
import {
  effectiveProbability,
  weightedPipelineValue,
  weightedPipelineContribution,
} from '@/lib/opportunityStages'
import { findAncestorByType } from '@/lib/accounts'
import { getFY } from '@/lib/utils'

// Opportunities no longer store FY directly — it's derived from Expected Kick-off Date
// (falling back to createdAt for opportunities without one set).
function oppFY(o: { expectedKickoff: Date | null; createdAt: Date }): string {
  return getFY(o.expectedKickoff ?? o.createdAt)
}

function monthLabel(d: Date) {
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

function getFYStart(fy: string): Date | null {
  // "FY 25-26" → April 2025
  const m = fy.match(/FY (\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(2000 + parseInt(m[1]), 3, 1) // April 1
}

function getFYEnd(fy: string): Date | null {
  const m = fy.match(/FY (\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(2000 + parseInt(m[2]), 2, 31, 23, 59, 59) // March 31
}

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const scenario = Number(searchParams.get('scenario') || '0')
  const delayDays = [0, 30, 60].includes(scenario) ? scenario : 0
  const entityFilter = searchParams.get('entity') || ''
  const fyFilter = searchParams.get('fy') || ''

  const [allOpportunitiesRaw, revenueInvoices, allInvoices, accounts, vendorInvoices, settings] = await Promise.all([
    // All opps (no FY filter) for pipeline-by-stage chart and receivables
    prisma.opportunity.findMany({
      include: {
        account: true,
        activities: { select: { activityType: true, createdAt: true } },
      },
    }),
    // FY/entity-filtered invoices for revenue KPIs
    prisma.invoice.findMany({
      where: {
        entity: entityFilter ? (entityFilter as any) : undefined,
        fy: fyFilter || undefined,
      },
    }),
    // All invoices (no FY filter) for receivables/TDS/cashflow/payout cycle
    prisma.invoice.findMany({
      where: { entity: entityFilter ? (entityFilter as any) : undefined },
      include: { account: { select: { id: true, name: true, parentId: true, type: true } } },
    }),
    prisma.account.findMany(),
    prisma.vendorInvoice.findMany(),
    prisma.systemSetting.findFirst(),
  ])

  const accountMap = new Map(accounts.map((a) => [a.id, a]))

  // FY is derived from Expected Kick-off Date, not stored — filter in-memory.
  const allOpportunities = allOpportunitiesRaw
  const opportunities = fyFilter ? allOpportunities.filter((o) => oppFY(o) === fyFilter) : allOpportunities

  // Remaining, un-invoiced pipeline value for a won opportunity — fully invoiced deals
  // contribute nothing to pipeline; partially invoiced deals contribute only what's left.
  function wonRemainingValue(o: { leadStage: string | null; estimatedValue: number; invoicedAmount: number | null }) {
    if (o.leadStage === 'invoiced') return 0
    return remainingPipelineValue(o.estimatedValue, o.invoicedAmount ?? 0)
  }

  // === KPI METRICS (FY-filtered opportunities) ===
  // Buckets mirror the Order Book: "Won" = Commissioned + Partially Invoiced (by stage),
  // "Active" = Hot + Warm + Cold (by lead type).
  const isCommissioned = (o: { leadStage: string | null }) =>
    o.leadStage === 'commissioned' || o.leadStage === 'partial_invoiced'
  const isActiveType = (o: { leadType: string | null }) =>
    o.leadType === 'hot' || o.leadType === 'warm' || o.leadType === 'cold'

  const openOpps = opportunities.filter((o) => o.leadType !== 'won' && o.leadType !== 'lost')
  const wonOpps  = opportunities.filter(isCommissioned)
  const activeOpps = opportunities.filter(isActiveType)
  const hotOpps  = opportunities.filter((o) => o.leadType === 'hot')
  // Raw hot-deal contribution — the runway formula does its own discounting via the
  // 0.25 factor below, so it takes actual margins, not probability-weighted ones.
  const hotContribution = hotOpps.reduce((sum, o) => sum + (o.estimatedValue - o.estimatedCost), 0)

  // Probability-weighted remaining value / contribution — the SAME maths the Order Book
  // uses for its pills and Revenue/Contribution strip (shared in opportunityStages), so
  // "Won" and "Active" land on identical numbers on both screens.
  const activePipeline = activeOpps.reduce((sum, o) => sum + weightedPipelineValue(o), 0)
  const activeContribution = activeOpps.reduce((sum, o) => sum + weightedPipelineContribution(o), 0)

  const totalPipeline  = openOpps.reduce((sum, o) => sum + o.estimatedValue, 0)
  const weightedPipeline = openOpps.reduce((sum, o) => sum + weightedPipelineValue(o), 0)
  const wonPipeline    = wonOpps.reduce((sum, o) => sum + weightedPipelineValue(o), 0)
  const wonContribution = wonOpps.reduce((sum, o) => sum + weightedPipelineContribution(o), 0)
  const invoicedPipeline = wonPipeline
  const invoicedContribution = wonContribution
  const weightedContribution = openOpps.reduce((sum, o) => sum + weightedPipelineContribution(o), 0)
  // Raw (un-weighted) contribution of commissioned deals — used by the "signed" figure
  // and the runway formula, which applies its own 0.9 factor rather than double-discounting.
  const wonContributionRaw = wonOpps.reduce((sum, o) => sum + (o.estimatedValue - o.estimatedCost), 0)

  // Revenue = gross of sent + paid invoices (FY-filtered, excl. cancelled/CN/draft)
  const totalRevenue = revenueInvoices
    .filter((i) => ['sent', 'paid', 'partial', 'overdue', 'gst_pending'].includes(i.status))
    .reduce((sum, i) => sum + i.gross, 0)

  // Receivables = gross (pre-GST) of all unpaid invoices; GST is tracked separately
  const receivables = allInvoices
    .filter((i) => !['paid', 'draft', 'cancelled', 'credit_note'].includes(i.status))
    .reduce((sum, i) => {
      if (i.gross <= 0) return sum
      return sum + Math.max(0, i.gross - i.amountReceived - (i.tdsAmount || 0))
    }, 0)

  const tdsDeducted = allInvoices.reduce((sum, i) => sum + (i.tdsAmount || 0), 0)

  // Signed revenue/contribution = commercial value of all won deals (estimatedValue is kept in
  // sync with closedValue once a deal is won, so this reflects what was actually signed).
  const signedRevenue = wonOpps.reduce((sum, o) => sum + o.estimatedValue, 0)
  const signedContribution = wonContributionRaw

  const monthlyOpex = settings?.monthlyOpex || 3500000
  const cashInBank = settings?.cashInBank || 0
  // Runway = (Receivables + 90% of WON contribution + 25% of Hot contribution) / monthly OPEX.
  // The 0.9 / 0.25 factors are the discount — feed them actual margins, not weighted ones.
  const runwayValue = receivables + wonContributionRaw * 0.9 + hotContribution * 0.25
  const runwayMonths = monthlyOpex ? runwayValue / monthlyOpex : 0

  // === SALES FUNNEL (FY-filtered) ===
  const funnelSummary = (opps: typeof opportunities) => ({
    count: opps.length,
    value: opps.reduce((s, o) => s + o.estimatedValue, 0),
    contribution: opps.reduce((s, o) => s + (o.estimatedValue - o.estimatedCost), 0),
  })

  const proposalOpps = opportunities.filter((o) =>
    o.activities.some((a) => a.activityType === 'proposal_sent')
  )

  const salesFunnel = {
    newLeads: funnelSummary(opportunities),
    proposalsSent: funnelSummary(proposalOpps),
    projectsApproved: funnelSummary(wonOpps),
  }

  // === NEW LEADS BAR CHART
  // When FY filter set: show months of that FY. Otherwise show last 6 months.
  const now = new Date()
  const fyStart = fyFilter ? getFYStart(fyFilter) : null
  const fyEnd = fyFilter ? getFYEnd(fyFilter) : null
  const newLeadsMonthly: Array<{ month: string; count: number; value: number }> = []
  if (fyStart && fyEnd) {
    // Show all months of the selected FY (Apr–Mar = 12 months)
    for (let i = 0; i < 12; i++) {
      const m = new Date(fyStart.getFullYear(), fyStart.getMonth() + i, 1)
      if (m > fyEnd) break
      const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59)
      const oppsInMonth = allOpportunities.filter(
        (o) => oppFY(o) === fyFilter && o.createdAt >= m && o.createdAt <= mEnd
      )
      newLeadsMonthly.push({
        month: monthLabel(m),
        count: oppsInMonth.length,
        value: oppsInMonth.reduce((s, o) => s + o.estimatedValue, 0),
      })
    }
  } else {
    // Last 6 months
    for (let i = 0; i < 6; i++) {
      const m = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59)
      const oppsInMonth = allOpportunities.filter(
        (o) => o.createdAt >= m && o.createdAt <= mEnd
      )
      newLeadsMonthly.push({
        month: monthLabel(m),
        count: oppsInMonth.length,
        value: oppsInMonth.reduce((s, o) => s + o.estimatedValue, 0),
      })
    }
  }

  // === AVERAGE PAYOUT CYCLE by client
  // Formula: Sum(receivedDate - invoiceDate) / count  — only invoices with actual receivedDate
  const payoutInvoices = fyFilter
    ? allInvoices.filter((i) => i.status === 'paid' && i.fy === fyFilter)
    : allInvoices.filter((i) => i.status === 'paid')
  const payoutByClient = new Map<string, { totalDays: number; count: number }>()
  for (const inv of payoutInvoices) {
    const refDate = inv.receivedDate
    if (!refDate) continue
    const days = Math.round((refDate.getTime() - inv.date.getTime()) / 86400000)
    if (days < 0 || days > 1000) continue
    let clientKey: string | null = null
    if (inv.accountId) {
      const company = findAncestorByType(inv.accountId, accountMap, 'company')
      clientKey = company?.name || null
    }
    if (!clientKey) clientKey = inv.company?.trim() || inv.clientName?.trim() || 'Unknown'
    const prev = payoutByClient.get(clientKey) || { totalDays: 0, count: 0 }
    prev.totalDays += days
    prev.count += 1
    payoutByClient.set(clientKey, prev)
  }
  const avgPayoutByClient = Array.from(payoutByClient.entries())
    .map(([label, v]) => ({ label, avgDays: Math.round(v.totalDays / v.count), count: v.count }))
    .filter((r) => r.count >= 1)
    .sort((a, b) => b.avgDays - a.avgDays)
    .slice(0, 20)

  // === PIPELINE BY STAGE (all opps for chart) ===
  const pipelineMap = new Map<string, { count: number; value: number }>()
  for (const o of allOpportunities) {
    if (!o.leadType || o.leadType === 'lost') continue
    const key = o.leadType
    const prev = pipelineMap.get(key) || { count: 0, value: 0 }
    prev.count += 1
    prev.value += o.estimatedValue * (effectiveProbability(o) / 100)
    pipelineMap.set(key, prev)
  }
  const pipelineByStage = Array.from(pipelineMap.entries())
    .map(([stage, v]) => ({ stage, count: v.count, value: v.value }))

  // === REVENUE CHARTS (FY-filtered invoices for entity split) ===
  const revenueByDivisionMap = new Map<string, number>()
  const revenueByEntityMap = new Map<string, number>()

  for (const inv of revenueInvoices.filter((i) => !['cancelled', 'credit_note'].includes(i.status))) {
    revenueByEntityMap.set(inv.entity, (revenueByEntityMap.get(inv.entity) || 0) + inv.amt)
    if (!inv.accountId) continue
    const division = findAncestorByType(inv.accountId, accountMap, 'division') || findAncestorByType(inv.accountId, accountMap, 'cluster')
    if (division) revenueByDivisionMap.set(division.name, (revenueByDivisionMap.get(division.name) || 0) + inv.amt)
  }

  // Top Clients + Offerings: FY-filtered when fyFilter set, else all invoices.
  // allInvoices is already entity-filtered; apply FY gate here if needed.
  const topClientMap = new Map<string, number>()
  const topOfferingMap = new Map<string, number>()
  const chartsInvoices = allInvoices.filter((i) => {
    if (['cancelled', 'credit_note', 'draft'].includes(i.status)) return false
    if (fyFilter && i.fy !== fyFilter) return false
    return true
  })

  for (const inv of chartsInvoices) {
    let clientLabel: string | null = null
    if (inv.accountId) {
      const company = findAncestorByType(inv.accountId, accountMap, 'company')
      clientLabel = company?.name || null
    }
    if (!clientLabel) clientLabel = inv.company?.trim() || inv.clientName?.trim() || null
    if (clientLabel) topClientMap.set(clientLabel, (topClientMap.get(clientLabel) || 0) + inv.gross)

    const offeringKey = inv.offeringName?.trim() || null
    if (offeringKey) topOfferingMap.set(offeringKey, (topOfferingMap.get(offeringKey) || 0) + inv.gross)
  }

  const revenueByDivision = Array.from(revenueByDivisionMap.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12)
  const revenueByEntity = Array.from(revenueByEntityMap.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  const topClients = Array.from(topClientMap.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  const topOfferings = Array.from(topOfferingMap.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8)

  // === PENDING INVOICE AGING TABLES ===
  const todayMidnight = new Date()
  todayMidnight.setHours(0, 0, 0, 0)

  const agingInvoices = allInvoices
    .filter((i) => {
      if (['paid', 'draft', 'cancelled', 'credit_note'].includes(i.status)) return false
      return Math.max(0, i.amt - i.amountReceived) > 0
    })
    .map((i) => {
      const invoiceDate = new Date(i.date)
      invoiceDate.setHours(0, 0, 0, 0)
      const ageDays = Math.floor((todayMidnight.getTime() - invoiceDate.getTime()) / 86400000)
      const outstanding = Math.max(0, i.amt - i.amountReceived)
      // Client is always the top-level company — roll divisions/clusters/brands up to it,
      // same as the Top Clients and payout-cycle charts. Keep the sub-account name (if any)
      // for display in brackets.
      const company = i.accountId ? findAncestorByType(i.accountId, accountMap, 'company') : null
      const clientName = company?.name || i.account?.name || i.company?.trim() || i.clientName?.trim() || 'Unknown'
      const subName = i.account?.name && i.account.name !== clientName ? i.account.name : null
      const description = i.desc?.trim() || i.offeringName?.trim() || null
      return {
        id: i.id, invNo: i.invNo, description, date: i.date, dueDate: i.dueDate,
        clientName, division: subName, gross: i.gross, net: i.net, amt: i.amt,
        amountReceived: i.amountReceived, outstanding, ageDays,
        status: i.status, entity: i.entity,
      }
    })

  const sortAging = (arr: typeof agingInvoices) =>
    [...arr].sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime()
      if (dateDiff !== 0) return dateDiff
      return b.outstanding - a.outstanding
    })

  const pendingInvoices30to44 = sortAging(agingInvoices.filter((i) => i.ageDays >= 30 && i.ageDays < 45))
  const pendingInvoices45plus = sortAging(agingInvoices.filter((i) => i.ageDays >= 45))

  // === ACTIVITY STATS (FY-filtered opportunities) ===
  const fyActivities = opportunities.flatMap((o) => o.activities)
  const activityStats = {
    totalLeads: opportunities.length,
    newLeads: opportunities.filter((o) => !o.clientType || o.clientType === 'new').length,
    calls: fyActivities.filter((a) => a.activityType === 'call_attempted' || a.activityType === 'call_connected').length,
    meetings: fyActivities.filter((a) => a.activityType === 'meeting_done').length,
    // Count proposal_sent activity records (consistent with monthly table)
    proposals: fyActivities.filter((a) => a.activityType === 'proposal_sent').length,
    proposalsValue: proposalOpps.reduce((s, o) => s + o.estimatedValue, 0),
    commissionedCount: wonOpps.length,
    commissionedValue: wonPipeline,
  }

  // Monthly pipeline by stage — last 6 months (all data, no FY filter).
  //   Commissioned : value of deals commissioned that month (by the po_received activity)
  //   Invoiced     : total invoice value (amt) raised that month, from the invoicing table
  //   Hot/Warm/Cold/Lost : contract value of leads created that month now sitting in that type
  const pipelineByStageMonthly: Array<{
    month: string
    commissioned: number
    invoiced: number
    hot: number
    warm: number
    cold: number
    lost: number
  }> = []
  for (let i = 0; i < 6; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
    const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59)

    let commissioned = 0
    for (const opp of allOpportunities) {
      for (const act of opp.activities) {
        if (act.activityType === 'po_received' && act.createdAt >= m && act.createdAt <= mEnd) {
          commissioned += wonRemainingValue(opp)
        }
      }
    }

    let hot = 0, warm = 0, cold = 0, lost = 0
    for (const opp of allOpportunities) {
      if (opp.createdAt < m || opp.createdAt > mEnd) continue
      if (opp.leadType === 'hot') hot += opp.estimatedValue
      else if (opp.leadType === 'warm') warm += opp.estimatedValue
      else if (opp.leadType === 'cold') cold += opp.estimatedValue
      else if (opp.leadType === 'lost') lost += opp.estimatedValue
    }

    const invoiced = allInvoices
      .filter((inv) => {
        if (['cancelled', 'credit_note', 'draft'].includes(inv.status)) return false
        const d = new Date(inv.date)
        return d >= m && d <= mEnd
      })
      .reduce((sum, inv) => sum + inv.amt, 0)

    pipelineByStageMonthly.push({ month: monthLabel(m), commissioned, invoiced, hot, warm, cold, lost })
  }

  // === CASHFLOW (all invoices) ===
  const inflows = allInvoices
    .filter((i) => !['cancelled', 'credit_note'].includes(i.status) && Math.max(0, i.amt - i.amountReceived) > 0)
    .map((i) => ({ amount: Math.max(0, i.amt - i.amountReceived), date: i.expectedPaymentDate || i.dueDate || i.date }))

  const outflows = vendorInvoices.map((v) => ({ amount: v.amount, date: v.paymentDueDate || v.invoiceDate }))

  const cashflow = buildCashflowProjection({ openingBalance: cashInBank, monthlyOpex, delayDays, months: 6, inflows, outflows })

  return NextResponse.json({
    scenario: delayDays,
    kpis: {
      totalRevenue, totalPipeline, weightedPipeline,
      wonPipeline, wonContribution, invoicedPipeline, invoicedContribution,
      activePipeline, activeContribution,
      signedRevenue, receivables, cashInBank, runwayMonths,
      contribution: signedContribution, weightedContribution, tdsDeducted,
    },
    salesFunnel,
    charts: {
      pipelineByStage, revenueByDivision, revenueByEntity,
      topClients, topOfferings,
      cashflow, newLeadsMonthly, avgPayoutByClient,
    },
    pendingInvoices30to44,
    pendingInvoices45plus,
    activityStats,
    pipelineByStageMonthly,
    settings: { monthlyOpex, cashInBank },
  })
}
