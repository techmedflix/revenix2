export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const patchSchema = z.object({
  name: z.string().min(1).max(140).optional(),
  parentId: z.string().cuid().nullable().optional(),
  msaStart: z.string().datetime().nullable().optional(),
  msaExpiry: z.string().datetime().nullable().optional(),
  gstRegistered: z.boolean().optional(),
  vendorRegistered: z.boolean().optional(),
  vendorCode: z.string().max(100).nullable().optional(),
})

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const account = await prisma.account.findUnique({ where: { id: params.id } })
  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(account)
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const updated = await prisma.account.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.parentId !== undefined && { parentId: parsed.data.parentId }),
      ...('msaStart' in parsed.data && {
        msaStart: parsed.data.msaStart ? new Date(parsed.data.msaStart) : null,
      }),
      ...('msaExpiry' in parsed.data && {
        msaExpiry: parsed.data.msaExpiry ? new Date(parsed.data.msaExpiry) : null,
      }),
      ...(parsed.data.gstRegistered !== undefined && { gstRegistered: parsed.data.gstRegistered }),
      ...(parsed.data.vendorRegistered !== undefined && { vendorRegistered: parsed.data.vendorRegistered }),
      ...('vendorCode' in parsed.data && { vendorCode: parsed.data.vendorCode ?? null }),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const [children, opps, invoices] = await Promise.all([
    prisma.account.count({ where: { parentId: params.id } }),
    prisma.opportunity.count({ where: { accountId: params.id } }),
    prisma.invoice.count({ where: { accountId: params.id } }),
  ])

  if (children || opps || invoices) {
    return NextResponse.json(
      { error: 'Cannot delete account with children or linked records' },
      { status: 400 },
    )
  }

  await prisma.account.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
