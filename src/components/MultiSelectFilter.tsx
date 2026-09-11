'use client'

import { useEffect, useRef, useState } from 'react'

type Option = { value: string; label: string }

type Props = {
  label: string
  placeholder: string
  options: Option[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  minWidth?: number
}

export default function MultiSelectFilter({ label, placeholder, options, selected, onChange, minWidth = 150 }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  const summary =
    selected.size === 0
      ? placeholder
      : selected.size === 1
        ? options.find((o) => o.value === [...selected][0])?.label || placeholder
        : `${selected.size} selected`

  const visibleOptions = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth }}>
      <label style={{ display: 'block' }}>
        {label}
        <button
          type="button"
          className="button-muted"
          onClick={() => setOpen((v) => !v)}
          style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
          <span style={{ marginLeft: 6, opacity: 0.6 }}>▾</span>
        </button>
      </label>

      {open ? (
        <div
          className="card"
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20,
            minWidth: '100%', maxHeight: 260, overflowY: 'auto', padding: 8,
          }}
        >
          {options.length > 6 ? (
            <input
              type="text"
              autoFocus
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', marginBottom: 6, fontSize: 12, padding: '4px 6px' }}
            />
          ) : null}
          {selected.size > 0 ? (
            <button
              type="button"
              className="button-muted"
              style={{ fontSize: 11, marginBottom: 6, width: '100%' }}
              onClick={() => onChange(new Set())}
            >
              Clear
            </button>
          ) : null}
          {options.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 4 }}>No values yet</div>
          ) : visibleOptions.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 4 }}>No matches</div>
          ) : (
            visibleOptions.map((opt) => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px', cursor: 'pointer', fontWeight: 400 }}>
                <input type="checkbox" checked={selected.has(opt.value)} onChange={() => toggle(opt.value)} />
                <span style={{ fontSize: 13 }}>{opt.label}</span>
              </label>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
