export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PocType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const createSchema = z.object({
  name: z.string().min(1, 'Name is required').max(140),
  accountId: z.string().cuid({ message: 'Company is required' }),
  email: z.string().max(200).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  designation: z.string().max(120).nullable().optional(),
  division: z.string().max(120).nullable().optional(),
  therapyArea: z.string().max(120).nullable().optional(),
  brand: z.string().max(120).nullable().optional(),
  molecule: z.string().max(120).nullable().optional(),
  type: z.nativeEnum(PocType).nullable().optional(),
})

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')

  const pocs = await prisma.poc.findMany({
    where: { accountId: accountId || undefined },
    include: { account: { select: { id: true, name: true, type: true, parentId: true } } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(pocs)
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data
  const created = await prisma.poc.create({
    data: {
      name: d.name.trim(),
      accountId: d.accountId,
      email: d.email?.trim() || null,
      phone: d.phone?.trim() || null,
      designation: d.designation?.trim() || null,
      division: d.division?.trim() || null,
      therapyArea: d.therapyArea?.trim() || null,
      brand: d.brand?.trim() || null,
      molecule: d.molecule?.trim() || null,
      type: d.type || null,
    },
    include: { account: { select: { id: true, name: true, type: true, parentId: true } } },
  })

  return NextResponse.json(created, { status: 201 })
}
