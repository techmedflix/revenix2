export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const patchSchema = z.object({
  vendorName: z.string().min(1).max(180).optional(),
  costCentreId: z.string().cuid().optional(),
  costHeadId: z.string().cuid().optional(),
  amount: z.number().positive().optional(),
  invoiceDate: z.string().datetime().optional(),
  paymentDueDate: z.string().datetime().nullable().optional(),
  invoiceFileUrl: z.string().url().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  status: z.enum(['pending', 'approved', 'paid']).optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data

  const updated = await prisma.vendorInvoice.update({
    where: { id: params.id },
    data: {
      vendorName: d.vendorName,
      costCentreId: d.costCentreId,
      costHeadId: d.costHeadId,
      amount: d.amount,
      invoiceDate: d.invoiceDate ? new Date(d.invoiceDate) : undefined,
      paymentDueDate:
        d.paymentDueDate === undefined
          ? undefined
          : d.paymentDueDate
            ? new Date(d.paymentDueDate)
            : null,
      invoiceFileUrl: d.invoiceFileUrl,
      notes: d.notes,
      status: d.status,
      paidAt: d.status === 'paid' ? new Date() : d.status ? null : undefined,
    },
    include: {
      costCentre: true,
      costHead: true,
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin'])
  if ('error' in auth) return auth.error

  await prisma.vendorInvoice.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
