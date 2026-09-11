export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const patchSchema = z.object({
  legalName: z.string().min(1).max(200).optional(),
  gstin: z.string().min(1).max(20).optional(),
  state: z.string().min(1).max(100).optional(),
  isDefault: z.boolean().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; entityId: string } },
) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (d.isDefault) {
        await tx.registeredEntity.updateMany({
          where: { accountId: params.id, isDefault: true, NOT: { id: params.entityId } },
          data: { isDefault: false },
        })
      }
      return tx.registeredEntity.update({
        where: { id: params.entityId },
        data: {
          legalName: d.legalName,
          gstin: d.gstin,
          state: d.state,
          isDefault: d.isDefault,
        },
      })
    })
    return NextResponse.json(updated)
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: `GSTIN "${d.gstin}" is already registered for this account` }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to update registered entity' }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string; entityId: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  await prisma.registeredEntity.delete({ where: { id: params.entityId } })
  return NextResponse.json({ success: true })
}
