export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const createSchema = z.object({
  category: z.string().min(1).max(80),
  projectType: z.string().min(1).max(120),
})

export async function GET() {
  const options = await prisma.projectTypeOption.findMany({
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    select: { id: true, category: true, projectType: true, sortOrder: true },
  })

  const categories: Record<string, string[]> = {}
  for (const opt of options) {
    if (!categories[opt.category]) categories[opt.category] = []
    categories[opt.category].push(opt.projectType)
  }

  return NextResponse.json({ categories, options })
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { category, projectType } = parsed.data

  const maxSortOrder = await prisma.projectTypeOption.aggregate({
    where: { category },
    _max: { sortOrder: true },
  })
  const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1

  try {
    const created = await prisma.projectTypeOption.create({
      data: { category, projectType, sortOrder: nextSortOrder },
      select: { id: true, category: true, projectType: true, sortOrder: true },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: `"${projectType}" already exists in this category` }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create offering' }, { status: 500 })
  }
}
