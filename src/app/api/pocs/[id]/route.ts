export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PocType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const patchSchema = z.object({
  name: z.string().min(1, 'Name is required').max(140).optional(),
  accountId: z.string().cuid({ message: 'Company is invalid — try re-selecting it' }).optional(),
  email: z.string().max(200).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  designation: z.string().max(120).nullable().optional(),
  division: z.string().max(120).nullable().optional(),
  therapyArea: z.string().max(120).nullable().optional(),
  brand: z.string().max(120).nullable().optional(),
  molecule: z.string().max(120).nullable().optional(),
  type: z.nativeEnum(PocType).nullable().optional(),
})

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  const poc = await prisma.poc.findUnique({
    where: { id: params.id },
    include: { account: { select: { id: true, name: true, type: true, parentId: true } } },
  })
  if (!poc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(poc)
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data
  const updated = await prisma.poc.update({
    where: { id: params.id },
    data: {
      name: d.name?.trim(),
      accountId: d.accountId,
      email: d.email !== undefined ? d.email?.trim() || null : undefined,
      phone: d.phone !== undefined ? d.phone?.trim() || null : undefined,
      designation: d.designation !== undefined ? d.designation?.trim() || null : undefined,
      division: d.division !== undefined ? d.division?.trim() || null : undefined,
      therapyArea: d.therapyArea !== undefined ? d.therapyArea?.trim() || null : undefined,
      brand: d.brand !== undefined ? d.brand?.trim() || null : undefined,
      molecule: d.molecule !== undefined ? d.molecule?.trim() || null : undefined,
      type: d.type !== undefined ? d.type : undefined,
    },
    include: { account: { select: { id: true, name: true, type: true, parentId: true } } },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  await prisma.poc.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
