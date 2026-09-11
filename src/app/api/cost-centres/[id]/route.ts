export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser(['admin'])
  if ('error' in auth) return auth.error

  const usage = await prisma.vendorInvoice.count({ where: { costCentreId: params.id } })
  if (usage > 0) {
    return NextResponse.json({ error: 'Cannot delete referenced cost centre' }, { status: 400 })
  }

  await prisma.costCentre.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
