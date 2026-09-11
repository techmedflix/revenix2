'use client'

import { useEffect, useMemo, useState } from 'react'
import { dateOnlyISO, fmtDate, formatApiError } from '@/lib/utils'

type Receipt = {
  id: string
  amountReceived: number
  receivedDate: string
  tdsPercent: number
  tdsAmount: number
  gstWithheld: boolean
  gstWithheldAmount: number
  netToBank: number
  notes: string | null
}

type Invoice = {
  id: string
  invNo: string | null
  company: string | null
  net: number
  gst: number
  amt: number
  amountReceived: number
  /** TDS % estimated when the invoice was raised — seeds the new-receipt form. */
  tdsPercent?: number | null
}

type Props = {
  open: boolean
  invoice: Invoice | null
  receipts: Receipt[]
  /** Pre-tick "GST Withheld" on the new-receipt form (e.g. opened via the GST Pending status). */
  defaultGstWithheld?: boolean
  onClose: () => void
  onSaved: () => void
}

function toISO(dateValue: string) {
  return new Date(`${dateValue}T00:00:00`).toISOString()
}

function fmt(n: number) {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export default function MarkReceivedModal({ open, invoice, receipts, defaultGstWithheld = false, onClose, onSaved }: Props) {
  // --- New receipt form state ---
  const [receiptType, setReceiptType] = useState<'full' | 'partial'>('full')
  const [partialAmount, setPartialAmount] = useState('')
  const [receivedDate, setReceivedDate] = useState(dateOnlyISO(new Date()))
  const [tdsPreset, setTdsPreset] = useState<'0' | '2' | '10' | 'other'>('0')
  const [customTds, setCustomTds] = useState('')
  const [gstWithheld, setGstWithheld] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset the new-receipt form each time the modal opens for an invoice, seeding
  // "GST Withheld" from the caller (the GST Pending status opens it pre-ticked).
  useEffect(() => {
    if (!open) return
    setReceiptType('full')
    setPartialAmount('')
    setReceivedDate(dateOnlyISO(new Date()))
    // Seed TDS from the estimate captured when the invoice was raised (editable here).
    const seededTds = invoice?.tdsPercent ?? 0
    const seededStr = String(seededTds)
    if (['0', '2', '10'].includes(seededStr)) {
      setTdsPreset(seededStr as '0' | '2' | '10')
      setCustomTds('')
    } else if (seededTds > 0) {
      setTdsPreset('other')
      setCustomTds(seededStr)
    } else {
      setTdsPreset('0')
      setCustomTds('')
    }
    setGstWithheld(defaultGstWithheld)
    setNotes('')
    setError('')
    setEditingId(null)
  }, [open, invoice?.id, invoice?.tdsPercent, defaultGstWithheld])

  // --- Edit receipt state ---
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTdsPreset, setEditTdsPreset] = useState<'0' | '2' | '10' | 'other'>('0')
  const [editCustomTds, setEditCustomTds] = useState('')
  const [editGstWithheld, setEditGstWithheld] = useState(false)
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const pending = useMemo(() => {
    if (!invoice) return 0
    return Math.max(0, invoice.amt - invoice.amountReceived)
  }, [invoice])

  const effectiveTdsPercent = useMemo(() => {
    if (tdsPreset === 'other') {
      const v = Number(customTds)
      return Number.isFinite(v) ? Math.max(0, v) : 0
    }
    return Number(tdsPreset)
  }, [customTds, tdsPreset])

  const receivedAmount = useMemo(() => {
    if (!invoice) return 0
    if (receiptType === 'full') return pending
    const v = Number(partialAmount)
    return Number.isFinite(v) ? v : 0
  }, [invoice, partialAmount, pending, receiptType])

  const tdsAmount = useMemo(() => {
    if (!invoice || invoice.amt <= 0) return 0
    return (receivedAmount * invoice.net) / invoice.amt * (effectiveTdsPercent / 100)
  }, [effectiveTdsPercent, invoice, receivedAmount])

  const gstWithheldAmount = useMemo(() => {
    if (!invoice || !gstWithheld || invoice.amt <= 0) return 0
    return (receivedAmount * invoice.gst) / invoice.amt
  }, [gstWithheld, invoice, receivedAmount])

  const netToBank = Math.max(0, receivedAmount - tdsAmount - gstWithheldAmount)

  // Edit form computed values
  const editEffectiveTds = useMemo(() => {
    if (editTdsPreset === 'other') {
      const v = Number(editCustomTds)
      return Number.isFinite(v) ? Math.max(0, v) : 0
    }
    return Number(editTdsPreset)
  }, [editCustomTds, editTdsPreset])

  if (!open || !invoice) return null

  function startEdit(r: Receipt) {
    setEditingId(r.id)
    setEditAmount(String(r.amountReceived))
    setEditDate(r.receivedDate.slice(0, 10))
    const presets: Array<'0' | '2' | '10'> = ['0', '2', '10']
    const pStr = String(r.tdsPercent) as '0' | '2' | '10' | 'other'
    setEditTdsPreset(presets.includes(pStr as any) ? pStr : 'other')
    setEditCustomTds(presets.includes(pStr as any) ? '' : String(r.tdsPercent))
    setEditGstWithheld(r.gstWithheld)
    setEditNotes(r.notes || '')
    setEditError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError('')
  }

  async function saveEdit(receiptId: string) {
    setEditSaving(true)
    setEditError('')
    try {
      const res = await fetch(`/api/receipts/${receiptId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amountReceived: Number(editAmount),
          receivedDate: toISO(editDate),
          tdsPercent: editEffectiveTds,
          gstWithheld: editGstWithheld,
          notes: editNotes.trim() || null,
        }),
      })
      if (!res.ok) {
        const p = await res.json().catch(() => ({}))
        throw new Error(formatApiError(p, 'Failed to update receipt'))
      }
      setEditingId(null)
      onSaved()
    } catch (err: any) {
      setEditError(err.message || 'Failed to update receipt')
    } finally {
      setEditSaving(false)
    }
  }

  async function deleteReceipt(receiptId: string) {
    if (!confirm('Delete this receipt entry? The invoice totals will be recalculated.')) return
    setDeletingId(receiptId)
    try {
      const res = await fetch(`/api/receipts/${receiptId}`, { method: 'DELETE' })
      if (!res.ok) {
        const p = await res.json().catch(() => ({}))
        throw new Error(formatApiError(p, 'Failed to delete receipt'))
      }
      if (editingId === receiptId) setEditingId(null)
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Failed to delete receipt')
    } finally {
      setDeletingId(null)
    }
  }

  async function submit() {
    const currentInvoice = invoice
    if (!currentInvoice) return
    setError('')

    if (receiptType === 'partial') {
      const amount = Number(partialAmount)
      if (!Number.isFinite(amount) || amount <= 0) { setError('Enter valid partial receipt amount'); return }
      if (amount > pending) { setError('Partial amount cannot exceed pending amount'); return }
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/invoices/${currentInvoice.id}/receive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          receiptType,
          amountReceived: receiptType === 'partial' ? Number(partialAmount) : undefined,
          receivedDate: toISO(receivedDate),
          tdsPercent: effectiveTdsPercent,
          gstWithheld,
          gstWithheldAmount,
          notes: notes.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(formatApiError(payload, 'Failed to update receipt'))
        return
      }
      onSaved()
      onClose()
      setReceiptType('full')
      setPartialAmount('')
      setReceivedDate(dateOnlyISO(new Date()))
      setTdsPreset('0')
      setCustomTds('')
      setGstWithheld(false)
      setNotes('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 720 }}>
        <div className="page-header" style={{ alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Receipts</h3>
            <p className="page-subtitle">{invoice.invNo || invoice.id} — {invoice.company || 'Client'}</p>
          </div>
          <button className="button-muted" onClick={onClose}>Close</button>
        </div>

        {/* Summary row */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, marginBottom: 4 }}>
          {[
            { label: 'Invoice Total', value: invoice.amt, color: '#374151' },
            { label: 'Received', value: invoice.amountReceived, color: '#16a34a' },
            { label: 'Pending', value: pending, color: pending > 0 ? '#dc2626' : '#16a34a' },
          ].map((item) => (
            <div key={item.label} className="card" style={{ flex: '1 1 120px', padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: item.color, marginTop: 2 }}>{fmt(item.value)}</div>
            </div>
          ))}
        </div>

        {/* Receipt history */}
        {receipts.length > 0 ? (
          <div style={{ marginTop: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 }}>
              Receipt History ({receipts.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {receipts.map((r) => (
                <div key={r.id} style={{ background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)', padding: '10px 12px' }}>
                  {editingId === r.id ? (
                    /* Edit form */
                    <div>
                      <div className="form-grid" style={{ marginBottom: 8 }}>
                        <label>
                          Amount
                          <input type="number" min="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                        </label>
                        <label>
                          Date Received
                          <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                        </label>
                        <label>
                          TDS %
                          <select value={editTdsPreset} onChange={(e) => setEditTdsPreset(e.target.value as any)}>
                            <option value="0">0%</option>
                            <option value="2">2%</option>
                            <option value="10">10%</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        {editTdsPreset === 'other' ? (
                          <label>
                            Custom TDS %
                            <input type="number" min="0" value={editCustomTds} onChange={(e) => setEditCustomTds(e.target.value)} />
                          </label>
                        ) : null}
                        <label>
                          GST Withheld?
                          <select value={editGstWithheld ? 'yes' : 'no'} onChange={(e) => setEditGstWithheld(e.target.value === 'yes')}>
                            <option value="no">No</option>
                            <option value="yes">Yes</option>
                          </select>
                        </label>
                        <label style={{ gridColumn: '1 / -1' }}>
                          Notes
                          <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Optional" />
                        </label>
                      </div>
                      {editError ? <div className="error" style={{ marginBottom: 6 }}>{editError}</div> : null}
                      <div className="stack" style={{ gap: 6 }}>
                        <button className="button-muted" style={{ fontSize: 12 }} onClick={cancelEdit}>Cancel</button>
                        <button className="button-primary" style={{ fontSize: 12 }} onClick={() => saveEdit(r.id)} disabled={editSaving}>
                          {editSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Display row */
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                          <span><strong style={{ color: '#16a34a' }}>{fmt(r.amountReceived)}</strong></span>
                          <span style={{ color: 'var(--text-muted)' }}>{fmtDate(r.receivedDate)}</span>
                          {r.tdsPercent > 0 ? (
                            <span style={{ color: '#7c3aed' }}>TDS {r.tdsPercent}% = {fmt(r.tdsAmount)}</span>
                          ) : null}
                          {r.gstWithheld ? (
                            <span style={{ color: '#d97706' }}>GST withheld {fmt(r.gstWithheldAmount)}</span>
                          ) : null}
                          <span style={{ color: '#374151' }}>Net to bank: {fmt(r.netToBank)}</span>
                        </div>
                        {r.notes ? <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{r.notes}</div> : null}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => startEdit(r)}
                          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: '#374151' }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteReceipt(r.id)}
                          disabled={deletingId === r.id}
                          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff5f5', cursor: 'pointer', color: '#dc2626' }}
                        >
                          {deletingId === r.id ? '...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Add new receipt — only show if still pending */}
        {pending > 0 ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginTop: 14, marginBottom: 6 }}>
              Add Receipt
            </div>

            <div className="form-grid">
              <label>
                Receipt Type
                <select value={receiptType} onChange={(e) => setReceiptType(e.target.value as 'full' | 'partial')}>
                  <option value="full">Received Full ({fmt(pending)} pending)</option>
                  <option value="partial">Received Partial</option>
                </select>
              </label>

              <label>
                Date Received
                <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
              </label>

              {receiptType === 'partial' ? (
                <label>
                  Amount Received{gstWithheld ? ' (invoice value cleared, incl. GST)' : ''}
                  <input type="number" min="0" max={pending} value={partialAmount} onChange={(e) => setPartialAmount(e.target.value)} />
                </label>
              ) : (
                <label>
                  {gstWithheld ? 'Collected (excl. withheld GST)' : 'Amount Received'}
                  <input value={fmt(Math.max(0, receivedAmount - gstWithheldAmount))} readOnly />
                </label>
              )}

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

              <label>
                GST Withheld?
                <select value={gstWithheld ? 'yes' : 'no'} onChange={(e) => setGstWithheld(e.target.value === 'yes')}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>

              <label>TDS Amount<input value={fmt(tdsAmount)} readOnly /></label>
              <label>GST Withheld Amount<input value={fmt(gstWithheldAmount)} readOnly /></label>
              <label>Net to Bank<input value={fmt(netToBank)} readOnly /></label>
            </div>

            <label style={{ marginTop: 10 }}>
              Notes (optional)
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            {error ? <div className="error" style={{ marginTop: 6 }}>{error}</div> : null}

            <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="button-muted" onClick={onClose}>Cancel</button>
              <button className="button-primary" onClick={submit} disabled={saving}>
                {saving ? 'Saving...' : 'Save Receipt'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
            Invoice fully paid. Use Edit buttons above to correct any receipt entries.
          </div>
        )}

        {error && pending <= 0 ? <div className="error" style={{ marginTop: 6 }}>{error}</div> : null}
      </div>
    </div>
  )
}
