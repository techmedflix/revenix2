import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import ProjectTypesAdminClient from './ProjectTypesAdminClient'

export default async function ProjectTypesAdminPage() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.toLowerCase().trim()
  if (!email) redirect('/login')

  const user = await prisma.user.findUnique({ where: { email }, select: { role: true, status: true } })
  if (!user || user.status !== 'approved') redirect('/dashboard')

  return <ProjectTypesAdminClient />
}
