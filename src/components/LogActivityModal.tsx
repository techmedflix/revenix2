'use client'

import { useEffect, useMemo, useState } from 'react'
import { LEAD_STAGES, LEAD_STAGE_LABEL, LEAD_TYPES, LEAD_TYPE_LABEL } from '@/lib/opportunityStages'
import { addBusinessDays, dateOnlyISO, fmtDate, formatApiError } from '@/lib/utils'
import { useToast } from '@/lib/ToastContext'

type Opportunity = {
  id: string
  projectType: string
  stage: string
  leadStage: string | null
  leadType: string | null
  account: { name: string } | null
  description?: string | null
  estimatedCost: number
}

type Props = {
  open: boolean
  opportunities: Opportunity[]
  preselectedOpportunityId?: string | null
  onClose: () => void
  onLogged: () => void
}

const ACTIVITY_OPTIONS = [
  { value: 'call_attempted', label: 'Call Attempted' },
  { value: 'call_connected', label: 'Call Connected' },
  { value: 'meeting_scheduled', label: 'Meeting Scheduled' },
  { value: 'meeting_done', label: 'Meeting Done' },
  { value: 'proposal_sent', label: 'Proposal Sent' },
  { value: 'proposal_revised', label: 'Proposal Revised' },
  { value: 'po_received', label: 'PO Received' },
] as const

const OUTCOME_OPTIONS = [
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'budget_issue', label: 'Budget Issue' },
  { value: 'no_response', label: 'No Response' },
  { value: 'escalated', label: 'Escalated' },
] as const

const LEAD_STAGE_OPTIONS = [
  { value: '', label: 'Auto' },
  ...LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABEL[s] })),
]

const LEAD_TYPE_OPTIONS = [
  { value: '', label: 'Auto' },
  ...LEAD_TYPES.map((t) => ({ value: t, label: LEAD_TYPE_LABEL[t] })),
]

function toISO(dateValue: string | null) {
  if (!dateValue) return null
  return new Date(`${dateValue}T00:00:00`).toISOString()
}

