'use client'

import { useState } from 'react'
import { formatApiError } from '@/lib/utils'

type Opportunity = {
  id: string
  account?: { name: string } | null
  projectType: string
  estimatedValue: number
}

type Props = {
  open: boolean
  opportunity: Opportunity | null
  onClose: () => void
  onSaved: () => void
}

export default function LostModal({ open, opportunity, onClose, onSaved }: Props) {
  const [closeRemark, setCloseRemark] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!open || !opportunity) return null

  async function submit() {
    const currentOpportunity = opportunity
    if (!currentOpportunity) return

    setError('')

    if (!closeRemark.trim()) {
      setError('Please explain why this project was lost')
      return
    }

    setSaving(true)

    try {
      const res = await fetch(`/api/opportunities/${currentOpportunity.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leadType: 'lost',
          closeRemark: closeRemark.trim(),
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(formatApiError(payload, 'Failed to mark opportunity as lost'))
        return
      }

      onSaved()
      onClose()
      setCloseRemark('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 600 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Mark as Lost</h3>
        <p className="page-subtitle">
          {opportunity.account?.name || 'Account'} - {opportunity.projectType}
        </p>

        <div className="card" style={{ marginTop: 8, background: 'var(--surface-2)' }}>
          Estimated Value: <strong>₹{opportunity.estimatedValue.toLocaleString('en-IN')}</strong>
        </div>

        <div className="form" style={{ marginTop: 10 }}>
          <label>
            Why was this project lost?
            <textarea
              value={closeRemark}
              onChange={(e) => setCloseRemark(e.target.value)}
              placeholder="Describe the reason for loss (budget, competitor, no decision, etc.)"
              rows={4}
            />
          </label>
        </div>

        {error ? <div className="error">{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="button-muted" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button-primary"
            onClick={submit}
            disabled={saving}
            style={{ background: '#dc2626' }}
          >
            {saving ? 'Saving...' : 'Confirm Lost'}
          </button>
        </div>
      </div>
    </div>
  )
}
