import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import UsersAdminClient from './UsersAdminClient'

export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.toLowerCase().trim()
  if (!email) redirect('/login')

  const user = await prisma.user.findUnique({ where: { email }, select: { role: true, status: true } })
  if (!user || user.status !== 'approved' || user.role !== 'admin') redirect('/dashboard')

  return (
    <Suspense fallback={<div className="page">Loading...</div>}>
      <UsersAdminClient />
    </Suspense>
  )
}
