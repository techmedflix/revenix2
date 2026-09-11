'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { dateOnlyISO, fmtDate, fmtINRCompact, formatApiError } from '@/lib/utils'
import { apiFetch } from '@/lib/api-fetch'

type CostCentre = { id: string; name: string }
type CostHead = { id: string; name: string }

type VendorInvoice = {
  id: string
  vendorName: string
  costCentreId: string
  costHeadId: string
  amount: number
  invoiceDate: string
  paymentDueDate: string | null
  invoiceFileUrl: string | null
  notes: string | null
  status: 'pending' | 'approved' | 'paid'
  paidAt: string | null
  costCentre: CostCentre
  costHead: CostHead
}

const CHART_COLORS = ['#0f6ef2', '#0e9f6e', '#d97706', '#4f46e5', '#dc2626', '#14b8a6']

function monthKey(dateValue: string | Date) {
  const d = new Date(dateValue)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getLastSixMonthKeys() {
  const now = new Date()
  const arr: Array<{ key: string; label: string }> = []
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    arr.push({
      key: monthKey(d),
      label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    })
  }
  return arr
}

const STATUS_COLORS: Record<VendorInvoice['status'], string> = {
  pending: '#d97706',
  approved: '#2563eb',
  paid: '#16a34a',
}

export default function CostLedgerClient() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'ledger' | 'structure'>('ledger')

  const [centres, setCentres] = useState<CostCentre[]>([])
  const [heads, setHeads] = useState<CostHead[]>([])
  const [vendorInvoices, setVendorInvoices] = useState<VendorInvoice[]>([])

  const [centreName, setCentreName] = useState('')
  const [headName, setHeadName] = useState('')

  // New payable form
  const [showForm, setShowForm] = useState(false)
  const [vendorName, setVendorName] = useState('')
  const [costCentreId, setCostCentreId] = useState('')
  const [costHeadId, setCostHeadId] = useState('')
  const [amount, setAmount] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(dateOnlyISO(new Date()))
  const [paymentDueDate, setPaymentDueDate] = useState('')
  const [invoiceFileUrl, setInvoiceFileUrl] = useState('')
  const [notes, setNotes] = useState('')

  async function load() {
    setLoading(true)
    setError('')

    try {
      const [cRes, hRes, vRes] = await Promise.all([
        apiFetch('/api/cost-centres'),
        apiFetch('/api/cost-heads'),
        apiFetch('/api/vendor-invoices'),
      ])

      if (!cRes.ok || !hRes.ok || !vRes.ok) throw new Error('Failed to load cost-ledger data')

      setCentres((await cRes.json()) as CostCentre[])
      setHeads((await hRes.json()) as CostHead[])
      setVendorInvoices((await vRes.json()) as VendorInvoice[])
    } catch (err: any) {
      setError(err.message || 'Failed to load cost-ledger data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // KPI totals
  const kpis = useMemo(() => {
    return vendorInvoices.reduce(
      (acc, row) => {
        acc.total += row.amount
        if (row.status === 'pending') acc.pending += row.amount
        if (row.status === 'approved') acc.approved += row.amount
        if (row.status === 'paid') acc.paid += row.amount
        return acc
      },
      { total: 0, pending: 0, approved: 0, paid: 0 },
    )
  }, [vendorInvoices])

  async function addCostCentre() {
    if (!centreName.trim()) return
    const res = await apiFetch('/api/cost-centres', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: centreName.trim() }),
    })
    if (!res.ok) {
      const p = await res.json().catch(() => ({}))
      setError(formatApiError(p, 'Failed to create cost centre'))
      return
    }
    setCentreName('')
    await load()
  }

  async function addCostHead() {
    if (!headName.trim()) return
    const res = await apiFetch('/api/cost-heads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: headName.trim() }),
    })
    if (!res.ok) {
      const p = await res.json().catch(() => ({}))
      setError(formatApiError(p, 'Failed to create cost head'))
      return
    }
    setHeadName('')
    await load()
  }

  async function createPayable() {
    setError('')
    const value = Number(amount)
    if (!vendorName.trim() || !costCentreId || !costHeadId || !Number.isFinite(value) || value <= 0) {
      setError('Vendor, centre, head, and a positive amount are required')
      return
    }
    const res = await apiFetch('/api/vendor-invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vendorName: vendorName.trim(),
        costCentreId,
        costHeadId,
        amount: value,
        invoiceDate: new Date(`${invoiceDate}T00:00:00`).toISOString(),
        paymentDueDate: paymentDueDate ? new Date(`${paymentDueDate}T00:00:00`).toISOString() : null,
        invoiceFileUrl: invoiceFileUrl.trim() || null,
        notes: notes.trim() || null,
      }),
    })
    if (!res.ok) {
      const p = await res.json().catch(() => ({}))
      setError(formatApiError(p, 'Failed to create payable'))
      return
    }
    setVendorName(''); setCostCentreId(''); setCostHeadId('')
    setAmount(''); setInvoiceDate(dateOnlyISO(new Date())); setPaymentDueDate('')
    setInvoiceFileUrl(''); setNotes(''); setShowForm(false)
    await load()
  }

  async function deleteCostCentre(id: string) {
    const res = await apiFetch(`/api/cost-centres/${id}`, { method: 'DELETE' })
    if (!res.ok) { const p = await res.json().catch(() => ({})); setError(formatApiError(p, 'Failed to delete cost centre')); return }
    await load()
  }

  async function deleteCostHead(id: string) {
    const res = await apiFetch(`/api/cost-heads/${id}`, { method: 'DELETE' })
    if (!res.ok) { const p = await res.json().catch(() => ({})); setError(formatApiError(p, 'Failed to delete cost head')); return }
    await load()
  }

  async function updatePayableStatus(id: string, status: VendorInvoice['status']) {
    const res = await apiFetch(`/api/vendor-invoices/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) { const p = await res.json().catch(() => ({})); setError(formatApiError(p, 'Failed to update payable status')); return }
    await load()
  }

  const monthlyCentreSeries = useMemo(() => {
    const months = getLastSixMonthKeys()
    const grouped: Record<string, Record<string, number>> = {}
    for (const month of months) grouped[month.key] = {}
    for (const row of vendorInvoices) {
      const key = monthKey(row.invoiceDate)
      if (!grouped[key]) continue
      const cName = row.costCentre?.name || 'Unknown'
      grouped[key][cName] = (grouped[key][cName] || 0) + row.amount
    }
    return months.map((month) => {
      const output: Record<string, number | string> = { month: month.label }
      for (const centre of centres.slice(0, 6)) output[centre.name] = grouped[month.key][centre.name] || 0
      return output
    })
  }, [centres, vendorInvoices])

  const monthlyHeadSeries = useMemo(() => {
    const months = getLastSixMonthKeys()
    const grouped: Record<string, Record<string, number>> = {}
    for (const month of months) grouped[month.key] = {}
    for (const row of vendorInvoices) {
      const key = monthKey(row.invoiceDate)
      if (!grouped[key]) continue
      const hName = row.costHead?.name || 'Unknown'
      grouped[key][hName] = (grouped[key][hName] || 0) + row.amount
    }
    return months.map((month) => {
      const output: Record<string, number | string> = { month: month.label }
      for (const head of heads.slice(0, 6)) output[head.name] = grouped[month.key][head.name] || 0
      return output
    })
  }, [heads, vendorInvoices])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Cost Ledger</h1>
        {tab === 'ledger' ? (
          <button className="button-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Add Payable'}
          </button>
        ) : null}
      </div>

      {/* Tab switcher */}
      <div className="pill-row" style={{ marginBottom: 16 }}>
        <button
          className={tab === 'ledger' ? 'stage-chip active' : 'stage-chip'}
          onClick={() => setTab('ledger')}
        >
          Payables Ledger
        </button>
        <button
          className={tab === 'structure' ? 'stage-chip active' : 'stage-chip'}
          onClick={() => setTab('structure')}
        >
          Cost Structure
        </button>
      </div>

      {loading ? <div className="card">Loading cost ledger...</div> : null}
      {error ? <div className="error" style={{ marginBottom: 10 }}>{error}</div> : null}

      {/* ── LEDGER TAB ── */}
      {!loading && tab === 'ledger' ? (
        <>
          {/* KPI Pills */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              { label: 'Total Payables', value: kpis.total, color: '#0f6ef2' },
              { label: 'Pending Approval', value: kpis.pending, color: '#d97706' },
              { label: 'Approved', value: kpis.approved, color: '#2563eb' },
              { label: 'Paid Out', value: kpis.paid, color: '#16a34a' },
            ].map((pill) => (
              <div
                key={pill.label}
                className="card"
                style={{ flex: '1 1 150px', padding: '10px 16px', borderTop: `3px solid ${pill.color}` }}
              >
                <div className="kpi-sub">{pill.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: pill.color, marginTop: 2 }}>
                  {fmtINRCompact(pill.value)}
                </div>
              </div>
            ))}
          </div>

          {/* Add Payable Form */}
          {showForm ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <p className="card-title" style={{ marginBottom: 10 }}>New Payable</p>
              <div className="form-grid">
                <label>
                  Vendor Name *
                  <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Vendor Co." />
                </label>
                <label>
                  Cost Centre *
                  <select value={costCentreId} onChange={(e) => setCostCentreId(e.target.value)}>
                    <option value="">Select centre</option>
                    {centres.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </label>
                <label>
                  Cost Head *
                  <select value={costHeadId} onChange={(e) => setCostHeadId(e.target.value)}>
                    <option value="">Select head</option>
                    {heads.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </label>
                <label>
                  Invoice Amount (INR) *
                  <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label>
                  Invoice Date
                  <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                </label>
                <label>
                  Payment Due Date
                  <input type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
                </label>
                <label>
                  Invoice File URL
                  <input value={invoiceFileUrl} onChange={(e) => setInvoiceFileUrl(e.target.value)} placeholder="https://..." />
                </label>
                <label style={{ gridColumn: '1 / -1' }}>
                  Notes
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 48 }} />
                </label>
              </div>
              <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
                <button className="button-muted" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="button-primary" onClick={createPayable}>Create Payable</button>
              </div>
            </div>
          ) : null}

          {/* Payables Table */}
          <div className="table-wrap">
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Cost Centre</th>
                  <th>Cost Head</th>
                  <th>Amount (INR)</th>
                  <th>Invoice Date</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendorInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 24 }}>No payables yet. Add one above.</td>
                  </tr>
                ) : (
                  vendorInvoices.map((row) => {
                    const overdue = row.paymentDueDate && new Date(row.paymentDueDate) < new Date() && row.status !== 'paid'
                    return (
                      <tr key={row.id} style={{ background: overdue ? '#fff5f5' : undefined }}>
                        <td style={{ fontWeight: 500 }}>{row.vendorName}</td>
                        <td style={{ fontSize: 12 }}>{row.costCentre?.name || '-'}</td>
                        <td style={{ fontSize: 12 }}>{row.costHead?.name || '-'}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          ₹{row.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td style={{ fontSize: 12 }}>{fmtDate(row.invoiceDate)}</td>
                        <td>
                          <span className={`badge ${overdue ? 'badge-red' : 'badge-blue'}`} style={{ fontSize: 11 }}>
                            {fmtDate(row.paymentDueDate)}
                          </span>
                        </td>
                        <td>
                          <select
                            value={row.status}
                            onChange={(e) => updatePayableStatus(row.id, e.target.value as VendorInvoice['status'])}
                            style={{
                              fontSize: 11,
                              padding: '2px 6px',
                              border: '1.5px solid',
                              borderColor: STATUS_COLORS[row.status],
                              color: STATUS_COLORS[row.status],
                              background: 'white',
                              borderRadius: 4,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="paid">Paid</option>
                          </select>
                        </td>
                        <td>
                          {row.status !== 'paid' ? (
                            <button
                              className="icon-btn"
                              style={{ fontSize: 11 }}
                              onClick={() => updatePayableStatus(row.id, 'paid')}
                            >
                              Mark Paid
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, color: '#16a34a' }}>✓ Paid</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Analytics */}
          {vendorInvoices.length > 0 ? (
            <div className="grid grid-2" style={{ marginTop: 16 }}>
              <div className="card" style={{ height: 300 }}>
                <p className="card-title">Monthly Cost by Centre (Last 6 Months)</p>
                <ResponsiveContainer width="100%" height="85%">
                  <BarChart data={monthlyCentreSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value: number) => `₹${value.toLocaleString('en-IN')}`} />
                    <Legend fontSize={11} />
                    {centres.slice(0, 6).map((centre, i) => (
                      <Bar key={centre.id} dataKey={centre.name} stackId="a" fill={CHART_COLORS[i]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ height: 300 }}>
                <p className="card-title">Monthly Cost by Head (Last 6 Months)</p>
                <ResponsiveContainer width="100%" height="85%">
                  <BarChart data={monthlyHeadSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value: number) => `₹${value.toLocaleString('en-IN')}`} />
                    <Legend fontSize={11} />
                    {heads.slice(0, 6).map((head, i) => (
                      <Bar key={head.id} dataKey={head.name} stackId="a" fill={CHART_COLORS[i]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ── STRUCTURE TAB ── */}
      {!loading && tab === 'structure' ? (
        <div className="grid grid-2">
          <div className="card">
            <p className="card-title">Cost Centres</p>
            <div className="stack" style={{ marginBottom: 12 }}>
              <input
                value={centreName}
                onChange={(e) => setCentreName(e.target.value)}
                placeholder="New cost centre name"
                onKeyDown={(e) => e.key === 'Enter' && addCostCentre()}
              />
              <button className="button-primary" onClick={addCostCentre}>Add</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {centres.map((row) => (
                <div key={row.id} className="stack" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #edf2f7' }}>
                  <span style={{ fontSize: 14 }}>{row.name}</span>
                  <button className="icon-btn" style={{ fontSize: 11, color: '#dc2626' }} onClick={() => deleteCostCentre(row.id)}>
                    Delete
                  </button>
                </div>
              ))}
              {centres.length === 0 ? <div className="kpi-sub">No cost centres yet.</div> : null}
            </div>
          </div>

          <div className="card">
            <p className="card-title">Cost Heads</p>
            <div className="stack" style={{ marginBottom: 12 }}>
              <input
                value={headName}
                onChange={(e) => setHeadName(e.target.value)}
                placeholder="New cost head name"
                onKeyDown={(e) => e.key === 'Enter' && addCostHead()}
              />
              <button className="button-primary" onClick={addCostHead}>Add</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {heads.map((row) => (
                <div key={row.id} className="stack" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #edf2f7' }}>
                  <span style={{ fontSize: 14 }}>{row.name}</span>
                  <button className="icon-btn" style={{ fontSize: 11, color: '#dc2626' }} onClick={() => deleteCostHead(row.id)}>
                    Delete
                  </button>
                </div>
              ))}
              {heads.length === 0 ? <div className="kpi-sub">No cost heads yet.</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
