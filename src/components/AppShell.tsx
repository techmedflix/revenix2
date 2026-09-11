'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Sidebar from './Sidebar'
import { GlobalFiltersProvider } from '@/lib/GlobalFiltersContext'

import type { UserRole } from '@prisma/client'

const ALL_ROLES: UserRole[] = ['admin', 'leadership', 'partnerships']

const ROLE_ROUTES: Array<{ prefix: string; roles: UserRole[] }> = [
  { prefix: '/dashboard', roles: ALL_ROLES },
  { prefix: '/order-book', roles: ALL_ROLES },
  { prefix: '/invoicing', roles: ALL_ROLES },
  { prefix: '/accounts', roles: ALL_ROLES },
  { prefix: '/admin', roles: ['admin'] },
]

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (pathname === '/login') return

    if (status === 'unauthenticated') {
      router.push('/login')
      return
    }

    if (status === 'authenticated') {
      const user = session?.user
      if (!user || user.status !== 'approved') {
        router.push(`/login?status=${user?.status || 'pending'}`)
        return
      }

      const rule = ROLE_ROUTES.find((r) => matches(pathname, r.prefix))
      if (rule && !rule.roles.includes(user.role)) {
        router.push('/dashboard?error=forbidden')
      }
    }
  }, [status, session?.user, pathname, router])

  if (status === 'loading') {
    return <div className="page">Loading…</div>
  }

  if (pathname === '/login') return <>{children}</>
  if (!session?.user || session.user.status !== 'approved') return null

  return (
    <GlobalFiltersProvider>
      <div className="app-shell">
        <Sidebar />
        <main className="app-main">{children}</main>
      </div>
    </GlobalFiltersProvider>
  )
}
