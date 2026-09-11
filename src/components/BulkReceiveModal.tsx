'use client'

import { useEffect, useMemo, useState } from 'react'
import { dateOnlyISO, fmtDate, formatApiError } from '@/lib/utils'

type Invoice = {
  id: string
  invNo: string | null
  company: string | null
  clientName: string | null
  docType: string
  status: string
  amt: number
  amountReceived: number
}

export type BulkReceiveResult = {
  succeeded: number
  failed: number
  failMessages: string[]
}

type Props = {
  open: boolean
  invoices: Invoice[]
  onClose: () => void
  onComplete: (result: BulkReceiveResult) => void
}

const NON_RECEIVABLE_DOC_TYPES = ['PI', 'QUOTE']
const CLOSED_STATUSES = ['paid', 'cancelled', 'credit_note']

function toISO(dateValue: string) {
  return new Date(`${dateValue}T00:00:00`).toISOString()
}

function fmt(n: number) {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export default function BulkReceiveModal({ open, invoices, onClose, onComplete }: Props) {
  const [receivedDate, setReceivedDate] = useState(dateOnlyISO(new Date()))
  const [tdsPreset, setTdsPreset] = useState<'0' | '2' | '10' | 'other'>('0')
  const [customTds, setCustomTds] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setReceivedDate(dateOnlyISO(new Date()))
    setTdsPreset('0')
    setCustomTds('')
    setError('')
  }, [open])

  const { eligible, skipped } = useMemo(() => {
    const eligible: Array<Invoice & { pending: number }> = []
    const skipped: Invoice[] = []
    for (const inv of invoices) {
      const pending = Math.max(0, inv.amt - inv.amountReceived)
      const receivable =
        !NON_RECEIVABLE_DOC_TYPES.includes(inv.docType) &&
        !CLOSED_STATUSES.includes(inv.status) &&
        pending > 0.5
      if (receivable) eligible.push({ ...inv, pending })
      else skipped.push(inv)
    }
    return { eligible, skipped }
  }, [invoices])

  const tdsPercent = useMemo(() => {
    if (tdsPreset === 'other') {
      const v = Number(customTds)
      return Number.isFinite(v) ? Math.max(0, v) : 0
    }
    return Number(tdsPreset)
  }, [customTds, tdsPreset])

  const totalPending = eligible.reduce((s, i) => s + i.pending, 0)

  if (!open) return null

  async function submit() {
    if (eligible.length === 0) return
    setSaving(true)
    setError('')
    const results = await Promise.all(
      eligible.map(async (inv) => {
        try {
          const res = await fetch(`/api/invoices/${inv.id}/receive`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              receiptType: 'full',
              receivedDate: toISO(receivedDate),
              tdsPercent,
              gstWithheld: false,
            }),
          })
          if (res.ok) return { ok: true as const }
          const p = await res.json().catch(() => ({}))
          return { ok: false as const, message: formatApiError(p, `${inv.invNo || inv.id}: failed`) }
        } catch {
          return { ok: false as const, message: `${inv.invNo || inv.id}: network error` }
        }
      }),
    )
    setSaving(false)
    const failed = results.filter((r) => !r.ok) as Array<{ ok: false; message: string }>
    onComplete({
      succeeded: results.length - failed.length,
      failed: failed.length,
      failMessages: Array.from(new Set(failed.map((r) => r.message))),
    })
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 560 }}>
        <div className="page-header" style={{ alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Mark Received — {eligible.length} invoice{eligible.length !== 1 ? 's' : ''}</h3>
            <p className="page-subtitle">Books a full receipt for the pending amount of each invoice below.</p>
          </div>
          <button className="button-muted" onClick={onClose}>Close</button>
        </div>

        <div className="form-grid" style={{ marginTop: 10 }}>
          <label>
            Received Date
            <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </label>
          <label>
            TDS %
            <select value={tdsPreset} onChange={(e) => setTdsPreset(e.target.value as '0' | '2' | '10' | 'other')}>
              <option value="0">0%</option>
              <option value="2">2%</option>
              <option value="10">10%</option>
              <option value="other">Other</option>
            </select>
          </label>
          {tdsPreset === 'other' ? (
            <label>
              Custom TDS %
              <input type="number" min="0" value={customTds} onChange={(e) => setCustomTds(e.target.value)} />
            </label>
          ) : null}
        </div>

        <div style={{ marginTop: 12, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoice #</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client</th>
                <th style={{ textAlign: 'right', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pending</th>
              </tr>
            </thead>
            <tbody>
              {eligible.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ padding: '6px 10px' }}>{inv.invNo || '—'}</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{inv.company || inv.clientName || '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{fmt(inv.pending)}</td>
                </tr>
              ))}
              {eligible.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: '10px', textAlign: 'center', color: 'var(--text-muted)' }}>No eligible invoices in the selection.</td></tr>
              ) : null}
            </tbody>
            {eligible.length > 0 ? (
              <tfoot>
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <td colSpan={2} style={{ padding: '6px 10px', fontWeight: 700 }}>Total</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>{fmt(totalPending)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        {skipped.length > 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            {skipped.length} selected invoice{skipped.length !== 1 ? 's' : ''} skipped (already received, cancelled, a credit note, a proforma/quote, or nothing pending).
          </div>
        ) : null}

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          Received on {fmtDate(receivedDate)}{tdsPercent > 0 ? ` · TDS ${tdsPercent}% on each` : ''}.
        </div>

        {error ? <div className="error" style={{ marginTop: 8 }}>{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="button-muted" onClick={onClose}>Cancel</button>
          <button className="button-primary" onClick={submit} disabled={saving || eligible.length === 0}>
            {saving ? 'Booking…' : `Mark ${eligible.length} Received`}
          </button>
        </div>
      </div>
    </div>
  )
}
