import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'
import { prisma } from './prisma'
import { authOptions } from './auth'

export async function getAuthorizedUser(allowedRoles?: UserRole[]) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.toLowerCase().trim()

  if (!email) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, status: true },
  })

  if (!user || user.status !== 'approved') {
    return { error: NextResponse.json({ error: 'Access not approved' }, { status: 403 }) }
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user }
}
