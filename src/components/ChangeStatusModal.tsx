'use client'

import { useEffect, useMemo, useState } from 'react'
import { fmtDate, formatApiError } from '@/lib/utils'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Receivables',
  overdue: 'Overdue',
  partial: 'Partial',
  gst_pending: 'GST Pending',
  paid: 'Received',
  cancelled: 'Cancelled',
  credit_note: 'Credit Note',
}

type Invoice = {
  id: string
  invNo: string | null
  company: string | null
  clientName: string | null
  status: string
  dueDate: string | null
}

type Props = {
  open: boolean
  invoice: Invoice | null
  /** The status the user picked from the row dropdown — what they're aiming for. */
  targetStatus: 'sent' | 'overdue'
  onClose: () => void
  onSaved: () => void
}

function toISO(dateValue: string) {
  return new Date(`${dateValue}T00:00:00`).toISOString()
}

export default function ChangeStatusModal({ open, invoice, targetStatus, onClose, onSaved }: Props) {
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setDueDate(invoice?.dueDate ? invoice.dueDate.slice(0, 10) : '')
    setError('')
  }, [open, invoice?.id, invoice?.dueDate])

  // Receivables vs Overdue is derived purely from the due date — recompute it live
  // as the user edits the field.
  const computedStatus = useMemo<'sent' | 'overdue'>(() => {
    if (!dueDate) return 'sent'
    return new Date(`${dueDate}T23:59:59`) < new Date() ? 'overdue' : 'sent'
  }, [dueDate])

  if (!open || !invoice) return null

  const originalDue = invoice.dueDate ? invoice.dueDate.slice(0, 10) : ''
  const dueChanged = dueDate !== originalDue
  const hint =
    targetStatus === 'overdue'
      ? 'Set a due date in the past to mark this Overdue.'
      : 'Set a due date on or after today to move this back to Receivables.'

  async function submit() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/invoices/${invoice!.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dueDate: dueDate ? toISO(dueDate) : null }),
      })
      if (!res.ok) {
        const p = await res.json().catch(() => ({}))
        throw new Error(formatApiError(p, 'Failed to update due date'))
      }
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to update due date')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 440 }}>
        <div className="page-header" style={{ alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Receivables / Overdue</h3>
            <p className="page-subtitle">
              {invoice.invNo || invoice.id} — {invoice.company || invoice.clientName || 'Client'}
            </p>
          </div>
          <button className="button-muted" onClick={onClose}>Close</button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          This status is set automatically from the due date. Adjust the due date and the
          status follows. {hint}
        </p>

        <label style={{ marginTop: 8 }}>
          Status
          <input value={STATUS_LABEL[computedStatus]} readOnly disabled
            style={{ fontWeight: 700, color: computedStatus === 'overdue' ? 'var(--red)' : 'var(--primary)' }} />
        </label>

        <label style={{ marginTop: 10 }}>
          Due Date
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
          {dueDate ? `${fmtDate(dueDate)} — ${computedStatus === 'overdue' ? 'past due' : 'not yet due'}` : 'No due date set'}
        </div>

        {error ? <div className="error" style={{ marginTop: 8 }}>{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="button-muted" onClick={onClose}>Cancel</button>
          <button className="button-primary" onClick={submit} disabled={saving || !dueChanged}>
            {saving ? 'Saving…' : 'Save Due Date'}
          </button>
        </div>
      </div>
    </div>
  )
}
