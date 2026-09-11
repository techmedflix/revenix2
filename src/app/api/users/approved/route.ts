export const preferredRegion = 'sin1'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

// Returns a minimal list of approved users for dropdown use (accessible to all roles)
export async function GET() {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const users = await prisma.user.findMany({
    where: { status: 'approved' },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(users)
}
