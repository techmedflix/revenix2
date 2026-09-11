'use client'

import { useEffect, useState } from 'react'
import { fmtDate } from '@/lib/utils'

type Activity = {
  id: string
  activityType: string
  outcome: string
  notes: string | null
  nextCallDate: string | null
  firstOffer: number | null
  finalOffer: number | null
  stageOverride: string | null
  createdAt: string
  createdBy: {
    id: string
    name: string | null
    email: string
  }
}

type Props = {
  opportunityId: string | null
  open: boolean
  onClose: () => void
}

function titleCase(value: string) {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export default function ActivityDrawer({ opportunityId, open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activities, setActivities] = useState<Activity[]>([])

  useEffect(() => {
    if (!open || !opportunityId) return

    let mounted = true

    async function load() {
      setLoading(true)
      setError('')

      try {
        const res = await fetch(`/api/activities?opportunityId=${opportunityId}`)
        if (!res.ok) {
          throw new Error('Failed to load activity timeline')
        }

        const data = (await res.json()) as Activity[]
        if (mounted) {
          setActivities(data)
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Failed to load activity timeline')
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      mounted = false
    }
  }, [open, opportunityId])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div
        className="modal-card"
        style={{
          marginLeft: 'auto',
          marginRight: 0,
          width: 420,
          maxWidth: '100%',
          height: '100vh',
          maxHeight: '100vh',
          borderRadius: 0,
        }}
      >
        <div className="page-header" style={{ alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Activity Timeline</h3>
            <p className="page-subtitle">Reverse-chronological CRM history.</p>
          </div>
          <button className="button-muted" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? <div className="card">Loading timeline...</div> : null}
        {error ? <div className="error">{error}</div> : null}

        {!loading && !error && activities.length === 0 ? (
          <div className="card">No activity logged for this opportunity.</div>
        ) : null}

        <div className="grid" style={{ marginTop: 10 }}>
          {activities.map((activity) => (
            <div key={activity.id} className="card" style={{ padding: 10 }}>
              <div className="stack" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="badge badge-blue">{titleCase(activity.activityType)}</span>
                <span className="kpi-sub">{fmtDate(activity.createdAt)}</span>
              </div>

              <div className="stack" style={{ marginBottom: 6 }}>
                <span className="badge badge-amber">{titleCase(activity.outcome)}</span>
                {activity.stageOverride ? (
                  <span className="badge badge-green">Stage: {titleCase(activity.stageOverride)}</span>
                ) : null}
              </div>

              {activity.notes ? (
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4, marginBottom: 6 }}>{activity.notes}</div>
              ) : null}

              {activity.nextCallDate ? <div className="kpi-sub">Next call: {fmtDate(activity.nextCallDate)}</div> : null}
              {activity.firstOffer || activity.finalOffer ? (
                <div className="kpi-sub">
                  Offers: {activity.firstOffer ? `First ₹${activity.firstOffer.toLocaleString('en-IN')}` : 'First -'} |{' '}
                  {activity.finalOffer ? `Final ₹${activity.finalOffer.toLocaleString('en-IN')}` : 'Final -'}
                </div>
              ) : null}

              <div className="kpi-sub" style={{ marginTop: 6 }}>
                Logged by: {activity.createdBy.name || activity.createdBy.email}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
