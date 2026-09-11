export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const createSchema = z.object({
  name: z.string().min(1).max(120),
})

export async function GET() {
  const auth = await getAuthorizedUser(['admin', 'leadership'])
  if ('error' in auth) return auth.error

  const rows = await prisma.costCentre.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json(rows)
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const created = await prisma.costCentre.create({ data: { name: parsed.data.name } })
  return NextResponse.json(created, { status: 201 })
}
