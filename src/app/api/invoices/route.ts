export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'
import { FX_RATES } from '@/lib/constants'
import { getFY } from '@/lib/utils'
import { syncOpportunityInvoicedAmount } from '@/lib/opportunitySync'

const invoiceInputSchema = z.object({
  entity: z.enum(['PMD', 'Medflix', 'Metflix']).default('PMD'),
  docType: z.enum(['INV', 'PI', 'QUOTE', 'CN']).default('INV'),
  invNo: z.string().max(80).nullable().optional(),
  pi: z.string().max(80).nullable().optional(),
  po: z.string().max(80).nullable().optional(),
  date: z.string().datetime(),
  effDate: z.string().datetime().nullable().optional(),
  expectedFY: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  gstId: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  creditDays: z.number().int().min(0).max(365).default(45),
  projectCategory: z.string().nullable().optional(),
  offeringName: z.string().nullable().optional(),
  sac: z.string().nullable().optional(),
  desc: z.string().nullable().optional(),
  qty: z.number().int().nonnegative().nullable().optional(),
  unitRevenue: z.number().nonnegative().nullable().optional(),
  currency: z.string().default('INR'),
  fxRate: z.number().positive().optional(),
  gross: z.number().nonnegative(),
  disc: z.number().nonnegative().default(0),
  gstRate: z.number().nonnegative().default(18),
  dueDate: z.string().datetime().nullable().optional(),
  expectedPaymentDate: z.string().datetime().nullable().optional(),
  status: z.enum(['draft', 'sent', 'overdue', 'partial', 'paid']).optional(),
  comments: z.string().nullable().optional(),
  irn: z.string().max(80).nullable().optional(),
  ackNo: z.string().max(40).nullable().optional(),
  ackDate: z.string().datetime().nullable().optional(),
  accountId: z.string().cuid().nullable().optional(),
  opportunityId: z.string().cuid().nullable().optional(),
})

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function normalizeInvoice(input: z.infer<typeof invoiceInputSchema>) {
  const date = new Date(input.date)
  const currency = input.currency || 'INR'
  const fxRate = input.fxRate || FX_RATES[currency] || 1
  const gross = input.gross * fxRate
  const disc = input.disc * fxRate
  const net = gross - disc
  const gst = net * (input.gstRate / 100)
  const amt = net + gst
  const dueDate = input.dueDate ? new Date(input.dueDate) : addDays(date, input.creditDays)

  return {
    entity: input.entity,
    docType: input.docType,
    invNo: input.invNo || null,
    pi: input.pi || null,
    po: input.po || null,
    date,
    effDate: input.effDate ? new Date(input.effDate) : null,
    fy: getFY(date),
    expectedFY: input.expectedFY || null,
    clientCode: input.clientCode || null,
    clientName: input.clientName || null,
    company: input.company || null,
    gstId: input.gstId || null,
    state: input.state || null,
    creditDays: input.creditDays,
    projectCategory: input.projectCategory || null,
    offeringName: input.offeringName || null,
    sac: input.sac || null,
    desc: input.desc || null,
    qty: input.qty ?? null,
    unitRevenue: input.unitRevenue ?? null,
    currency,
    fxRate,
    gross,
    disc,
    net,
    gstRate: input.gstRate,
    gst,
    amt,
    dueDate,
    expectedPaymentDate: input.expectedPaymentDate ? new Date(input.expectedPaymentDate) : null,
    status: input.status || 'draft',
    comments: input.comments || null,
    irn: input.irn || null,
    ackNo: input.ackNo || null,
    ackDate: input.ackDate ? new Date(input.ackDate) : null,
    accountId: input.accountId || null,
    opportunityId: input.opportunityId || null,
  }
}

const NON_RECEIVABLE_DOC_TYPES = ['PI', 'QUOTE']
const FROZEN_STATUSES = ['paid', 'gst_pending', 'cancelled', 'credit_note']

function withComputedStatus<T extends { status: string; docType: string; amountReceived: number; amt: number; tdsAmount: number | null; dueDate: Date | null; gstWithheld?: boolean; gstWithheldAmount?: number | null }>(inv: T) {
  const now = new Date()
  const tds = inv.tdsAmount || 0
  const gstHeld = inv.gstWithheld ? (inv.gstWithheldAmount || 0) : 0
  // PI, QUOTE, cancelled, credit_note are always "sent" — never auto-derive overdue/partial
  const isFrozen = FROZEN_STATUSES.includes(inv.status) || NON_RECEIVABLE_DOC_TYPES.includes(inv.docType)
  let computedStatus = inv.status
  if (!isFrozen) {
    const settled = inv.amountReceived + tds
    // A stored 'overdue' that's no longer past due (due date moved forward, or cleared)
    // reverts — overdue is fully derived from the due date, never sticky.
    if (computedStatus === 'overdue' && !(inv.dueDate && inv.dueDate < now)) {
      computedStatus = inv.amountReceived > 0 ? 'partial' : 'sent'
    }
    if (inv.amountReceived > 0 && settled < inv.amt * 0.995) computedStatus = 'partial'
    // Paid in full bar a deliberately withheld GST slice → GST Pending.
    if (gstHeld > 0 && settled + gstHeld >= inv.amt * 0.995 && settled < inv.amt * 0.995) computedStatus = 'gst_pending'
    if (!['partial', 'draft', 'paid', 'gst_pending'].includes(computedStatus) && inv.dueDate && inv.dueDate < now) computedStatus = 'overdue'
  }
  // credit_note and non-receivable doc types carry 0 pending — they are not counted in receivables
  const pendingAmount = (computedStatus === 'credit_note' || NON_RECEIVABLE_DOC_TYPES.includes(inv.docType))
    ? 0
    : Math.max(0, inv.amt - inv.amountReceived - tds)
  return {
    ...inv,
    status: computedStatus,
    pendingAmount,
  }
}

