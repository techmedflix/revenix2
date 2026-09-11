export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

const patchSchema = z.object({
  monthlyOpex: z.number().positive().optional(),
  cashInBank: z.number().nonnegative().optional(),
  defaultPaymentTerms: z.number().int().min(1).max(180).optional(),
})

async function getOrCreate() {
  const existing = await prisma.systemSetting.findFirst()
  if (existing) return existing
  return prisma.systemSetting.create({
    data: {
      monthlyOpex: 3500000,
      cashInBank: 0,
      defaultPaymentTerms: 45,
    },
  })
}

export async function GET() {
  const auth = await getAuthorizedUser(['admin', 'leadership'])
  if ('error' in auth) return auth.error

  const row = await getOrCreate()
  return NextResponse.json(row)
}

export async function PATCH(request: NextRequest) {
  const auth = await getAuthorizedUser(['admin', 'leadership'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const row = await getOrCreate()

  const updated = await prisma.systemSetting.update({
    where: { id: row.id },
    data: {
      monthlyOpex: parsed.data.monthlyOpex,
      cashInBank: parsed.data.cashInBank,
      defaultPaymentTerms: parsed.data.defaultPaymentTerms,
    },
  })

  return NextResponse.json(updated)
}
