export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const patchSchema = z.object({
  category: z.string().min(1).max(80).optional(),
  projectType: z.string().min(1).max(120).optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const existing = await prisma.projectTypeOption.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const oldCat = existing.category
  const oldType = existing.projectType
  const newCat = parsed.data.category ?? oldCat
  const newType = parsed.data.projectType ?? oldType

  const updated = await prisma.projectTypeOption.update({
    where: { id: params.id },
    data: {
      category: parsed.data.category,
      projectType: parsed.data.projectType,
    },
    select: { id: true, category: true, projectType: true, sortOrder: true },
  })

  // Offering/category names are stored as free text on opportunities and invoices,
  // so a rename here must cascade or the existing rows drift out of sync.
  let cascaded = 0
  if (newType !== oldType) {
    const [o, i] = await Promise.all([
      prisma.opportunity.updateMany({
        where: { projectCategory: oldCat, projectType: oldType },
        data: { projectType: newType },
      }),
      prisma.invoice.updateMany({
        where: { projectCategory: oldCat, offeringName: oldType },
        data: { offeringName: newType },
      }),
    ])
    cascaded += o.count + i.count
  }
  if (newCat !== oldCat) {
    const [o, i] = await Promise.all([
      prisma.opportunity.updateMany({
        where: { projectCategory: oldCat },
        data: { projectCategory: newCat },
      }),
      prisma.invoice.updateMany({
        where: { projectCategory: oldCat },
        data: { projectCategory: newCat },
      }),
    ])
    cascaded += o.count + i.count
  }

  return NextResponse.json({ ...updated, cascaded })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  const existing = await prisma.projectTypeOption.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.projectTypeOption.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
