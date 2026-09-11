'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatApiError } from '@/lib/utils'

type LinkedInvoice = { id: string; invNo: string | null; net: number; amt: number }

type Opportunity = {
  id: string
  accountId: string
  account?: { name: string } | null
  projectType: string
  description?: string | null
  estimatedValue: number
  leadStage: 'proposal' | 'pilot' | 'commissioned' | 'partial_invoiced' | 'invoiced' | null
  invoicedAmount: number
  invoices?: LinkedInvoice[]
}

type Stage = 'commissioned' | 'partial_invoiced' | 'invoiced'

type InvoiceOption = {
  id: string
  invNo: string | null
  net: number
  amt: number
  status: string
  accountId: string | null
  opportunityId: string | null
  company: string | null
  clientName: string | null
  account?: { id: string; name: string } | null
}

type Props = {
  open: boolean
  opportunity: Opportunity | null
  initialStage?: Stage
  onClose: () => void
  onSaved: () => void
}

export default function UpdateStageModal({ open, opportunity, initialStage, onClose, onSaved }: Props) {
  const [stage, setStage] = useState<Stage>('commissioned')
  const [invoices, setInvoices] = useState<InvoiceOption[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loadingInvoices, setLoadingInvoices] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !opportunity) return
    const currentStage = opportunity.leadStage
    setStage(initialStage ?? (currentStage === 'partial_invoiced' || currentStage === 'invoiced' ? currentStage : 'commissioned'))
    setSelectedIds(new Set((opportunity.invoices || []).map((i) => i.id)))
    setSearch('')
    setError('')

    setLoadingInvoices(true)
    fetch('/api/invoices')
      .then((r) => r.json())
      .then((data: InvoiceOption[]) => setInvoices(data || []))
      .catch(() => setInvoices([]))
      .finally(() => setLoadingInvoices(false))
  }, [open, opportunity, initialStage])

  const selectableInvoices = useMemo(() => {
    if (!opportunity) return []
    const q = search.trim().toLowerCase()
    return invoices
      .filter((inv) => !inv.opportunityId || inv.opportunityId === opportunity.id)
      .filter((inv) => {
        if (!q) return true
        const hay = [inv.invNo, inv.account?.name, inv.company, inv.clientName].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
  }, [invoices, search, opportunity])

  const selectedTotal = useMemo(() => {
    return invoices
      .filter((inv) => selectedIds.has(inv.id))
      .reduce((sum, inv) => sum + inv.net, 0)
  }, [invoices, selectedIds])

  if (!open || !opportunity) return null

  function toggleInvoice(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    const currentOpportunity = opportunity
    if (!currentOpportunity) return

    setError('')

    const invoiceIds = stage === 'commissioned' ? [] : Array.from(selectedIds)

    if (stage === 'partial_invoiced' && invoiceIds.length === 0) {
      setError('Link at least one invoice to mark this partially invoiced')
      return
    }
    if (stage === 'partial_invoiced' && selectedTotal >= currentOpportunity.estimatedValue) {
      setError('Linked invoice total must be less than the commissioned value — use "Invoiced" if fully billed')
      return
    }
    if (stage === 'invoiced' && invoiceIds.length === 0) {
      setError('Link at least one invoice to mark this invoiced')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/opportunities/${currentOpportunity.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadStage: stage, invoiceIds }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(formatApiError(payload, 'Failed to update stage'))
        return
      }

      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 560 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Update Invoicing Status</h3>
        <p className="page-subtitle" style={{ marginBottom: 2 }}>
          {opportunity.account?.name || 'Account'} - {opportunity.projectType}
        </p>
        {opportunity.description ? (
          <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>
            {opportunity.description}
          </p>
        ) : null}

        <div className="card" style={{ marginTop: 8, background: 'var(--surface-2)' }}>
          Commissioned Value: <strong>₹{opportunity.estimatedValue.toLocaleString('en-IN')}</strong>
        </div>

        <div className="form" style={{ marginTop: 10 }}>
          <label>
            Stage
            <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
              <option value="commissioned">Commissioned</option>
              <option value="partial_invoiced">Partially Invoiced</option>
              <option value="invoiced">Invoiced</option>
            </select>
          </label>

          {stage === 'partial_invoiced' || stage === 'invoiced' ? (
            <>
              <label>
                Search Invoices
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Invoice #, company…"
                />
              </label>

              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
                {loadingInvoices ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 6 }}>Loading invoices...</div>
                ) : selectableInvoices.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 6 }}>No available invoices found.</div>
                ) : (
                  selectableInvoices.map((inv) => (
                    <label key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', cursor: 'pointer', fontSize: 12 }}>
                      <input type="checkbox" checked={selectedIds.has(inv.id)} onChange={() => toggleInvoice(inv.id)} />
                      <span style={{ fontWeight: 600 }}>{inv.invNo || inv.id}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{inv.account?.name || inv.company || inv.clientName || '—'}</span>
                      <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>₹{inv.net.toLocaleString('en-IN')}</span>
                    </label>
                  ))
                )}
              </div>

              <div className="card" style={{ background: 'var(--surface-2)', fontSize: 12 }}>
                Linked Total (pre-GST): <strong>₹{selectedTotal.toLocaleString('en-IN')}</strong>
                {stage === 'invoiced' && selectedTotal < opportunity.estimatedValue ? (
                  <span style={{ color: 'var(--amber, #d97706)', marginLeft: 8 }}>
                    (below commissioned value — still marking fully invoiced)
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {error ? <div className="error">{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="button-muted" onClick={onClose}>
            Cancel
          </button>
          <button className="button-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
