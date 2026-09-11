'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { PROJECT_TYPE_MAP, projectCategoryLabel } from '@/lib/constants'
import {
  CLIENT_TYPES, CLIENT_TYPE_LABEL, type ClientType,
  LEAD_TYPES, LEAD_TYPE_LABEL, type LeadType,
  LEAD_STAGE_LABEL, MANUAL_LEAD_STAGES, type LeadStage,
} from '@/lib/opportunityStages'
import { dateOnlyISO, formatApiError } from '@/lib/utils'
import { useToast } from '@/lib/ToastContext'
import PocModal, { type Poc } from './PocModal'

type AccountType = 'company' | 'cluster' | 'division' | 'brand'

type Account = {
  id: string
  name: string
  type: AccountType
  parentId: string | null
}

type Props = {
  open: boolean
  accounts: Account[]
  onClose: () => void
  onCreated: () => void
}


function collectDescendantIds(rootId: string, childrenByParent: Map<string, string[]>) {
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

export default function CreateOpportunityModal({ open, accounts, onClose, onCreated }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [companyId, setCompanyId] = useState('')
  const [divisionId, setDivisionId] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [owners, setOwners] = useState<{ id: string; name: string | null; email: string }[]>([])
  const [projectCategory, setProjectCategory] = useState<string>('')
  const [projectType, setProjectType] = useState('')
  const [estimatedValue, setEstimatedValue] = useState('')
  const [estimatedCost, setEstimatedCost] = useState('')
  const [clientType, setClientType] = useState<ClientType>('new')
  const [leadType, setLeadType] = useState<LeadType | null>(null)
  const [probability, setProbability] = useState('')
  const [leadStage, setLeadStage] = useState<LeadStage>('proposal')
  const [expectedKickoff, setExpectedKickoff] = useState('')
  const [clientPocId, setClientPocId] = useState('')
  const [pocs, setPocs] = useState<Poc[]>([])
  const [showAddPoc, setShowAddPoc] = useState(false)
  const [description, setDescription] = useState('')
  const [medical, setMedical] = useState(false)
  const [negotiationReason, setNegotiationReason] = useState('')

  const { toast } = useToast()
  const { data: session } = useSession()
  const currentUserId = (session?.user as any)?.id as string | undefined

  // Inline new company state
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newClusterName, setNewClusterName] = useState('')
  const [newDivisionName, setNewDivisionName] = useState('')
  const [savingAccount, setSavingAccount] = useState(false)

  // Inline "add a division under this company" state
  const [extraDivisions, setExtraDivisions] = useState<Account[]>([])
  const [addingDivision, setAddingDivision] = useState(false)
  const [newDivisionInline, setNewDivisionInline] = useState('')
  const [savingDivision, setSavingDivision] = useState(false)

  // Fetched project types from API, with fallback to constants
  const [projectTypeMap, setProjectTypeMap] = useState<Record<string, string[]>>(PROJECT_TYPE_MAP)

  // Inline "add a project type to this category" state
  const [addingProjectType, setAddingProjectType] = useState(false)
  const [newProjectTypeInline, setNewProjectTypeInline] = useState('')
  const [savingProjectType, setSavingProjectType] = useState(false)

  useEffect(() => {
    fetch('/api/project-types')
      .then((r) => r.json())
      .then((data: { categories: Record<string, string[]> }) => {
        if (data.categories && Object.keys(data.categories).length > 0) {
          setProjectTypeMap(data.categories)
          // Set initial category/type from fetched data
          const firstCat = Object.keys(data.categories)[0]
          setProjectCategory(firstCat)
          setProjectType(data.categories[firstCat][0] || '')
        }
      })
      .catch(() => {
        // fall back to hardcoded constants
        const firstCat = Object.keys(PROJECT_TYPE_MAP)[0]
        setProjectCategory(firstCat)
        setProjectType(PROJECT_TYPE_MAP[firstCat][0] || '')
      })
  }, [])

  useEffect(() => {
    fetch('/api/users/approved')
      .then((r) => r.json())
      .then((data: { id: string; name: string | null; email: string }[]) => setOwners(data || []))
      .catch(() => {})
  }, [])

  // Default the owner to the current user once known (only if not already chosen)
  useEffect(() => {
    if (currentUserId && !ownerId) setOwnerId(currentUserId)
  }, [currentUserId, ownerId])

  // Set initial category/type once projectTypeMap is ready (for the initial render before fetch)
  useEffect(() => {
    if (!projectCategory) {
      const firstCat = Object.keys(projectTypeMap)[0]
      if (firstCat) {
        setProjectCategory(firstCat)
        setProjectType(projectTypeMap[firstCat][0] || '')
      }
    }
  }, [projectTypeMap, projectCategory])

  // Load POCs for the selected company; reset the picked POC when the company changes
  useEffect(() => {
    setClientPocId('')
    if (!companyId) { setPocs([]); return }
    fetch(`/api/pocs?accountId=${companyId}`)
      .then((r) => r.json())
      .then((data: Poc[]) => setPocs(data || []))
      .catch(() => setPocs([]))
  }, [companyId])

  const companies = useMemo(
    () => accounts.filter((a) => a.type === 'company').sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  )

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

  const divisions = useMemo(() => {
    if (!companyId) return []
    const descendantIds = new Set(collectDescendantIds(companyId, childrenByParent))
    const fromTree = accounts.filter((a) => descendantIds.has(a.id) && a.type === 'division')
    const merged = [
      ...fromTree,
      ...extraDivisions.filter((d) => d.parentId === companyId && !fromTree.some((f) => f.id === d.id)),
    ]
    return merged.sort((a, b) => a.name.localeCompare(b.name))
  }, [accounts, childrenByParent, companyId, extraDivisions])

  async function createDivisionInline() {
    const name = newDivisionInline.trim()
    if (!companyId || !name) return
    setSavingDivision(true)
    setError('')
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, type: 'division', parentId: companyId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(formatApiError(data, 'Failed to add division')); return }
      setExtraDivisions((prev) => [...prev, { id: data.id, name: data.name, type: 'division', parentId: companyId }])
      setDivisionId(data.id)
      setNewDivisionInline('')
      setAddingDivision(false)
      onCreated()
    } finally {
      setSavingDivision(false)
    }
  }

  async function createProjectTypeInline() {
    const name = newProjectTypeInline.trim()
    if (!projectCategory || !name) return
    setSavingProjectType(true)
    setError('')
    try {
      const res = await fetch('/api/project-types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: projectCategory, projectType: name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(formatApiError(data, 'Failed to add project type')); return }
      setProjectTypeMap((prev) => {
        const list = prev[projectCategory] || []
        return list.includes(name) ? prev : { ...prev, [projectCategory]: [...list, name] }
      })
      setProjectType(name)
      setNewProjectTypeInline('')
      setAddingProjectType(false)
    } finally {
      setSavingProjectType(false)
    }
  }

  const contribution = (Number(estimatedValue) || 0) - (Number(estimatedCost) || 0)

  function reset() {
    setCompanyId('')
    setDivisionId('')
    setExtraDivisions([])
    setAddingDivision(false)
    setNewDivisionInline('')
    setAddingProjectType(false)
    setNewProjectTypeInline('')
    const firstCat = Object.keys(projectTypeMap)[0] || ''
    setProjectCategory(firstCat)
    setProjectType(projectTypeMap[firstCat]?.[0] || '')
    setEstimatedValue('')
    setEstimatedCost('')
    setClientType('new')
    setLeadType(null)
    setProbability('')
    setLeadStage('proposal')
    setExpectedKickoff('')
    setClientPocId('')
    setPocs([])
    setDescription('')
    setMedical(false)
    setNegotiationReason('')
    setShowNewCompany(false)
    setNewCompanyName('')
    setNewClusterName('')
    setNewDivisionName('')
  }

  if (!open) return null

  async function saveNewAccount() {
    if (!newCompanyName.trim()) { setError('Company name is required'); return }
    setSavingAccount(true)
    setError('')
    try {
      // Create company
      const compRes = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newCompanyName.trim(), type: 'company', parentId: null }),
      })
      if (!compRes.ok) { const d = await compRes.json().catch(() => ({})); setError(formatApiError(d, 'Failed to create company')); return }
      const newComp = await compRes.json()

      if (newClusterName.trim()) {
        const clustRes = await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: newClusterName.trim(), type: 'cluster', parentId: newComp.id }),
        })
        if (!clustRes.ok) { const d = await clustRes.json().catch(() => ({})); setError(formatApiError(d, 'Failed to create cluster')); return }
        const newClust = await clustRes.json()

        if (newDivisionName.trim()) {
          const divRes = await fetch('/api/accounts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: newDivisionName.trim(), type: 'division', parentId: newClust.id }),
          })
          if (!divRes.ok) { const d = await divRes.json().catch(() => ({})); setError(formatApiError(d, 'Failed to create division')); return }
        }
      }

      // Refresh parent accounts list
      onCreated()

      // Set the selected company and reset inline form
      setCompanyId(newComp.id)
      setShowNewCompany(false)
      setNewCompanyName('')
      setNewClusterName('')
      setNewDivisionName('')
    } finally {
      setSavingAccount(false)
    }
  }

  async function submit() {
    setError('')

    if (showNewCompany) {
      setError('Please save the new company first')
      return
    }

    if (!companyId) {
      setError('Company is required')
      return
    }

    if (!description.trim()) {
      setError('Description is required')
      return
    }

    if (!projectCategory) {
      setError('Project category is required')
      return
    }

    if (!projectType) {
      setError('Project type is required')
      return
    }

    if (!leadType) {
      setError('Lead type is required')
      return
    }

    if (estimatedValue.trim() === '') {
      setError('Revenue is required')
      return
    }

    const value = Number(estimatedValue)
    const cost = Number(estimatedCost || '0')

    if (!Number.isFinite(value) || value < 0) {
      setError('Revenue must be a valid number')
      return
    }

    if (!Number.isFinite(cost) || cost < 0) {
      setError('Cost must be a valid number')
      return
    }

    const accountId = divisionId || companyId

    setSaving(true)

    try {
      const res = await fetch('/api/opportunities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountId,
          ownerId: ownerId || undefined,
          projectCategory,
          projectType,
          estimatedValue: value,
          estimatedCost: cost,
          clientType,
          leadType: leadType || null,
          probability: probability !== '' ? Number(probability) : null,
          leadStage,
          expectedKickoff: expectedKickoff ? new Date(`${expectedKickoff}T00:00:00`).toISOString() : null,
          clientPocId: clientPocId || null,
          description: description.trim() || null,
          medical,
          negotiationReason: negotiationReason.trim() || null,
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        const msg = formatApiError(payload, 'Failed to create opportunity')
        setError(msg)
        toast(msg, 'error')
        return
      }

      toast('Opportunity created!', 'success')
      onCreated()
      onClose()
      reset()
    } finally {
      setSaving(false)
    }
  }

  const categoryList = Object.keys(projectTypeMap)
  const projectTypeList = projectTypeMap[projectCategory] || []

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 960 }}>
        <div className="page-header" style={{ alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Create Opportunity</h3>
          <button className="button-muted" onClick={onClose}>Close</button>
        </div>

        <div className="form-grid" style={{ marginTop: 4 }}>
          <label>
            Company *
            {!showNewCompany ? (
              <select
                value={companyId}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setShowNewCompany(true)
                    setCompanyId('')
                  } else {
                    setCompanyId(e.target.value)
                    setDivisionId('')
                    setAddingDivision(false)
                    setNewDivisionInline('')
                  }
                }}
              >
                <option value="">Select company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
                <option value="__new__">+ Add New Company</option>
              </select>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  value={companyId ? companies.find(c => c.id === companyId)?.name || '' : ''}
                  readOnly
                  placeholder="New company (see below)"
                  style={{ flex: 1, background: 'var(--surface-2)', color: 'var(--text-muted)' }}
                />
                <button type="button" className="button-muted" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => setShowNewCompany(false)}>
                  Cancel
                </button>
              </div>
            )}
          </label>

          <label>
            Division (optional)
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={divisionId} onChange={(e) => setDivisionId(e.target.value)} disabled={!companyId} style={{ flex: 1 }}>
                <option value="">Use company level</option>
                {divisions.map((division) => (
                  <option key={division.id} value={division.id}>{division.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="button-muted"
                disabled={!companyId}
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
            Owner
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {owners.map((u) => (
                <option key={u.id} value={u.id}>{u.name || u.email}</option>
              ))}
            </select>
          </label>

          {showNewCompany ? (
            <div style={{ gridColumn: '1 / -1', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: 'var(--text-muted)' }}>New Account Hierarchy</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <label>
                  Company Name *
                  <input
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="e.g. Pfizer India"
                    autoFocus
                  />
                </label>
                <label>
                  Cluster (optional)
                  <input
                    value={newClusterName}
                    onChange={(e) => setNewClusterName(e.target.value)}
                    placeholder="e.g. Oncology"
                  />
                </label>
                <label>
                  Division (optional)
                  <input
                    value={newDivisionName}
                    onChange={(e) => setNewDivisionName(e.target.value)}
                    placeholder="e.g. Solid Tumors"
                    disabled={!newClusterName}
                  />
                </label>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="button-muted" onClick={() => { setShowNewCompany(false); setNewCompanyName(''); setNewClusterName(''); setNewDivisionName('') }}>
                  Cancel
                </button>
                <button type="button" className="button-primary" onClick={saveNewAccount} disabled={savingAccount || !newCompanyName.trim()}>
                  {savingAccount ? 'Saving...' : 'Save Company'}
                </button>
              </div>
            </div>
          ) : null}

          <label>
            Client POC
            <select
              value={clientPocId}
              onChange={(e) => {
                if (e.target.value === '__new__') { setShowAddPoc(true); return }
                setClientPocId(e.target.value)
              }}
              disabled={!companyId}
            >
              <option value="">{companyId ? '— Select POC —' : 'Select a company first'}</option>
              {pocs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.designation ? ` — ${p.designation}` : ''}</option>
              ))}
              {companyId ? <option value="__new__">+ Add New POC</option> : null}
            </select>
          </label>

          <label>
            Medical / Marketing
            <select value={medical ? 'medical' : 'marketing'} onChange={(e) => setMedical(e.target.value === 'medical')}>
              <option value="medical">Medical</option>
              <option value="marketing">Marketing</option>
            </select>
          </label>

          <label>
            Project Category *
            <select
              value={projectCategory}
              onChange={(e) => {
                const category = e.target.value
                setProjectCategory(category)
                setProjectType(projectTypeMap[category]?.[0] || '')
                setAddingProjectType(false)
                setNewProjectTypeInline('')
              }}
            >
              {categoryList.map((category) => (
                <option key={category} value={category}>{projectCategoryLabel(category)}</option>
              ))}
            </select>
          </label>

          <label>
            Project Type *
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={projectType} onChange={(e) => setProjectType(e.target.value)} style={{ flex: 1 }}>
                {projectTypeList.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <button
                type="button"
                className="button-muted"
                disabled={!projectCategory}
                onClick={() => { setAddingProjectType((v) => !v); setNewProjectTypeInline('') }}
                title="Add a new project type to this category"
                style={{ flexShrink: 0, padding: '0 10px' }}
              >
                {addingProjectType ? '×' : '+ New'}
              </button>
            </div>
            {addingProjectType ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  value={newProjectTypeInline}
                  onChange={(e) => setNewProjectTypeInline(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createProjectTypeInline() } }}
                  placeholder={`New type in ${projectCategoryLabel(projectCategory)}`}
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="button-primary"
                  disabled={savingProjectType || !newProjectTypeInline.trim()}
                  onClick={createProjectTypeInline}
                  style={{ flexShrink: 0 }}
                >
                  {savingProjectType ? 'Adding…' : 'Add'}
                </button>
              </div>
            ) : null}
          </label>

          <label>
            Revenue (INR) *
            <input
              type="number" min="0" value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              placeholder="1200000"
            />
          </label>

          <label>
            Cost (INR)
            <input
              type="number" min="0" value={estimatedCost}
              onChange={(e) => setEstimatedCost(e.target.value)}
              placeholder="760000"
            />
          </label>

          <label>
            Contribution (auto)
            <input
              value={contribution.toLocaleString('en-IN')}
              readOnly
              style={{ background: 'var(--surface-2)', color: contribution >= 0 ? '#047857' : '#dc2626', fontWeight: 700 }}
            />
          </label>

          <label>
            Client Type
            <select value={clientType} onChange={(e) => setClientType(e.target.value as ClientType)}>
              {CLIENT_TYPES.map(ct => (
                <option key={ct} value={ct}>{CLIENT_TYPE_LABEL[ct]}</option>
              ))}
            </select>
          </label>

          <label>
            Lead Type *
            <select value={leadType || ''} onChange={(e) => setLeadType((e.target.value as LeadType) || null)}>
              <option value="" disabled>Select lead type...</option>
              {LEAD_TYPES.map(lt => (
                <option key={lt} value={lt}>{LEAD_TYPE_LABEL[lt]}</option>
              ))}
            </select>
          </label>

          <label>
            Probability %
            <input
              type="number" min="0" max="100" step="5" value={probability}
              onChange={(e) => setProbability(e.target.value)}
              placeholder="e.g. 60"
            />
          </label>

          <label>
            Lead Stage
            <select value={leadStage} onChange={(e) => setLeadStage(e.target.value as LeadStage)}>
              {MANUAL_LEAD_STAGES.map((s) => (
                <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>
              ))}
            </select>
          </label>

          <label>
            Expected Kick-off Date
            <input
              type="date"
              value={expectedKickoff}
              onChange={(e) => setExpectedKickoff(e.target.value)}
            />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            Description *
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional project details"
              style={{ minHeight: 60 }}
            />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            Negotiation Notes (optional)
            <textarea
              value={negotiationReason}
              onChange={(e) => setNegotiationReason(e.target.value)}
              placeholder="Any key commercial context"
              style={{ minHeight: 60 }}
            />
          </label>
        </div>

        {error ? <div className="error" style={{ marginTop: 8 }}>{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="button-muted" onClick={onClose}>Cancel</button>
          <button className="button-primary" onClick={submit} disabled={saving}>
            {saving ? 'Creating...' : 'Create Opportunity'}
          </button>
        </div>
      </div>

      <PocModal
        open={showAddPoc}
        poc={null}
        accounts={accounts}
        defaultAccountId={companyId}
        onClose={() => setShowAddPoc(false)}
        onSaved={(created) => {
          setPocs((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
          setClientPocId(created.id)
        }}
      />
    </div>
  )
}
