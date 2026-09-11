export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const createSchema = z.object({
  legalName: z.string().min(1).max(200),
  gstin: z.string().min(1).max(20),
  state: z.string().min(1).max(100),
  isDefault: z.boolean().optional(),
})

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const entities = await prisma.registeredEntity.findMany({
    where: { accountId: params.id },
    orderBy: [{ isDefault: 'desc' }, { legalName: 'asc' }],
  })
  return NextResponse.json(entities)
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { legalName, gstin, state, isDefault } = parsed.data

  try {
    const created = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.registeredEntity.updateMany({
          where: { accountId: params.id, isDefault: true },
          data: { isDefault: false },
        })
      }
      return tx.registeredEntity.create({
        data: { accountId: params.id, legalName, gstin, state, isDefault: isDefault ?? false },
      })
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: `GSTIN "${gstin}" is already registered for this account` }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create registered entity' }, { status: 500 })
  }
}
