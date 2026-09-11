export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'
import { buildAccountTree, findAncestorByType } from '@/lib/accounts'
import { getFY } from '@/lib/utils'

const createSchema = z.object({
  name: z.string().min(1).max(140),
  type: z.enum(['company', 'cluster', 'division', 'brand']),
  parentId: z.string().cuid().nullable().optional(),
  msaStart: z.string().datetime().nullable().optional(),
  msaExpiry: z.string().datetime().nullable().optional(),
  gstRegistered: z.boolean().optional(),
})

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const tree = searchParams.get('tree') === 'true'
  const type = searchParams.get('type')

  const [accounts, opportunities, wonOpportunities, fyInvoices, unpaidInvoices, anyInvoiceRows] = await Promise.all([
    prisma.account.findMany({
      where: type ? { type: type as any } : undefined,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: { registeredEntities: { orderBy: [{ isDefault: 'desc' }, { legalName: 'asc' }] } },
    }),
    prisma.opportunity.findMany({
      where: { leadType: { notIn: ['won', 'lost'] } },
      select: { accountId: true, estimatedValue: true, leadType: true, leadStage: true },
    }),
    // Won opportunities (any stage — commissioned/partial_invoiced/invoiced) stand in for "active projects"
    prisma.opportunity.findMany({
      where: { leadType: 'won' },
      select: { accountId: true, estimatedValue: true },
    }),
    // Current FY invoices for totalInvoicedFY (excluding cancelled/CN)
    prisma.invoice.findMany({
      where: { fy: getFY(new Date()), status: { notIn: ['cancelled', 'credit_note'] } },
      select: { accountId: true, amt: true, gross: true },
    }),
    // All unpaid invoices for receivables (net ex-GST)
    prisma.invoice.findMany({
      where: { status: { notIn: ['paid', 'draft', 'cancelled', 'credit_note'] }, docType: { notIn: ['PI', 'QUOTE'] } },
      select: { accountId: true, amt: true, net: true, amountReceived: true },
    }),
    // Any non-draft, non-cancelled invoice → company is "Converted"
    prisma.invoice.findMany({
      where: { accountId: { not: null }, status: { notIn: ['draft', 'cancelled'] } },
      select: { accountId: true },
      distinct: ['accountId'],
    }),
  ])

  const map = new Map(accounts.map((a) => [a.id, a]))
  const invoicedAccountIdSet = new Set(
    anyInvoiceRows.map((r) => r.accountId).filter(Boolean) as string[],
  )

  const statsByCompany: Record<string, {
    openOpportunityCount: number
    openOpportunityValue: number
    receivables: number
    activeProjects: number
    activeProjectValue: number
    totalInvoicedFY: number
    hasInvoices: boolean
  }> = {}

  for (const account of accounts.filter((a) => a.type === 'company')) {
    statsByCompany[account.id] = {
      openOpportunityCount: 0,
      openOpportunityValue: 0,
      receivables: 0,
      activeProjects: 0,
      activeProjectValue: 0,
      totalInvoicedFY: 0,
      hasInvoices: false,
    }
  }

  for (const opp of opportunities) {
    const company = findAncestorByType(opp.accountId, map, 'company')
    if (!company) continue
    const stats = statsByCompany[company.id]
    if (stats) {
      stats.openOpportunityCount += 1
      stats.openOpportunityValue += opp.estimatedValue
    }
  }

  for (const opp of wonOpportunities) {
    const company = findAncestorByType(opp.accountId, map, 'company')
    if (!company) continue
    const stats = statsByCompany[company.id]
    if (stats) {
      stats.activeProjects += 1
      stats.activeProjectValue += opp.estimatedValue
    }
  }

  for (const inv of fyInvoices) {
    if (!inv.accountId) continue
    const company = findAncestorByType(inv.accountId, map, 'company')
    if (!company) continue
    if (statsByCompany[company.id]) statsByCompany[company.id].totalInvoicedFY += inv.gross
  }

  for (const inv of unpaidInvoices) {
    if (!inv.accountId || inv.amt <= 0) continue
    const company = findAncestorByType(inv.accountId, map, 'company')
    if (!company) continue
    const stats = statsByCompany[company.id]
    if (stats) {
      const unpaidRatio = Math.max(0, inv.amt - inv.amountReceived) / inv.amt
      stats.receivables += inv.net * unpaidRatio
    }
  }

  // Mark companies that have ever been invoiced as "Converted"
  for (const accountId of invoicedAccountIdSet) {
    const company = findAncestorByType(accountId, map, 'company')
    if (!company) continue
    const stats = statsByCompany[company.id]
    if (stats) stats.hasInvoices = true
  }
  // Belt-and-suspenders: also mark if current FY has invoices
  for (const stats of Object.values(statsByCompany)) {
    if (stats.totalInvoicedFY > 0) stats.hasInvoices = true
  }

  return NextResponse.json({
    accounts,
    tree: tree ? buildAccountTree(accounts) : undefined,
    statsByCompany,
  })
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const created = await prisma.account.create({
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      parentId: parsed.data.parentId || null,
      msaStart: parsed.data.msaStart ? new Date(parsed.data.msaStart) : null,
      msaExpiry: parsed.data.msaExpiry ? new Date(parsed.data.msaExpiry) : null,
      ...(parsed.data.gstRegistered !== undefined && { gstRegistered: parsed.data.gstRegistered }),
    },
  })

  return NextResponse.json(created, { status: 201 })
}
