'use client'

import { useEffect, useMemo, useState } from 'react'
import PocModal, { type Poc, type PocType, POC_TYPE_LABEL } from '@/components/PocModal'
import MultiSelectFilter from '@/components/MultiSelectFilter'
import { formatApiError, maskPhone } from '@/lib/utils'
import { apiFetch } from '@/lib/api-fetch'

type AccountType = 'company' | 'cluster' | 'division' | 'brand'

type Account = {
  id: string
  name: string
  type: AccountType
  parentId: string | null
}

export default function PocsClient() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pocs, setPocs] = useState<Poc[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])

  const [search, setSearch] = useState('')
  const [companyFilters, setCompanyFilters] = useState<Set<string>>(new Set())
  const [therapyAreaFilters, setTherapyAreaFilters] = useState<Set<string>>(new Set())
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set())
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())

  const [showModal, setShowModal] = useState(false)
  const [editingPoc, setEditingPoc] = useState<Poc | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [pocRes, accRes] = await Promise.all([apiFetch('/api/pocs'), apiFetch('/api/accounts')])
      if (!pocRes.ok || !accRes.ok) throw new Error('Failed to load contacts')
      const pocData = (await pocRes.json()) as Poc[]
      const accData = (await accRes.json()) as { accounts: Account[] }
      setPocs(pocData)
      setAccounts(accData.accounts || [])
      setSelectedIds(new Set())
    } catch (err: any) {
      setError(err.message || 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const companies = useMemo(
    () => accounts.filter((a) => a.type === 'company').sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  )

  const therapyAreas = useMemo(
    () => Array.from(new Set(pocs.map((p) => p.therapyArea).filter((v): v is string => !!v))).sort(),
    [pocs],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pocs.filter((p) => {
      if (companyFilters.size > 0 && !companyFilters.has(p.accountId)) return false
      if (therapyAreaFilters.size > 0 && (!p.therapyArea || !therapyAreaFilters.has(p.therapyArea))) return false
      if (typeFilters.size > 0 && (!p.type || !typeFilters.has(p.type))) return false
      if (q) {
        const hay = [p.name, p.account?.name, p.designation, p.division, p.email, p.therapyArea, p.brand, p.molecule]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [pocs, search, companyFilters, therapyAreaFilters, typeFilters])

  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function deletePoc(poc: Poc) {
    if (!confirm(`Delete contact "${poc.name}"?`)) return
    const res = await apiFetch(`/api/pocs/${poc.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      setError(formatApiError(payload, 'Failed to delete contact'))
      return
    }
    load()
  }

  function toggleSelectRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)))
    }
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return
    const confirmed = window.confirm(`Delete ${selectedIds.size} selected contact${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`)
    if (!confirmed) return
    setDeleting(true)
    setError('')
    try {
      const results = await Promise.all(
        Array.from(selectedIds).map(async (id) => {
          const res = await apiFetch(`/api/pocs/${id}`, { method: 'DELETE' })
          if (res.ok) return { id, ok: true as const }
          const payload = await res.json().catch(() => ({}))
          return { id, ok: false as const, message: formatApiError(payload, 'Failed to delete') }
        }),
      )
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        const uniqueMessages = Array.from(new Set(failed.map((r) => (r as { message: string }).message)))
        setError(`${results.length - failed.length} of ${results.length} deleted. ${failed.length} failed: ${uniqueMessages.join(' ')}`)
      }
      setSelectedIds(new Set())
      await load()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Contacts</h1>
        <div className="stack">
          {selectedIds.size > 0 ? (
            <button
              className="button-muted"
              onClick={deleteSelected}
              disabled={deleting}
              style={{ color: '#dc2626', borderColor: '#dc2626' }}
            >
              {deleting ? 'Deleting...' : `Delete Selected (${selectedIds.size})`}
            </button>
          ) : null}
          <button className="button-primary" onClick={() => { setEditingPoc(null); setShowModal(true) }}>
            + Add New POC
          </button>
        </div>
      </div>

      <div className="card toolbar-card">
        <div className="stack" style={{ flexWrap: 'wrap', gap: 10 }}>
          <label>
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, company, designation…"
              style={{ minWidth: 220 }}
            />
          </label>
          <MultiSelectFilter
            label="Company"
            placeholder="All Companies"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            selected={companyFilters}
            onChange={setCompanyFilters}
            minWidth={170}
          />
          <MultiSelectFilter
            label="Therapy Area"
            placeholder="All Therapy Areas"
            options={therapyAreas.map((t) => ({ value: t, label: t }))}
            selected={therapyAreaFilters}
            onChange={setTherapyAreaFilters}
            minWidth={160}
          />
          <MultiSelectFilter
            label="Type"
            placeholder="All Types"
            options={(['medical', 'marketing'] as PocType[]).map((t) => ({ value: t, label: POC_TYPE_LABEL[t] }))}
            selected={typeFilters}
            onChange={setTypeFilters}
            minWidth={140}
          />
        </div>
      </div>

      {loading ? <div className="card">Loading contacts...</div> : null}
      {error ? <div className="error">{error}</div> : null}

      {!loading ? (
        <div className="table-wrap">
          <table style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                    title="Select all"
                  />
                </th>
                <th style={{ minWidth: 160 }}>Name</th>
                <th style={{ minWidth: 160 }}>Company</th>
                <th style={{ minWidth: 140 }}>Designation</th>
                <th style={{ minWidth: 120 }}>Division</th>
                <th style={{ minWidth: 180 }}>Email</th>
                <th style={{ minWidth: 140 }}>Phone</th>
                <th style={{ minWidth: 120 }}>Therapy Area</th>
                <th style={{ minWidth: 120 }}>Brand</th>
                <th style={{ minWidth: 120 }}>Molecule</th>
                <th style={{ minWidth: 90 }}>Type</th>
                <th style={{ minWidth: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                    No contacts found.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} style={selectedIds.has(p.id) ? { background: 'rgba(37, 99, 235, 0.10)' } : undefined}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelectRow(p.id)}
                      />
                    </td>
                    <td style={{ fontWeight: 700 }}>{p.name}</td>
                    <td>{p.account?.name || '—'}</td>
                    <td>{p.designation || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td>{p.division || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td style={{ fontSize: 12 }}>{p.email || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td>
                      {p.phone ? (
                        <button
                          onClick={() => toggleReveal(p.id)}
                          title={revealedIds.has(p.id) ? 'Click to mask' : 'Click to reveal'}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}
                        >
                          {revealedIds.has(p.id) ? p.phone : maskPhone(p.phone)}
                        </button>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>{p.therapyArea || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td>{p.brand || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td>{p.molecule || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td>
                      {p.type ? (
                        <span
                          className={`badge ${p.type === 'medical' ? 'badge-blue' : 'badge-green'}`}
                          style={{ fontSize: 10 }}
                        >
                          {POC_TYPE_LABEL[p.type]}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>
                      <div className="stack" style={{ gap: 5 }}>
                        <button
                          className="icon-btn"
                          onClick={() => { setEditingPoc(p); setShowModal(true) }}
                          title="Edit contact"
                          style={{ padding: '4px 8px', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, background: '#f9fafb' }}
                        >
                          Edit
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => deletePoc(p)}
                          title="Delete contact"
                          style={{ padding: '4px 8px', color: '#dc2626', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 6, background: 'rgba(220,38,38,0.08)' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <PocModal
        open={showModal}
        poc={editingPoc}
        accounts={accounts}
        onClose={() => setShowModal(false)}
        onSaved={load}
      />
    </div>
  )
}
