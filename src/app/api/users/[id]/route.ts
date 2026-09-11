export const preferredRegion = 'sin1'

import { UserRole } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const patchSchema = z.object({
  role: z.nativeEnum(UserRole).optional(),
  status: z.enum(['pending', 'approved', 'revoked']).optional(),
  name: z.string().min(1).max(100).nullable().optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const nextStatus = parsed.data.status

  const user = await prisma.user.update({
    where: { id: params.id },
    data: {
      role: parsed.data.role,
      name: parsed.data.name,
      status: nextStatus,
      approvedAt: nextStatus === 'approved' ? new Date() : nextStatus === 'pending' ? null : undefined,
      approvedByUserId:
        nextStatus === 'approved' ? auth.user.id : nextStatus === 'pending' ? null : undefined,
    },
    include: {
      approvedByUser: {
        select: { id: true, name: true, email: true },
      },
    },
  })

  return NextResponse.json(user)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin'])
  if ('error' in auth) return auth.error

  if (params.id === auth.user.id) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })
  }

  // Reassign any opportunities owned by this user to the admin performing the deletion,
  // and reassign activity log entries — both have Restrict FK so must be handled first.
  await prisma.$transaction([
    prisma.opportunity.updateMany({
      where: { ownerId: params.id },
      data: { ownerId: auth.user.id },
    }),
    prisma.activity.updateMany({
      where: { createdById: params.id },
      data: { createdById: auth.user.id },
    }),
    prisma.user.delete({ where: { id: params.id } }),
  ])

  return NextResponse.json({ success: true })
}
