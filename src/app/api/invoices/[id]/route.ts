export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'
import { FX_RATES } from '@/lib/constants'
import { getFY } from '@/lib/utils'
import { syncOpportunityInvoicedAmount } from '@/lib/opportunitySync'

const patchSchema = z.object({
  entity: z.enum(['PMD', 'Medflix', 'Metflix']).optional(),
  docType: z.enum(['INV', 'PI', 'QUOTE', 'CN']).optional(),
  invNo: z.string().nullable().optional(),
  pi: z.string().nullable().optional(),
  po: z.string().nullable().optional(),
  date: z.string().datetime().optional(),
  effDate: z.string().datetime().nullable().optional(),
  expectedFY: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  gstId: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  creditDays: z.number().int().min(1).max(365).optional(),
  projectCategory: z.string().nullable().optional(),
  offeringName: z.string().nullable().optional(),
  sac: z.string().nullable().optional(),
  desc: z.string().nullable().optional(),
  qty: z.number().int().nonnegative().nullable().optional(),
  unitRevenue: z.number().nonnegative().nullable().optional(),
  currency: z.string().optional(),
  fxRate: z.number().positive().optional(),
  gross: z.number().nonnegative().optional(),
  disc: z.number().nonnegative().optional(),
  gstRate: z.number().nonnegative().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  expectedPaymentDate: z.string().datetime().nullable().optional(),
  status: z.enum(['draft', 'sent', 'overdue', 'partial', 'gst_pending', 'paid', 'cancelled', 'credit_note']).optional(),
  comments: z.string().nullable().optional(),
  irn: z.string().max(80).nullable().optional(),
  ackNo: z.string().max(40).nullable().optional(),
  ackDate: z.string().datetime().nullable().optional(),
  accountId: z.string().cuid().nullable().optional(),
  linkedInvoiceId: z.string().cuid().nullable().optional(),
  opportunityId: z.string().cuid().nullable().optional(),
})

const NON_RECEIVABLE_DOC_TYPES = ['PI', 'QUOTE']
const FROZEN_STATUSES = ['paid', 'gst_pending', 'cancelled', 'credit_note']

