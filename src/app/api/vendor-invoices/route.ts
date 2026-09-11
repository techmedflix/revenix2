export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const createSchema = z.object({
  vendorName: z.string().min(1).max(180),
  costCentreId: z.string().cuid(),
  costHeadId: z.string().cuid(),
  amount: z.number().positive(),
  invoiceDate: z.string().datetime(),
  paymentDueDate: z.string().datetime().nullable().optional(),
  invoiceFileUrl: z.string().url().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  status: z.enum(['pending', 'approved', 'paid']).optional(),
})

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin', 'leadership'])
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const costCentreId = searchParams.get('costCentreId')

  const rows = await prisma.vendorInvoice.findMany({
    where: {
      status: status ? (status as any) : undefined,
      costCentreId: costCentreId || undefined,
    },
    include: {
      costCentre: true,
      costHead: true,
    },
    orderBy: { invoiceDate: 'desc' },
  })

  return NextResponse.json(rows)
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin', 'leadership'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data
  const created = await prisma.vendorInvoice.create({
    data: {
      vendorName: d.vendorName,
      costCentreId: d.costCentreId,
      costHeadId: d.costHeadId,
      amount: d.amount,
      invoiceDate: new Date(d.invoiceDate),
      paymentDueDate: d.paymentDueDate ? new Date(d.paymentDueDate) : null,
      invoiceFileUrl: d.invoiceFileUrl || null,
      notes: d.notes || null,
      status: d.status || 'pending',
      paidAt: d.status === 'paid' ? new Date() : null,
    },
    include: {
      costCentre: true,
      costHead: true,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
