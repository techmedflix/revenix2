export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const patchSchema = z.object({
  amountReceived: z.number().positive().optional(),
  receivedDate: z.string().datetime().optional(),
  tdsPercent: z.number().min(0).max(100).optional(),
  gstWithheld: z.boolean().optional(),
  gstWithheldAmount: z.number().min(0).optional(),
  notes: z.string().max(500).nullable().optional(),
})

async function recomputeInvoice(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], invoiceId: string) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } })
  if (!invoice) return

  const allReceipts = await tx.receipt.findMany({
    where: { invoiceId },
    orderBy: { receivedDate: 'desc' },
  })

  const totalSlices = allReceipts.reduce((sum, r) => sum + r.amountReceived, 0)
  const totalTds = allReceipts.reduce((sum, r) => sum + (r.tdsAmount || 0), 0)
  const totalGstWithheld = allReceipts.reduce((sum, r) => sum + (r.gstWithheld ? r.gstWithheldAmount : 0), 0)
  const lastReceipt = allReceipts[0]

  // A withheld-GST slice is still owed → it doesn't reduce the outstanding balance.
  const collected = totalSlices - totalGstWithheld
  const outstanding = invoice.amt - collected
  const tol = invoice.amt * 0.005

  const status =
    outstanding <= tol
      ? 'paid'
      : totalGstWithheld > 0.5 && outstanding <= totalGstWithheld + tol
        ? 'gst_pending'
        : collected > 0
          ? 'partial'
          : 'sent'

  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountReceived: collected,
      status,
      receivedDate: status === 'paid' && lastReceipt ? lastReceipt.receivedDate : null,
      tdsPercent: lastReceipt?.tdsPercent ?? null,
      tdsAmount: totalTds,
      gstWithheld: totalGstWithheld > 0.5,
      gstWithheldAmount: totalGstWithheld || null,
    },
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership'])
  if ('error' in auth) return auth.error

  const receipt = await prisma.receipt.findUnique({ where: { id: params.id } })
  if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const next = parsed.data
  const invoice = await prisma.invoice.findUnique({ where: { id: receipt.invoiceId } })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  // Compute updated TDS/GST withheld amounts
  const newAmount = next.amountReceived ?? receipt.amountReceived
  const tdsPercent = next.tdsPercent ?? receipt.tdsPercent
  const taxableComponent = invoice.amt > 0 ? (newAmount * invoice.net) / invoice.amt : 0
  const tdsAmount = taxableComponent * (tdsPercent / 100)

  const gstWithheld = next.gstWithheld ?? receipt.gstWithheld
  const gstWithheldAmount = gstWithheld
    ? (next.gstWithheldAmount ?? (invoice.amt > 0 ? (newAmount * invoice.gst) / invoice.amt : 0))
    : 0
  const netToBank = Math.max(0, newAmount - tdsAmount - gstWithheldAmount)

  await prisma.$transaction(async (tx) => {
    await tx.receipt.update({
      where: { id: params.id },
      data: {
        amountReceived: newAmount,
        receivedDate: next.receivedDate ? new Date(next.receivedDate) : undefined,
        tdsPercent,
        tdsAmount,
        gstWithheld,
        gstWithheldAmount,
        netToBank,
        notes: next.notes === undefined ? undefined : next.notes,
      },
    })
    await recomputeInvoice(tx, receipt.invoiceId)
  })

  const updated = await prisma.invoice.findUnique({
    where: { id: receipt.invoiceId },
    include: { receipts: { orderBy: { receivedDate: 'asc' } }, account: true },
  })

  return NextResponse.json(updated)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership'])
  if ('error' in auth) return auth.error

  const receipt = await prisma.receipt.findUnique({ where: { id: params.id } })
  if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.receipt.delete({ where: { id: params.id } })
    await recomputeInvoice(tx, receipt.invoiceId)
  })

  const updated = await prisma.invoice.findUnique({
    where: { id: receipt.invoiceId },
    include: { receipts: { orderBy: { receivedDate: 'asc' } }, account: true },
  })

  return NextResponse.json(updated)
}
