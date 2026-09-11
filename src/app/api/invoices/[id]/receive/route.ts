export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const receiveSchema = z.object({
  receiptType: z.enum(['full', 'partial']),
  amountReceived: z.number().positive().optional(),
  receivedDate: z.string().datetime(),
  tdsPercent: z.number().min(0).default(0),
  gstWithheld: z.boolean().default(false),
  gstWithheldAmount: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = receiveSchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return NextResponse.json({ error: msg || 'Validation failed' }, { status: 400 })
  }

  const invoice = await prisma.invoice.findUnique({ where: { id: params.id } })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const pending = Math.max(0, invoice.amt - invoice.amountReceived)
  // The slice of the invoice this receipt covers (GST-inclusive).
  const settledSlice = parsed.data.receiptType === 'full' ? pending : parsed.data.amountReceived || 0

  if (settledSlice <= 0) {
    return NextResponse.json({ error: 'Invalid receipt amount' }, { status: 400 })
  }
  if (settledSlice > pending + 0.01) {
    return NextResponse.json({ error: 'Receipt amount cannot exceed pending amount' }, { status: 400 })
  }

  const tdsPercent = parsed.data.tdsPercent || 0
  const taxableComponent = invoice.amt > 0 ? (settledSlice * invoice.net) / invoice.amt : 0
  const tdsAmount = taxableComponent * (tdsPercent / 100)
  const gstWithheldAmount = parsed.data.gstWithheld
    ? parsed.data.gstWithheldAmount ?? (invoice.amt > 0 ? (settledSlice * invoice.gst) / invoice.amt : 0)
    : 0
  const netToBank = Math.max(0, settledSlice - tdsAmount - gstWithheldAmount)

  await prisma.$transaction(async (tx) => {
    await tx.receipt.create({
      data: {
        invoiceId: params.id,
        // The invoice value this receipt covers (GST-inclusive) — a withheld-GST slice is
        // netted out at the invoice level below, not here.
        amountReceived: settledSlice,
        receivedDate: new Date(parsed.data.receivedDate),
        tdsPercent,
        tdsAmount,
        gstWithheld: parsed.data.gstWithheld,
        gstWithheldAmount,
        netToBank,
        notes: parsed.data.notes || null,
      },
    })

    const allReceipts = await tx.receipt.findMany({ where: { invoiceId: params.id } })
    const totalSlices = allReceipts.reduce((sum, r) => sum + r.amountReceived, 0)
    const totalTds = allReceipts.reduce((sum, r) => sum + (r.tdsAmount || 0), 0)
    const totalGstWithheld = allReceipts.reduce((sum, r) => sum + (r.gstWithheld ? r.gstWithheldAmount : 0), 0)
    // Value actually collected/remitted — a withheld-GST slice is still owed, so it
    // does NOT reduce the invoice's outstanding balance.
    const collected = totalSlices - totalGstWithheld
    const outstanding = invoice.amt - collected
    const tol = invoice.amt * 0.005

    // "GST pending" = the invoice is settled apart from a deliberately withheld GST slice
    // that's still owed. It gets its own status instead of sitting in "Partial" forever,
    // and flips to "paid" once that GST is finally collected.
    const status =
      outstanding <= tol
        ? 'paid'
        : totalGstWithheld > 0.5 && outstanding <= totalGstWithheld + tol
          ? 'gst_pending'
          : collected > 0
            ? 'partial'
            : 'sent'

    await tx.invoice.update({
      where: { id: params.id },
      data: {
        amountReceived: collected,
        status,
        receivedDate: status === 'paid' ? new Date(parsed.data.receivedDate) : null,
        tdsPercent,
        tdsAmount: totalTds,
        gstWithheld: totalGstWithheld > 0.5,
        gstWithheldAmount: totalGstWithheld,
      },
    })
  })

  const updated = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: { receipts: true, account: true },
  })

  return NextResponse.json(updated)
}
