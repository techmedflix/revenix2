'use client'

import { useEffect, useMemo, useState } from 'react'
import { useToast } from '@/lib/ToastContext'
import { formatApiError } from '@/lib/utils'

type AccountType = 'company' | 'cluster' | 'division' | 'brand'

type Account = {
  id: string
  name: string
  type: AccountType
  parentId: string | null
}

export type PocType = 'medical' | 'marketing'

export const POC_TYPE_LABEL: Record<PocType, string> = {
  medical: 'Medical',
  marketing: 'Marketing',
}

export type Poc = {
  id: string
  name: string
  accountId: string
  email: string | null
  phone: string | null
  designation: string | null
  division: string | null
  therapyArea: string | null
  brand: string | null
  molecule: string | null
  type: PocType | null
  account?: { id: string; name: string } | null
}

type Props = {
  open: boolean
  poc: Poc | null
  accounts: Account[]
  defaultAccountId?: string
  onClose: () => void
  onSaved: (poc: Poc) => void
}

export default function PocModal({ open, poc, accounts, defaultAccountId, onClose, onSaved }: Props) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [designation, setDesignation] = useState('')
  const [division, setDivision] = useState('')
  const [extraDivisions, setExtraDivisions] = useState<Account[]>([])
  const [addingDivision, setAddingDivision] = useState(false)
  const [newDivisionInline, setNewDivisionInline] = useState('')
  const [savingDivision, setSavingDivision] = useState(false)
  const [therapyArea, setTherapyArea] = useState('')
  const [brand, setBrand] = useState('')
  const [molecule, setMolecule] = useState('')
  const [type, setType] = useState<PocType | ''>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Distinct existing values, fetched fresh whenever the modal opens — powers the
  // autocomplete suggestions on Therapy Area / Brand / Molecule (freeform, not a fixed list).
  const [allPocs, setAllPocs] = useState<Poc[]>([])

  const companies = accounts
    .filter((a) => a.type === 'company')
    .sort((a, b) => a.name.localeCompare(b.name))

  const childrenByParent = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const row of accounts) {
      if (!row.parentId) continue
      const list = map.get(row.parentId) || []
      list.push(row.id)
      map.set(row.parentId, list)
    }
    return map
  }, [accounts])

  function collectDescendantIds(rootId: string): string[] {
    const ids: string[] = []
    const stack = [rootId]
    while (stack.length) {
      const id = stack.pop()!
      const children = childrenByParent.get(id) || []
      for (const childId of children) {
        ids.push(childId)
        stack.push(childId)
      }
    }
    return ids
  }

  // Divisions under the selected company, from the real Account hierarchy — not free text.
  const divisions = useMemo(() => {
    if (!accountId) return []
    const descendantIds = new Set(collectDescendantIds(accountId))
    const fromTree = accounts.filter((a) => descendantIds.has(a.id) && a.type === 'division')
    const merged = [
      ...fromTree,
      ...extraDivisions.filter((d) => d.parentId === accountId && !fromTree.some((f) => f.id === d.id)),
    ]
    return merged.sort((a, b) => a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, childrenByParent, accountId, extraDivisions])

  async function createDivisionInline() {
    const nm = newDivisionInline.trim()
    if (!accountId || !nm) return
    setSavingDivision(true)
    setError('')
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nm, type: 'division', parentId: accountId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(formatApiError(data, 'Failed to add division')); return }
      setExtraDivisions((prev) => [...prev, { id: data.id, name: data.name, type: 'division', parentId: accountId }])
      setDivision(data.name)
      setNewDivisionInline('')
      setAddingDivision(false)
    } finally {
      setSavingDivision(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setName(poc?.name || '')
    setAccountId(poc?.accountId || defaultAccountId || '')
    setEmail(poc?.email || '')
    setPhone(poc?.phone || '')
    setDesignation(poc?.designation || '')
    setDivision(poc?.division || '')
    setTherapyArea(poc?.therapyArea || '')
    setBrand(poc?.brand || '')
    setMolecule(poc?.molecule || '')
    setType(poc?.type || '')
    setError('')
    setExtraDivisions([])
    setAddingDivision(false)
    setNewDivisionInline('')

    fetch('/api/pocs')
      .then((r) => r.json())
      .then((data: Poc[]) => setAllPocs(data || []))
      .catch(() => setAllPocs([]))
  }, [open, poc, defaultAccountId])

  const therapyAreaOptions = useMemo(
    () => Array.from(new Set(allPocs.map((p) => p.therapyArea).filter((v): v is string => !!v))).sort(),
    [allPocs],
  )
  const brandOptions = useMemo(
    () => Array.from(new Set(allPocs.map((p) => p.brand).filter((v): v is string => !!v))).sort(),
    [allPocs],
  )
  const moleculeOptions = useMemo(
    () => Array.from(new Set(allPocs.map((p) => p.molecule).filter((v): v is string => !!v))).sort(),
    [allPocs],
  )

  if (!open) return null

  async function submit() {
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    if (!accountId) { setError('Company is required'); return }

    setSaving(true)
    try {
      const res = await fetch(poc ? `/api/pocs/${poc.id}` : '/api/pocs', {
        method: poc ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          accountId,
          email: email.trim() || null,
          phone: phone.trim() || null,
          designation: designation.trim() || null,
          division: division.trim() || null,
          therapyArea: therapyArea.trim() || null,
          brand: brand.trim() || null,
          molecule: molecule.trim() || null,
          type: type || null,
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        const msg = formatApiError(payload, 'Failed to save POC')
        setError(msg)
        toast(msg, 'error')
        return
      }
      const saved = await res.json()
      toast(poc ? 'POC updated!' : 'POC added!', 'success')
      onSaved(saved)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 560 }}>
        <div className="page-header" style={{ alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{poc ? 'Edit POC' : 'Add New POC'}</h3>
          <button className="button-muted" onClick={onClose}>Close</button>
        </div>

        <div className="form-grid" style={{ marginTop: 4 }}>
          <label>
            Name *
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact person name" autoFocus />
          </label>
          <label>
            Company *
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setDivision(''); setAddingDivision(false); setNewDivisionInline('') }}>
              <option value="">Select company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Designation
            <input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Brand Manager" />
          </label>
          <label>
            Division
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={division} onChange={(e) => setDivision(e.target.value)} disabled={!accountId} style={{ flex: 1 }}>
                <option value="">{accountId ? 'Use company level' : 'Select a company first'}</option>
                {divisions.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
                {/* Preserve an existing free-text value that predates the account hierarchy link */}
                {division && !divisions.some((d) => d.name === division) && (
                  <option value={division}>{division}</option>
                )}
              </select>
              <button
                type="button"
                className="button-muted"
                disabled={!accountId}
                onClick={() => { setAddingDivision((v) => !v); setNewDivisionInline('') }}
                title="Add a new division under this company"
                style={{ flexShrink: 0, padding: '0 10px' }}
              >
                {addingDivision ? '×' : '+ New'}
              </button>
            </div>
            {addingDivision ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  value={newDivisionInline}
                  onChange={(e) => setNewDivisionInline(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createDivisionInline() } }}
                  placeholder="New division name"
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="button-primary"
                  disabled={savingDivision || !newDivisionInline.trim()}
                  onClick={createDivisionInline}
                  style={{ flexShrink: 0 }}
                >
                  {savingDivision ? 'Adding…' : 'Add'}
                </button>
              </div>
            ) : null}
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </label>
          <label>
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
          </label>
          <label>
            Therapy Area
            <input
              value={therapyArea}
              onChange={(e) => setTherapyArea(e.target.value)}
              placeholder="e.g. Oncology"
              list="poc-therapy-area-options"
            />
            <datalist id="poc-therapy-area-options">
              {therapyAreaOptions.map((v) => <option key={v} value={v} />)}
            </datalist>
          </label>
          <label>
            Brand
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g. Humira"
              list="poc-brand-options"
            />
            <datalist id="poc-brand-options">
              {brandOptions.map((v) => <option key={v} value={v} />)}
            </datalist>
          </label>
          <label>
            Molecule
            <input
              value={molecule}
              onChange={(e) => setMolecule(e.target.value)}
              placeholder="e.g. Adalimumab"
              list="poc-molecule-options"
            />
            <datalist id="poc-molecule-options">
              {moleculeOptions.map((v) => <option key={v} value={v} />)}
            </datalist>
          </label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as PocType | '')}>
              <option value="">— Unset —</option>
              <option value="medical">Medical</option>
              <option value="marketing">Marketing</option>
            </select>
          </label>
        </div>

        {error ? <div className="error" style={{ marginTop: 8 }}>{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="button-muted" onClick={onClose}>Cancel</button>
          <button className="button-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : poc ? 'Save Changes' : 'Add POC'}
          </button>
        </div>
      </div>
    </div>
  )
}
