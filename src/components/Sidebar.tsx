'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { useGlobalFilters } from '@/lib/GlobalFiltersContext'
import { useTheme } from '@/lib/ThemeContext'
import { FY_OPTIONS } from '@/lib/constants'

import type { UserRole } from '@prisma/client'

const NAV: Array<{ href: string; label: string; icon: string; roles: UserRole[] }> = [
  { href: '/dashboard',           label: 'Dashboard',    icon: '▦', roles: ['admin', 'leadership', 'partnerships'] },
  { href: '/order-book',          label: 'Order Book',   icon: '◈', roles: ['admin', 'leadership', 'partnerships'] },
  { href: '/invoicing',           label: 'Invoicing',    icon: '◎', roles: ['admin', 'leadership', 'partnerships'] },
  { href: '/accounts',            label: 'Accounts',     icon: '◉', roles: ['admin', 'leadership', 'partnerships'] },
  { href: '/pocs',                label: 'Contacts',     icon: '☺', roles: ['admin', 'leadership', 'partnerships'] },
  { href: '/admin/project-types', label: 'Offerings',    icon: '⊞', roles: ['admin', 'leadership', 'partnerships'] },
  { href: '/admin/users',         label: 'Admin Access', icon: '⊙', roles: ['admin'] },
]

const ENTITY_OPTIONS: Array<{ value: 'PMD' | 'Medflix' | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'PMD', label: 'PMD' },
  { value: 'Medflix', label: 'MX' },
]

export default function Sidebar() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const role = session?.user?.role || 'partnerships'
  const { entity, fy, setEntity, setFy } = useGlobalFilters()
  const { theme, toggleTheme } = useTheme()

  return (
    <aside className="app-sidebar">
      {/* Logo */}
      <div style={{ padding: '16px 14px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'var(--primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 900, color: '#fff',
            flexShrink: 0,
          }}>M</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)' }}>MedOS</div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>Medflix Operating System</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav" style={{ padding: '10px 8px', overflowY: 'auto', flex: '0 0 auto' }}>
        {NAV.filter((n) => n.roles.includes(role)).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '8px 10px',
                borderRadius: 8,
                background: active ? 'var(--primary-soft)' : 'transparent',
                color: active ? 'var(--primary)' : 'var(--text-muted)',
                fontWeight: active ? 700 : 500,
                fontSize: 13,
                borderLeft: active ? '2px solid var(--primary)' : '2px solid transparent',
                transition: 'all 0.12s ease',
              }}
            >
              <span style={{ fontSize: 11, opacity: active ? 1 : 0.6 }}>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Global Filters */}
      <div style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        {/* Entity */}
        <div style={{ padding: '10px 12px 8px' }}>
          <div className="section-label" style={{ marginBottom: 8 }}>Entity</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {ENTITY_OPTIONS.map((opt) => {
              const active = entity === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => setEntity(opt.value)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: active ? '1px solid rgba(74,158,255,0.55)' : '1px solid rgba(255,255,255,0.16)',
                    background: active ? 'rgba(74,158,255,0.18)' : 'rgba(255,255,255,0.05)',
                    color: active ? '#7ec8ff' : '#8ba0bc',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '0 12px' }} />

        {/* FY */}
        <div style={{ padding: '8px 12px 12px' }}>
          <div className="section-label" style={{ marginBottom: 8 }}>Financial Year</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(['', ...FY_OPTIONS] as string[]).map((f) => {
              const active = fy === f
              return (
                <button
                  key={f || 'all'}
                  onClick={() => setFy(f)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 999,
                    border: active ? '1px solid rgba(74,158,255,0.55)' : '1px solid rgba(255,255,255,0.14)',
                    background: active ? 'rgba(74,158,255,0.18)' : 'rgba(255,255,255,0.04)',
                    color: active ? '#7ec8ff' : '#8ba0bc',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.12s',
                  }}
                >
                  {f ? f.replace('FY ', '') : 'All'}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* User */}
      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--surface-3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
            flexShrink: 0,
          }}>
            {(session?.user?.name || 'U').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {session?.user?.name || 'User'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {session?.user?.email}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="badge badge-blue">{role}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{
                width: 30, height: 30,
                borderRadius: 8,
                border: '1px solid var(--border-strong)',
                background: 'var(--surface-2)',
                color: 'var(--text-muted)',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
                flexShrink: 0,
              }}
            >
              {theme === 'dark' ? '☀' : '🌙'}
            </button>
            <button
              className="button-muted"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => signOut({ callbackUrl: '/login' })}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
