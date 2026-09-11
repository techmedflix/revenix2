export const preferredRegion = 'sin1'

import { UserRole } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100).optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.enum(['pending', 'approved', 'revoked']).optional(),
})

export async function GET() {
  const auth = await getAuthorizedUser(['admin'])
  if ('error' in auth) return auth.error

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      approvedAt: true,
      approvedByUser: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  })

  return NextResponse.json(users)
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const approved = data.status === 'approved'

  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      name: data.name,
      role: data.role || UserRole.partnerships,
      status: data.status || 'pending',
      approvedAt: approved ? new Date() : null,
      approvedByUserId: approved ? auth.user.id : null,
    },
  })

  return NextResponse.json(user, { status: 201 })
}