// Quarter helper: returns [startDate, endDate] for a given FY + quarter
function quarterDateRange(fy: string, quarter: string): [Date, Date] | null {
  const m = fy.match(/FY (\d{2})-(\d{2})/)
  if (!m) return null
  const year = 2000 + parseInt(m[1])
  const ranges: Record<string, [Date, Date]> = {
    Q1: [new Date(year, 3, 1), new Date(year, 6, 0, 23, 59, 59)],       // Apr–Jun
    Q2: [new Date(year, 6, 1), new Date(year, 9, 0, 23, 59, 59)],       // Jul–Sep
    Q3: [new Date(year, 9, 1), new Date(year, 11, 31, 23, 59, 59)],     // Oct–Dec
    Q4: [new Date(year + 1, 0, 1), new Date(year + 1, 2, 31, 23, 59, 59)], // Jan–Mar
  }
  return ranges[quarter] || null
}

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const entity = searchParams.get('entity')
  const status = searchParams.get('status')
  const fy = searchParams.get('fy')
  const quarter = searchParams.get('quarter') // Q1/Q2/Q3/Q4
  const docType = searchParams.get('docType') // INV/PI/QUOTE/CN
  const gstPending = searchParams.get('gstPending') // 'true'
  const search = searchParams.get('search')

  const invoices = await prisma.invoice.findMany({
    where: {
      entity: entity ? (entity as any) : undefined,
      // status is intentionally NOT filtered in DB — applied in memory after withComputedStatus
      // (because overdue/partial are computed from dueDate/amountReceived, not stored directly)
      fy: fy || undefined,
      docType: docType ? (docType as any) : undefined,
      OR: search
        ? [
            { invNo: { contains: search, mode: 'insensitive' } },
            { company: { contains: search, mode: 'insensitive' } },
            { clientName: { contains: search, mode: 'insensitive' } },
            { clientName: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    },
    include: {
      account: true,
      receipts: true,
      linkedInvoice: { select: { id: true, invNo: true, amt: true } },
    },
    orderBy: { date: 'desc' },
  })

  let result = invoices.map(withComputedStatus)

  // Status filter: applied in memory so 'overdue' matches computed status correctly
  if (status) {
    result = result.filter((i) => i.status === status)
  }

  // Quarter filter: applied in memory (works with or without FY)
  if (quarter) {
    result = result.filter((i) => {
      const d = new Date(i.date)
      const m = d.getMonth() + 1 // 1-12
      if (quarter === 'Q1') return m >= 4 && m <= 6
      if (quarter === 'Q2') return m >= 7 && m <= 9
      if (quarter === 'Q3') return m >= 10 && m <= 12
      if (quarter === 'Q4') return m >= 1 && m <= 3
      return true
    })
  }

  // GST pending filter: gst > 0 AND status != paid
  if (gstPending === 'true') {
    result = result.filter((i) => i.gst > 0 && i.status !== 'paid')
  }

  // Sort: newest invoice date first (calendar-day grouping), then by the invoice
  // number's trailing sequence, highest first. Only the digits at the very end of
  // invNo are used, so the entity prefix (PMD/… vs MX/…) and the FY digits never
  // affect the order. Rows with no trailing number sort last within their day.
  result.sort((a, b) => {
    const dayDiff = invoiceDay(b.date).localeCompare(invoiceDay(a.date))
    if (dayDiff !== 0) return dayDiff
    const seqDiff = invoiceSeq(b.invNo) - invoiceSeq(a.invNo)
    if (seqDiff !== 0) return seqDiff
    return (b.invNo || '').localeCompare(a.invNo || '')
  })

  return NextResponse.json(result)
}

// Calendar day (YYYY-MM-DD, UTC) of an invoice date — used to group same-day
// invoices before applying the invoice-number tie-break.
function invoiceDay(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10)
}

// Numeric value of the digits at the end of an invoice number, e.g.
// "PMD/INV/25-26/007" -> 7, "MX/INV/25-26/042" -> 42. Returns -1 when there is
// no trailing number so such rows sort last in a descending order.
function invoiceSeq(invNo: string | null): number {
  const m = (invNo || '').match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : -1
}

async function generateInvNo(entity: string, docType: string, fy: string): Promise<string> {
  const count = await prisma.invoice.count({
    where: { entity: entity as any, docType: docType as any, fy },
  })
  const seq = String(count + 1).padStart(3, '0')
  const fyShort = fy.replace('FY ', '')
  return `${entity}/${docType}/${fyShort}/${seq}`
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = invoiceInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const data = normalizeInvoice(parsed.data)

  // Auto-generate invoice number if not provided
  if (!data.invNo) {
    data.invNo = await generateInvNo(data.entity, data.docType, data.fy)
  }

  // Reject duplicate invoice numbers
  if (data.invNo) {
    const existing = await prisma.invoice.findFirst({ where: { invNo: data.invNo } })
    if (existing) {
      return NextResponse.json({ error: `Invoice number ${data.invNo} already exists` }, { status: 409 })
    }
  }

  const created = await prisma.invoice.create({
    data,
    include: {
      account: true,
      receipts: true,
    },
  })

  if (created.opportunityId) {
    await syncOpportunityInvoicedAmount(prisma, created.opportunityId)
  }

  return NextResponse.json(withComputedStatus(created), { status: 201 })
}
