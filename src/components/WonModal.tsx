'use client'

import { useEffect, useState } from 'react'
import { formatApiError } from '@/lib/utils'

type Opportunity = {
  id: string
  account?: { name: string } | null
  projectType: string
  estimatedValue: number
  estimatedCost: number
}

type Props = {
  open: boolean
  opportunity: Opportunity | null
  onClose: () => void
  onSaved: () => void
}

export default function WonModal({ open, opportunity, onClose, onSaved }: Props) {
  const [closedValue, setClosedValue] = useState('')
  const [closedCost, setClosedCost] = useState('')
  const [closeRemark, setCloseRemark] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !opportunity) return
    setClosedValue(String(opportunity.estimatedValue || ''))
    setClosedCost(String(opportunity.estimatedCost || ''))
    setError('')
  }, [open, opportunity])

  if (!open || !opportunity) return null

  async function submit() {
    const currentOpportunity = opportunity
    if (!currentOpportunity) return

    setError('')

    const value = Number(closedValue)
    if (!Number.isFinite(value) || value <= 0) {
      setError('Closed value is required')
      return
    }

    const cost = Number(closedCost) || 0

    setSaving(true)

    try {
      const res = await fetch(`/api/opportunities/${currentOpportunity.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leadType: 'won',
          leadStage: 'commissioned',
          closedValue: value,
          closeRemark: closeRemark.trim(),
          estimatedCost: cost,
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(formatApiError(payload, 'Failed to mark opportunity as won'))
        return
      }

      onSaved()
      onClose()
      setClosedValue('')
      setClosedCost('')
      setCloseRemark('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 600 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Confirm Win</h3>
        <p className="page-subtitle">
          {opportunity.account?.name || 'Account'} - {opportunity.projectType}
        </p>

        <div className="card" style={{ marginTop: 8, background: 'var(--surface-2)' }}>
          Estimated Value: <strong>₹{opportunity.estimatedValue.toLocaleString('en-IN')}</strong>
        </div>

        <div className="form" style={{ marginTop: 10 }}>
          <label>
            Closed Value (INR)
            <input
              type="number"
              min="0"
              value={closedValue}
              onChange={(e) => setClosedValue(e.target.value)}
              placeholder="1060000"
            />
          </label>

          <label>
            Closed Cost (INR)
            <input
              type="number"
              min="0"
              value={closedCost}
              onChange={(e) => setClosedCost(e.target.value)}
              placeholder="0"
            />
          </label>

          <label>
            Close Remark
            <textarea
              value={closeRemark}
              onChange={(e) => setCloseRemark(e.target.value)}
              placeholder="Commercial summary and closure notes"
            />
          </label>
        </div>

        {error ? <div className="error">{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="button-muted" onClick={onClose}>
            Cancel
          </button>
          <button className="button-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : 'Confirm Won'}
          </button>
        </div>
      </div>
    </div>
  )
}
