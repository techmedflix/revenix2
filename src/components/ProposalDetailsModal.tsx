'use client'

import { useEffect, useState } from 'react'
import { PROJECT_TYPE_MAP } from '@/lib/constants'
import { formatApiError } from '@/lib/utils'

const LEAD_TYPE_LABELS: Record<string, string> = {
  new: 'New',
  proposal: 'Proposal',
  quote: 'Quote',
  won: 'Won',
}

type Opportunity = {
  id: string
  account?: { name: string } | null
  projectType: string
  projectCategory: string
  estimatedValue: number
  estimatedCost: number
  totalQty: number | null
  unitRevenue: number | null
  unitCost: number | null
}

type Props = {
  open: boolean
  opportunity: Opportunity | null
  targetLeadType: string
  onClose: () => void
  onSaved: () => void
}

export default function ProposalDetailsModal({ open, opportunity, targetLeadType, onClose, onSaved }: Props) {
  const [projectCategory, setProjectCategory] = useState('')
  const [projectType, setProjectType] = useState('')
  const [totalQty, setTotalQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [estimatedValue, setEstimatedValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [projectTypeMap, setProjectTypeMap] = useState<Record<string, string[]>>(PROJECT_TYPE_MAP)

  useEffect(() => {
    fetch('/api/project-types')
      .then(r => r.json())
      .then((data: { categories: Record<string, string[]> }) => {
        if (data.categories && Object.keys(data.categories).length > 0) {
          setProjectTypeMap(data.categories)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!open || !opportunity) return
    setProjectCategory(opportunity.projectCategory || '')
    setProjectType(opportunity.projectType || '')
    setTotalQty(opportunity.totalQty != null ? String(opportunity.totalQty) : '')
    setUnitCost(opportunity.unitCost != null ? String(opportunity.unitCost) : '')
    setEstimatedValue(opportunity.estimatedValue ? String(opportunity.estimatedValue) : '')
    setError('')
  }, [open, opportunity])

  if (!open || !opportunity) return null

  const categoryList = Object.keys(projectTypeMap)
  const projectTypeList = projectTypeMap[projectCategory] || []
  const targetLabel = LEAD_TYPE_LABELS[targetLeadType] || targetLeadType

  async function submit() {
    if (!opportunity) return
    setError('')
    if (!projectCategory || !projectType) {
      setError('Project category and type are required')
      return
    }
    const value = Number(estimatedValue)
    if (!Number.isFinite(value) || value < 0) {
      setError('Project value must be a valid number')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectCategory,
          projectType,
          totalQty: totalQty !== '' ? Number(totalQty) : null,
          unitCost: unitCost !== '' ? Number(unitCost) : null,
          estimatedValue: value || undefined,
          leadType: targetLeadType,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(formatApiError(d, 'Failed to save'))
        return
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget ? onClose() : null}>
      <div className="modal-card" style={{ maxWidth: 560 }}>
        <div className="page-header" style={{ alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17 }}>Moving to <span style={{ color: 'var(--primary)' }}>{targetLabel}</span></h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              {opportunity.account?.name} — fill in project details to continue
            </div>
          </div>
          <button className="button-muted" onClick={onClose}>Cancel</button>
        </div>

        <div className="form-grid" style={{ marginTop: 4 }}>
          <label>
            Project Category <span style={{ color: 'var(--error)', fontSize: 12 }}>*</span>
            <select
              value={projectCategory}
              onChange={e => {
                const cat = e.target.value
                setProjectCategory(cat)
                setProjectType(projectTypeMap[cat]?.[0] || '')
              }}
            >
              <option value="">Select category...</option>
              {categoryList.map(cat => (
                <option key={cat} value={cat}>{cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
              {projectCategory && !categoryList.includes(projectCategory) && (
                <option value={projectCategory}>{projectCategory}</option>
              )}
            </select>
          </label>

          <label>
            Project Type <span style={{ color: 'var(--error)', fontSize: 12 }}>*</span>
            <select value={projectType} onChange={e => setProjectType(e.target.value)} disabled={!projectCategory}>
              <option value="">Select type...</option>
              {projectTypeList.map(t => <option key={t} value={t}>{t}</option>)}
              {projectType && !projectTypeList.includes(projectType) && (
                <option value={projectType}>{projectType}</option>
              )}
            </select>
          </label>

          <label>
            Project Value (INR)
            <input
              type="number" min="0" value={estimatedValue}
              onChange={e => setEstimatedValue(e.target.value)}
              placeholder="e.g. 1000000"
            />
          </label>

          <label>
            Total Qty (units)
            <input
              type="number" min="0" step="1" value={totalQty}
              onChange={e => setTotalQty(e.target.value)}
              placeholder="e.g. 10 webinars"
            />
          </label>

          <label>
            Unit Cost (INR)
            <input
              type="number" min="0" step="0.01" value={unitCost}
              onChange={e => setUnitCost(e.target.value)}
              placeholder="e.g. 40000"
            />
          </label>
        </div>

        {error ? <div className="error" style={{ marginTop: 10 }}>{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="button-muted" onClick={onClose}>Cancel</button>
          <button className="button-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : `Save & Move to ${targetLabel}`}
          </button>
        </div>
      </div>
    </div>
  )
}
