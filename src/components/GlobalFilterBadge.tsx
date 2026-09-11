'use client'

import { useGlobalFilters } from '@/lib/GlobalFiltersContext'

/**
 * Shows the currently active sidebar FY + Entity filters as a compact banner
 * so users know what context they're viewing without looking at the sidebar.
 */
export default function GlobalFilterBadge() {
  const { entity, fy } = useGlobalFilters()
  if (!entity && !fy) return null
  return (
    <div
      style={{
        display: 'inline-flex',
        gap: 6,
        alignItems: 'center',
        background: '#f0f7ff',
        border: '1px solid #bfdbfe',
        borderRadius: 8,
        padding: '4px 10px',
        marginBottom: 12,
      }}
    >
      <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Viewing
      </span>
      {fy ? (
        <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, background: '#2563eb', color: '#fff', fontWeight: 700 }}>
          {fy.replace('FY ', 'FY ')}
        </span>
      ) : null}
      {entity ? (
        <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, background: '#7c3aed', color: '#fff', fontWeight: 700 }}>
          {entity}
        </span>
      ) : null}
    </div>
  )
}