export default function LogActivityModal({
  open,
  opportunities,
  preselectedOpportunityId,
  onClose,
  onLogged,
}: Props) {
  const { toast } = useToast()
  const [opportunityId, setOpportunityId] = useState('')
  const [activityType, setActivityType] = useState<(typeof ACTIVITY_OPTIONS)[number]['value']>('call_attempted')
  const [outcome, setOutcome] = useState<(typeof OUTCOME_OPTIONS)[number]['value']>('positive')
  const [notes, setNotes] = useState('')
  const [nextCallDate, setNextCallDate] = useState('')
  const [firstOffer, setFirstOffer] = useState('')
  const [finalOffer, setFinalOffer] = useState('')
  const [stageOverride, setStageOverride] = useState('')
  const [leadTypeOverride, setLeadTypeOverride] = useState('')
  const [closedValue, setClosedValue] = useState('')
  const [closedCost, setClosedCost] = useState('')
  const [closeRemark, setCloseRemark] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isCallActivity = activityType === 'call_attempted' || activityType === 'call_connected'
  const isProposalActivity = activityType === 'proposal_sent' || activityType === 'proposal_revised'
  const requiresWonData = leadTypeOverride === 'won' || activityType === 'po_received'
  const requiresCloseData = requiresWonData || leadTypeOverride === 'lost'

  const selectedOpportunity = useMemo(
    () => opportunities.find((row) => row.id === opportunityId) || null,
    [opportunities, opportunityId],
  )

  useEffect(() => {
    if (!open) return
    setOpportunityId(preselectedOpportunityId || opportunities[0]?.id || '')
  }, [open, opportunities, preselectedOpportunityId])

  useEffect(() => {
    if (!selectedOpportunity) return
    setStageOverride(selectedOpportunity.leadStage || '')
    setLeadTypeOverride(selectedOpportunity.leadType || '')
    setClosedCost(String(selectedOpportunity.estimatedCost || ''))
  }, [selectedOpportunity])

  useEffect(() => {
    if (!open || !isCallActivity) return
    if (nextCallDate) return
    const defaultDate = dateOnlyISO(addBusinessDays(new Date(), 3))
    setNextCallDate(defaultDate)
  }, [isCallActivity, nextCallDate, open])

  if (!open) return null

  async function submit() {
    setError('')

    if (!opportunityId) {
      setError('Select an opportunity')
      return
    }

    if (requiresWonData && !closedValue) {
      setError('Closed value is required for won update')
      return
    }

    setSaving(true)

    const payload = {
      opportunityId,
      activityType,
      outcome,
      notes: notes.trim() || null,
      nextCallDate: isCallActivity ? toISO(nextCallDate || dateOnlyISO(addBusinessDays(new Date(), 3))) : null,
      firstOffer: isProposalActivity && firstOffer ? Number(firstOffer) : null,
      finalOffer: isProposalActivity && finalOffer ? Number(finalOffer) : null,
      stageOverride: stageOverride || null,
      leadTypeOverride: leadTypeOverride || null,
      closedValue: requiresWonData ? Number(closedValue) : null,
      estimatedCost: requiresWonData ? Number(closedCost) : null,
      closeRemark: requiresCloseData ? closeRemark.trim() : null,
    }

    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        const fallback = typeof payload.message === 'string' ? payload.message : 'Failed to log activity'
        const msg = formatApiError(payload, fallback)
        setError(msg)
        toast(msg, 'error')
        return
      }

      toast('Activity logged!', 'success')
      onLogged()
      onClose()

      setNotes('')
      setNextCallDate('')
      setFirstOffer('')
      setFinalOffer('')
      setStageOverride('')
      setLeadTypeOverride('')
      setClosedValue('')
      setClosedCost('')
      setCloseRemark('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 860 }}>
        <div className="page-header" style={{ alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Log CRM Activity</h3>
            <p className="page-subtitle">Keep the opportunity timeline complete and searchable.</p>
          </div>
          <button className="button-muted" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="form-grid" style={{ marginTop: 12 }}>
          <label style={{ gridColumn: 'span 2' }}>
            Opportunity
            <select value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
              <option value="">Select opportunity</option>
              {opportunities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.account?.name || 'Account'} - {row.projectType}{row.description ? ` | ${row.description.slice(0, 40)}` : ''} ({row.stage})
                </option>
              ))}
            </select>
          </label>

          <label>
            Activity Type
            <select
              value={activityType}
              onChange={(e) => {
                const nextType = e.target.value as (typeof ACTIVITY_OPTIONS)[number]['value']
                setActivityType(nextType)
                if ((nextType === 'call_attempted' || nextType === 'call_connected') && !nextCallDate) {
                  setNextCallDate(dateOnlyISO(addBusinessDays(new Date(), 3)))
                }
              }}
            >
              {ACTIVITY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Outcome
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as (typeof OUTCOME_OPTIONS)[number]['value'])}>
              {OUTCOME_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Lead Stage Override
            <select value={stageOverride} onChange={(e) => setStageOverride(e.target.value)}>
              {LEAD_STAGE_OPTIONS.map((item) => (
                <option key={item.value || 'auto'} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Lead Type Override
            <select value={leadTypeOverride} onChange={(e) => setLeadTypeOverride(e.target.value)}>
              {LEAD_TYPE_OPTIONS.map((item) => (
                <option key={item.value || 'auto'} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {isCallActivity ? (
            <label>
              Next Call Date
              <input type="date" value={nextCallDate} onChange={(e) => setNextCallDate(e.target.value)} />
            </label>
          ) : null}

          {isProposalActivity ? (
            <>
              <label>
                First Offer (INR)
                <input type="number" min="0" value={firstOffer} onChange={(e) => setFirstOffer(e.target.value)} />
              </label>
              <label>
                Final Offer (INR)
                <input type="number" min="0" value={finalOffer} onChange={(e) => setFinalOffer(e.target.value)} />
              </label>
            </>
          ) : null}

          {requiresWonData ? (
            <>
              <label>
                Closed Value (INR)
                <input type="number" min="0" value={closedValue} onChange={(e) => setClosedValue(e.target.value)} />
              </label>
              <label>
                Closed Cost (INR)
                <input type="number" min="0" value={closedCost} onChange={(e) => setClosedCost(e.target.value)} />
              </label>
            </>
          ) : null}
        </div>

        {selectedOpportunity ? (
          <div className="card" style={{ marginTop: 8, padding: 10, background: 'var(--surface-2)' }}>
            <strong>{selectedOpportunity.account?.name || 'Account'}</strong> - {selectedOpportunity.projectType} | Current stage:{' '}
            <span className="badge badge-blue">{selectedOpportunity.stage}</span>
            {isCallActivity ? (
              <div className="kpi-sub">Suggested callback: {fmtDate(addBusinessDays(new Date(), 3))}</div>
            ) : null}
          </div>
        ) : null}

        <label style={{ marginTop: 10 }}>
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Key context, stakeholder reactions, blockers"
          />
        </label>

        {requiresCloseData ? (
          <label style={{ marginTop: 10 }}>
            Close Remark
            <textarea
              value={closeRemark}
              onChange={(e) => setCloseRemark(e.target.value)}
              placeholder="Why won/lost and commercial summary"
            />
          </label>
        ) : null}

        {error ? <div className="error">{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="button-muted" onClick={onClose}>
            Cancel
          </button>
          <button className="button-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : 'Save Activity'}
          </button>
        </div>
      </div>
    </div>
  )
}