function withComputedStatus<T extends { status: string; docType: string; amountReceived: number; amt: number; tdsAmount: number | null; dueDate: Date | null; gstWithheld?: boolean; gstWithheldAmount?: number | null }>(inv: T) {
  const now = new Date()
  const tds = inv.tdsAmount || 0
  const gstHeld = inv.gstWithheld ? (inv.gstWithheldAmount || 0) : 0
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
    // Everything in bar a withheld-GST slice → GST Pending, not Partial/Overdue.
    if (gstHeld > 0 && settled + gstHeld >= inv.amt * 0.995 && settled < inv.amt * 0.995) computedStatus = 'gst_pending'
    if (!['partial', 'draft', 'gst_pending'].includes(computedStatus) && inv.dueDate && inv.dueDate < now) computedStatus = 'overdue'
  }
  const pendingAmount = (computedStatus === 'credit_note' || NON_RECEIVABLE_DOC_TYPES.includes(inv.docType))
    ? 0
    : Math.max(0, inv.amt - inv.amountReceived - tds)
  return {
    ...inv,
    status: computedStatus,
    pendingAmount,
  }
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      account: true,
      receipts: true,
      linkedInvoice: { select: { id: true, invNo: true, amt: true } },
    },
  })

  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(withComputedStatus(invoice))
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const current = await prisma.invoice.findUnique({ where: { id: params.id } })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const next = parsed.data

  // Reject duplicate invoice numbers (exclude self)
  if (next.invNo && next.invNo !== current.invNo) {
    const conflict = await prisma.invoice.findFirst({ where: { invNo: next.invNo, NOT: { id: params.id } } })
    if (conflict) {
      return NextResponse.json({ error: `Invoice number ${next.invNo} already exists` }, { status: 409 })
    }
  }

  const currency = next.currency || current.currency
  const fxRate = next.fxRate || FX_RATES[currency] || current.fxRate
  const grossSource = next.gross ?? current.gross / current.fxRate
  const discSource = next.disc ?? current.disc / current.fxRate
  const gstRate = next.gstRate ?? current.gstRate
  const gross = grossSource * fxRate
  const disc = discSource * fxRate
  const net = gross - disc
  const gst = net * (gstRate / 100)
  const amt = net + gst

  const date = next.date ? new Date(next.date) : current.date
  const creditDays = next.creditDays ?? current.creditDays

  // When reverting to sent/draft: clear payment data and delete receipts
  const isReverting = next.status === 'sent' || next.status === 'draft'
  if (isReverting && (current.status === 'paid' || current.status === 'gst_pending')) {
    await prisma.receipt.deleteMany({ where: { invoiceId: params.id } })
  }

  const updated = await prisma.invoice.update({
    where: { id: params.id },
    data: {
      entity: next.entity,
      docType: next.docType,
      invNo: next.invNo,
      pi: next.pi,
      po: next.po,
      date,
      effDate: next.effDate === undefined ? undefined : next.effDate ? new Date(next.effDate) : null,
      fy: getFY(date),
      expectedFY: next.expectedFY,
      clientCode: next.clientCode,
      clientName: next.clientName,
      company: next.company,
      gstId: next.gstId,
      state: next.state,
      creditDays,
      projectCategory: next.projectCategory,
      offeringName: next.offeringName,
      sac: next.sac,
      desc: next.desc,
      currency,
      fxRate,
      gross,
      disc,
      net,
      gstRate,
      gst,
      amt,
      dueDate:
        next.dueDate === undefined
          ? undefined
          : next.dueDate
            ? new Date(next.dueDate)
            : null,
      expectedPaymentDate:
        next.expectedPaymentDate === undefined
          ? undefined
          : next.expectedPaymentDate
            ? new Date(next.expectedPaymentDate)
            : null,
      status: next.status,
      // Reset payment fields when reverting to sent/draft
      ...(isReverting && {
        amountReceived: 0,
        tdsPercent: null,
        tdsAmount: null,
        gstWithheld: false,
        gstWithheldAmount: null,
      }),
      qty: next.qty,
      unitRevenue: next.unitRevenue,
      comments: next.comments,
      irn: next.irn,
      ackNo: next.ackNo,
      ackDate: next.ackDate === undefined ? undefined : next.ackDate ? new Date(next.ackDate) : null,
      accountId: next.accountId,
      linkedInvoiceId: next.linkedInvoiceId,
      opportunityId: next.opportunityId,
    },
    include: { account: true, receipts: true, linkedInvoice: { select: { id: true, invNo: true, amt: true } } },
  })

  // When a credit note is linked to an invoice, cancel that invoice
  if (next.linkedInvoiceId && next.linkedInvoiceId !== current.linkedInvoiceId) {
    await prisma.invoice.update({
      where: { id: next.linkedInvoiceId },
      data: { status: 'cancelled' },
    })
  }
  // When a credit note is unlinked, restore the previously linked invoice to sent
  if (next.linkedInvoiceId === null && current.linkedInvoiceId) {
    await prisma.invoice.update({
      where: { id: current.linkedInvoiceId },
      data: { status: 'sent' },
    })
  }

  // Keep the opportunity's invoicedAmount in sync — both the old link (in case this invoice
  // was unlinked/moved) and the new one (in case it's still linked, whether or not the amount
  // itself changed).
  const affectedOpportunityIds = new Set([current.opportunityId, updated.opportunityId].filter((v): v is string => !!v))
  for (const oppId of affectedOpportunityIds) {
    await syncOpportunityInvoicedAmount(prisma, oppId)
  }

  return NextResponse.json(withComputedStatus(updated))
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const existing = await prisma.invoice.findUnique({ where: { id: params.id }, select: { opportunityId: true } })
  await prisma.invoice.delete({ where: { id: params.id } })
  if (existing?.opportunityId) {
    await syncOpportunityInvoicedAmount(prisma, existing.opportunityId)
  }
  return NextResponse.json({ success: true })
}
