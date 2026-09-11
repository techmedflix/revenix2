'use client'

import { useEffect, useMemo, useState } from 'react'
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

type Opportunity = {
  id: string
  oppNo?: string | null
  accountId: string
  ownerId: string
  projectCategory: string
  projectType: string
  estimatedValue: number
  estimatedCost: number
  clientType: ClientType | null
  leadType: LeadType | null
  leadStage: LeadStage | null
  probability: number | null
  expectedKickoff: string | null
  clientPocId: string | null
  description: string | null
  medical: boolean
  negotiationReason: string | null
  totalQty: number | null
  unitRevenue: number | null
  unitCost: number | null
}

type Props = {
  open: boolean
  opportunity: Opportunity | null
  accounts: Account[]
  onClose: () => void
  onSaved: () => void
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

export default function EditOpportunityModal({ open, opportunity, accounts, onClose, onSaved }: Props) {
  const { toast } = useToast()
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
  const [initialProbability, setInitialProbability] = useState('')
  const [leadStage, setLeadStage] = useState<LeadStage>('proposal')
  const [expectedKickoff, setExpectedKickoff] = useState('')
  const [clientPocId, setClientPocId] = useState('')
  const [pocs, setPocs] = useState<Poc[]>([])
  const [showAddPoc, setShowAddPoc] = useState(false)
  const [description, setDescription] = useState('')
  const [medical, setMedical] = useState(false)
  const [negotiationReason, setNegotiationReason] = useState('')

  // Inline "add a division under this company" state
  const [extraDivisions, setExtraDivisions] = useState<Account[]>([])
  const [addingDivision, setAddingDivision] = useState(false)
  const [newDivisionInline, setNewDivisionInline] = useState('')
  const [savingDivision, setSavingDivision] = useState(false)

  // Fetched project types from API, with fallback to constants
  const [projectTypeMap, setProjectTypeMap] = useState<Record<string, string[]>>(PROJECT_TYPE_MAP)

  useEffect(() => {
    fetch('/api/project-types')
      .then((r) => r.json())
      .then((data: { categories: Record<string, string[]> }) => {
        if (data.categories && Object.keys(data.categories).length > 0) {
          setProjectTypeMap(data.categories)
        }
      })
      .catch(() => {
        // fall back to hardcoded constants
      })
  }, [])

  useEffect(() => {
    fetch('/api/users/approved')
      .then((r) => r.json())
      .then((data: { id: string; name: string | null; email: string }[]) => setOwners(data || []))
      .catch(() => {})
  }, [])

  // Load POCs whenever the company changes (don't reset the current pick on initial hydration)
  useEffect(() => {
    if (!companyId) { setPocs([]); return }
    fetch(`/api/pocs?accountId=${companyId}`)
      .then((r) => r.json())
      .then((data: Poc[]) => setPocs(data || []))
      .catch(() => setPocs([]))
  }, [companyId])

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

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

  const companies = useMemo(
    () => accounts.filter((a) => a.type === 'company').sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  )

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
    } finally {
      setSavingDivision(false)
    }
  }

  const contribution = (Number(estimatedValue) || 0) - (Number(estimatedCost) || 0)

  // Find company from accountId when editing
  function findCompanyForAccount(accountId: string): string {
    let current = accountById.get(accountId)
    while (current) {
      if (current.type === 'company') return current.id
      current = current.parentId ? accountById.get(current.parentId) : undefined
    }
    return ''
  }

  function findDivisionForAccount(accountId: string): string {
    const acc = accountById.get(accountId)
    if (acc?.type === 'division') return accountId
    return ''
  }

  useEffect(() => {
    if (!open || !opportunity) return

    setOwnerId(opportunity.ownerId)
    setProjectCategory(opportunity.projectCategory)
    setProjectType(opportunity.projectType)
    setEstimatedValue(String(opportunity.estimatedValue))
    setEstimatedCost(String(opportunity.estimatedCost))
    setClientType(opportunity.clientType || 'new')
    setLeadType(opportunity.leadType || null)
    {
      const p = opportunity.probability != null ? String(opportunity.probability) : ''
      setProbability(p)
      setInitialProbability(p)
    }
    setLeadStage(opportunity.leadStage || 'proposal')
    setExpectedKickoff(opportunity.expectedKickoff ? dateOnlyISO(new Date(opportunity.expectedKickoff)) : '')
    setClientPocId(opportunity.clientPocId || '')
    setDescription(opportunity.description || '')
    setMedical(opportunity.medical)
    setNegotiationReason(opportunity.negotiationReason || '')
    setError('')
    setExtraDivisions([])
    setAddingDivision(false)
    setNewDivisionInline('')

    // Figure out company + division
    const compId = findCompanyForAccount(opportunity.accountId)
    setCompanyId(compId)
    const divId = findDivisionForAccount(opportunity.accountId)
    setDivisionId(divId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opportunity])

  if (!open || !opportunity) return null

  const categoryList = Object.keys(projectTypeMap)
  const projectTypeList = projectTypeMap[projectCategory] || []

  async function submit() {
    if (!opportunity) return
    setError('')

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
      const res = await fetch(`/api/opportunities/${opportunity.id}`, {
        method: 'PATCH',
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
          // Only send probability when the user actually changed it — otherwise the server
          // would lock it as a manual override and stop auto-adjusting it on lead-type changes.
          ...(probability !== initialProbability
            ? { probability: probability !== '' ? Number(probability) : null }
            : {}),
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
        const msg = formatApiError(payload, 'Failed to save opportunity')
        setError(msg)
        toast(msg, 'error')
        return
      }

      toast('Opportunity saved!', 'success')
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 960 }}>
        <div className="page-header" style={{ alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Edit Opportunity</h3>
            {opportunity.oppNo ? (
              <p className="page-subtitle" style={{ margin: 0 }}>{opportunity.oppNo}</p>
            ) : null}
          </div>
          <button className="button-muted" onClick={onClose}>Close</button>
        </div>

        <div className="form-grid" style={{ marginTop: 4 }}>
          <label>
            Company *
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value)
                setDivisionId('')
                setAddingDivision(false)
                setNewDivisionInline('')
              }}
            >
              <option value="">Select company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label>
            Division (optional)
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={divisionId} onChange={(e) => setDivisionId(e.target.value)} disabled={!companyId} style={{ flex: 1 }}>
                <option value="">Use company level</option>
                {divisions.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
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
                const cat = e.target.value
                setProjectCategory(cat)
                setProjectType(projectTypeMap[cat]?.[0] || '')
              }}
            >
              {categoryList.map((cat) => (
                <option key={cat} value={cat}>{projectCategoryLabel(cat)}</option>
              ))}
              {/* Show current value if not in list (data from before migration) */}
              {projectCategory && !categoryList.includes(projectCategory) && (
                <option value={projectCategory}>{projectCategoryLabel(projectCategory)}</option>
              )}
            </select>
          </label>

          <label>
            Project Type *
            <select value={projectType} onChange={(e) => setProjectType(e.target.value)}>
              {projectTypeList.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
              {/* Show current value if not in list */}
              {projectType && !projectTypeList.includes(projectType) && (
                <option value={projectType}>{projectType}</option>
              )}
            </select>
          </label>

          <label>
            Revenue (INR) *
            <input
              type="number" min="0" value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
            />
          </label>

          <label>
            Cost (INR)
            <input
              type="number" min="0" value={estimatedCost}
              onChange={(e) => setEstimatedCost(e.target.value)}
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
            {leadStage === 'invoiced' || leadStage === 'partial_invoiced' ? (
              <>
                <input value={LEAD_STAGE_LABEL[leadStage]} disabled />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Use &ldquo;Update Invoicing Status&rdquo; on the Order Book row to change this
                </span>
              </>
            ) : (
              <select value={leadStage} onChange={(e) => setLeadStage(e.target.value as LeadStage)}>
                {MANUAL_LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>
                ))}
              </select>
            )}
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
            Negotiation Notes
            <textarea
              value={negotiationReason}
              onChange={(e) => setNegotiationReason(e.target.value)}
              placeholder="Key commercial context"
              style={{ minHeight: 60 }}
            />
          </label>
        </div>

        {error ? <div className="error" style={{ marginTop: 8 }}>{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="button-muted" onClick={onClose}>Cancel</button>
          <button className="button-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
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
