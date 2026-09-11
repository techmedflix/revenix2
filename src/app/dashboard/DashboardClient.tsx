'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { fmtINRCompact } from '@/lib/utils'
import { useGlobalFilters } from '@/lib/GlobalFiltersContext'
import { apiFetch } from '@/lib/api-fetch'

type DashboardPayload = {
  scenario: number
  kpis: {
    totalRevenue: number
    totalPipeline: number
    weightedPipeline: number
    wonPipeline: number
    wonContribution: number
    invoicedPipeline: number
    invoicedContribution: number
    activePipeline: number
    activeContribution: number
    signedRevenue: number
    receivables: number
    cashInBank: number
    runwayMonths: number
    contribution: number
    weightedContribution: number
    tdsDeducted: number
  }
  salesFunnel: {
    newLeads: { count: number; value: number; contribution: number }
    proposalsSent: { count: number; value: number; contribution: number }
    projectsApproved: { count: number; value: number; contribution: number }
  }
  charts: {
    pipelineByStage: Array<{ stage: string; count: number; value: number }>
    topClients: Array<{ label: string; value: number }>
    topOfferings: Array<{ label: string; value: number }>
    newLeadsMonthly: Array<{ month: string; count: number; value: number }>
    avgPayoutByClient: Array<{ label: string; avgDays: number; count: number }>
  }
  settings: { monthlyOpex: number; cashInBank: number }
  pendingInvoices30to44: PendingInvoiceRow[]
  pendingInvoices45plus: PendingInvoiceRow[]
  activityStats: {
    totalLeads: number
    newLeads: number
    calls: number
    meetings: number
    proposals: number
    proposalsValue: number
    commissionedCount: number
    commissionedValue: number
  }
  pipelineByStageMonthly: Array<{
    month: string
    commissioned: number
    invoiced: number
    hot: number
    warm: number
    cold: number
    lost: number
  }>
}

type PendingInvoiceRow = {
  id: string
  invNo: string | null
  description: string | null
  date: string
  dueDate: string | null
  clientName: string
  division: string | null
  gross: number
  net: number
  amt: number
  amountReceived: number
  outstanding: number
  ageDays: number
  status: string
  entity: string
}

const STAGE_COLORS: Record<string, string> = {
  hot: '#f5a623', warm: '#4a9eff', cold: '#a78bfa',
  won: '#22d98a', hold: '#7a8ea8', lost: '#ff5f5f', renewal: '#2dd4bf',
  invoiced: '#38bdf8',
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px', borderLeft: `3px solid ${color}`, position: 'relative', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.04,
        background: `radial-gradient(ellipse at top left, ${color}, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div className="section-label" style={{ marginBottom: 8, color: 'var(--text-faint)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', color, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// ─── Ranked Row with progress bar ─────────────────────────────────────────────
function RankedRow({ rank, label, value, pct, color, isTop }: {
  rank: number; label: string; value: string; pct: number; color: string; isTop: boolean
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: 10, fontWeight: 800, minWidth: 20,
            color: isTop ? '#f5a623' : 'var(--text-faint)',
          }}>#{rank}</span>
          <span style={{
            fontSize: 12, fontWeight: 600, color: 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={label}>{label}</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color, flexShrink: 0, marginLeft: 10 }}>{value}</span>
      </div>
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${pct}%`, background: color, opacity: isTop ? 1 : 0.5 }} />
      </div>
    </div>
  )
}

// ─── Truncated text with hover popover (portalled to body to escape overflow:hidden) ──
const TRUNC_LIMIT = 38
function TruncatedCell({ text }: { text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const truncated = text.length > TRUNC_LIMIT
  return (
    <div style={{ display: 'inline-block', maxWidth: '100%' }}>
      <span
        onMouseMove={(e) => truncated && setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setPos(null)}
        style={{ cursor: truncated ? 'help' : 'default', whiteSpace: 'nowrap' }}
      >
        {truncated ? text.slice(0, TRUNC_LIMIT) + '…' : text}
      </span>
      {pos && createPortal(
        <div style={{
          position: 'fixed', left: pos.x + 14, top: pos.y - 10, zIndex: 9999,
          background: '#1d2436', border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6, padding: '7px 11px', fontSize: 11, color: '#e2eaf8',
          whiteSpace: 'normal', maxWidth: 320, boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
          lineHeight: 1.55, pointerEvents: 'none',
        }}>
          {text}
        </div>,
        document.body
      )}
    </div>
  )
}

// ─── Activity Stat Box ─────────────────────────────────────────────────────────
function ActivityStatBox({ label, primary, secondary, color }: {
  label: string; primary: string; secondary?: string; color: string
}) {
  return (
    <div className="card" style={{ padding: '12px 14px', borderTop: `2px solid ${color}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
        {primary}
      </div>
      {secondary && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{secondary}</div>
      )}
    </div>
  )
}

// ─── Monthly Pipeline by Stage Table ─────────────────────────────────────────
function PipelineByStageMonthlyTable({ data }: {
  data: DashboardPayload['pipelineByStageMonthly']
}) {
  const rows: Array<{ label: string; key: keyof typeof data[0]; color: string }> = [
    { label: 'Won — Commissioned', key: 'commissioned', color: 'var(--green)' },
    { label: 'Invoiced', key: 'invoiced', color: STAGE_COLORS.invoiced },
    { label: 'Hot', key: 'hot', color: STAGE_COLORS.hot },
    { label: 'Warm', key: 'warm', color: STAGE_COLORS.warm },
    { label: 'Cold', key: 'cold', color: STAGE_COLORS.cold },
    { label: 'Lost', key: 'lost', color: STAGE_COLORS.lost },
  ]
  return (
    <div className="card" style={{ padding: '14px 16px', overflowX: 'auto' }}>
      <p className="card-title" style={{ marginBottom: 12 }}>Pipeline by Stage — Last 6 Months</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '5px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
              Stage
            </th>
            {data.map((d) => (
              <th key={d.month} style={{ padding: '5px 10px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                {d.month}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.label} style={{ borderBottom: ri < rows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <td style={{ padding: '7px 10px', fontSize: 11, fontWeight: 600, color: row.color, whiteSpace: 'nowrap' }}>
                {row.label}
              </td>
              {data.map((d) => {
                const val = d[row.key] as number
                return (
                  <td key={d.month} style={{ padding: '7px 10px', textAlign: 'right', color: val > 0 ? 'var(--text)' : 'var(--text-faint)', fontWeight: val > 0 ? 600 : 400 }}>
                    {val > 0 ? fmtINRCompact(val) : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Pending Invoices Table (grouped by client, expandable) ────────────────────
type ClientGroup = {
  clientName: string
  invoices: PendingInvoiceRow[]
  totalOutstanding: number
  oldestAgeDays: number
}

function groupPendingByClient(rows: PendingInvoiceRow[]): ClientGroup[] {
  const map = new Map<string, PendingInvoiceRow[]>()
  for (const row of rows) {
    const list = map.get(row.clientName)
    if (list) list.push(row)
    else map.set(row.clientName, [row])
  }
  return Array.from(map.entries())
    .map(([clientName, invoices]) => ({
      clientName,
      // Oldest invoice first within the client
      invoices: [...invoices].sort((a, b) => b.ageDays - a.ageDays),
      totalOutstanding: invoices.reduce((s, r) => s + r.outstanding, 0),
      oldestAgeDays: invoices.reduce((m, r) => Math.max(m, r.ageDays), 0),
    }))
    // Largest amount owed first
    .sort((a, b) => b.totalOutstanding - a.totalOutstanding)
}

function PendingInvoicesTable({ title, rows, accentColor }: {
  title: string
  rows: PendingInvoiceRow[]
  accentColor: string
}) {
  const groups = useMemo(() => groupPendingByClient(rows), [rows])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const total = rows.reduce((s, r) => s + r.outstanding, 0)

  const toggle = (clientName: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(clientName)) next.delete(clientName)
      else next.add(clientName)
      return next
    })

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <p className="card-title" style={{ margin: 0, color: accentColor }}>{title}</p>
        <span style={{ fontSize: 12, fontWeight: 700, color: accentColor }}>
          {groups.length} client{groups.length !== 1 ? 's' : ''} · {rows.length} invoice{rows.length !== 1 ? 's' : ''} · {fmtINRCompact(total)} outstanding
        </span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>No invoices in this range</div>
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 260 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 70 }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {[
                  { label: 'Company', align: 'left' },
                  { label: '', align: 'left' },
                  { label: 'Amount Due', align: 'right' },
                  { label: 'Due Days', align: 'right' },
                ].map(({ label, align }, ci) => (
                  <th key={ci} style={{
                    padding: '6px 8px', textAlign: align as 'left' | 'right',
                    fontSize: 10, fontWeight: 700, color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
                    width: 'auto', maxWidth: 'none',
                  }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const isOpen = expanded.has(g.clientName)
                return (
                  <Fragment key={g.clientName}>
                    <tr
                      onClick={() => toggle(g.clientName)}
                      style={{
                        borderBottom: gi < groups.length - 1 && !isOpen ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '7px 8px', color: 'var(--text)', overflow: 'hidden', textAlign: 'left', width: 'auto', maxWidth: 'none' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                          <span style={{ color: 'var(--text-faint)', fontSize: 9, width: 8, flexShrink: 0 }}>
                            {isOpen ? '▼' : '▶'}
                          </span>
                          <TruncatedCell text={g.clientName} />
                        </span>
                      </td>
                      <td style={{ padding: '7px 8px', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                        {g.invoices.length} invoice{g.invoices.length !== 1 ? 's' : ''}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {fmtINRCompact(g.totalOutstanding)}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color: accentColor, whiteSpace: 'nowrap' }}>
                        {g.oldestAgeDays}d
                      </td>
                    </tr>
                    {isOpen && g.invoices.map((row) => (
                      <tr key={row.id} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '6px 8px 6px 22px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', width: 'auto', maxWidth: 'none' }}>
                          {row.invNo || '—'}
                          {row.division ? <span style={{ color: 'var(--text-faint)' }}> ({row.division})</span> : null}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--text)', overflow: 'hidden' }}>
                          {row.description ? <TruncatedCell text={row.description} /> : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {fmtINRCompact(row.outstanding)}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: accentColor, whiteSpace: 'nowrap' }}>
                          {row.ageDays}d
                        </td>
                      </tr>
                    ))}
                    {isOpen && gi < groups.length - 1 && (
                      <tr><td colSpan={4} style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: 0 }} /></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function DashboardClient() {
  const { entity, fy } = useGlobalFilters()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [scenario, setScenario] = useState<0 | 30 | 60>(0)
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null)
  const [showControls, setShowControls] = useState(false)
  const [monthlyOpex, setMonthlyOpex] = useState('3500000')
  const [cashInBank, setCashInBank] = useState('0')

  async function loadDashboard(sc: 0 | 30 | 60, ent: string, fyVal: string) {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ scenario: String(sc) })
      if (ent) params.set('entity', ent)
      if (fyVal) params.set('fy', fyVal)
      const res = await apiFetch(`/api/dashboard?${params}`)
      if (!res.ok) throw new Error('Failed to load dashboard')
      const data = (await res.json()) as DashboardPayload
      setDashboard(data)
      setMonthlyOpex(String(data.settings.monthlyOpex))
      setCashInBank(String(data.settings.cashInBank))
    } catch (err: any) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard(scenario, entity, fy)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, entity, fy])

  async function saveSettings() {
    setSaving(true)
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ monthlyOpex: Number(monthlyOpex), cashInBank: Number(cashInBank) }),
      })
      await loadDashboard(scenario, entity, fy)
      setShowControls(false)
    } catch {
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const avgPayoutSorted = useMemo(
    () => [...(dashboard?.charts.avgPayoutByClient || [])].sort((a, b) => b.avgDays - a.avgDays),
    [dashboard],
  )

  if (loading) {
    return (
      <div className="page" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading dashboard…</div>
      </div>
    )
  }

  if (!dashboard) {
    return (
      <div className="page">
        <h1 className="page-title">Dashboard</h1>
        {error ? <div className="card error">{error}</div> : <div className="card">No data available.</div>}
      </div>
    )
  }

  const kpis = dashboard.kpis
  const charts = dashboard.charts
  const act = dashboard.activityStats

  return (
    <div className="page">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {fy ? fy : 'All Financial Years'}{entity ? ` · ${entity}` : ''}
          </p>
        </div>
        <button
          className="button-muted"
          style={{ fontSize: 12 }}
          onClick={() => setShowControls(!showControls)}
        >
          {showControls ? '✕ Close' : '⚙ Controls'}
        </button>
      </div>

      {/* ── Controls Panel ─────────────────────────────────────── */}
      {showControls && (
        <div className="card toolbar-card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, alignItems: 'end' }}>
            <label>
              Monthly OPEX (INR)
              <input type="number" min="1" value={monthlyOpex} onChange={(e) => setMonthlyOpex(e.target.value)} />
            </label>
            <label>
              Cash In Bank (INR)
              <input type="number" min="0" value={cashInBank} onChange={(e) => setCashInBank(e.target.value)} />
            </label>
            <label>
              Scenario Delay
              <select value={scenario} onChange={(e) => setScenario(Number(e.target.value) as 0 | 30 | 60)}>
                <option value={0}>Normal (0 days)</option>
                <option value={30}>+30 day delay</option>
                <option value={60}>+60 day delay</option>
              </select>
            </label>
            <button className="button-primary" onClick={saveSettings} disabled={saving}>
              {saving ? 'Saving…' : 'Save & Apply'}
            </button>
          </div>
          {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {/* ── KPI Strip ──────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        <KpiCard label="Revenue" value={fmtINRCompact(kpis.totalRevenue)}
          sub={fy ? `${fy} invoiced` : 'All FYs invoiced'} color="var(--primary)" />
        <KpiCard label="Receivables" value={fmtINRCompact(kpis.receivables)}
          sub="Outstanding" color="var(--red)" />
        <KpiCard label="Won Pipeline" value={fmtINRCompact(kpis.wonPipeline)}
          sub={`${fmtINRCompact(kpis.wonContribution)} margin · Commissioned+Partial`} color="var(--green)" />
        <KpiCard label="Active Pipeline" value={fmtINRCompact(kpis.activePipeline)}
          sub={`${fmtINRCompact(kpis.activeContribution)} margin · Hot+Warm+Cold`} color="var(--amber)" />
        <KpiCard label="Runway" value={`${kpis.runwayMonths.toFixed(1)} mo`}
          sub={`OPEX ${fmtINRCompact(dashboard.settings.monthlyOpex)}/mo`} color="var(--purple)" />
      </div>

      {/* ── Activity Stats Strip ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        <ActivityStatBox
          label="Leads (Total / New)"
          primary={`${act.totalLeads} / ${act.newLeads}`}
          color="var(--primary)"
        />
        <ActivityStatBox label="Calls Made" primary={String(act.calls ?? 0)} color="#6366f1" />
        <ActivityStatBox label="Meetings Done" primary={String(act.meetings)} color="var(--green)" />
        <ActivityStatBox
          label="Proposals"
          primary={String(act.proposals)}
          secondary={fmtINRCompact(act.proposalsValue) + ' value'}
          color="var(--amber)"
        />
        <ActivityStatBox
          label="Commissioned"
          primary={String(act.commissionedCount)}
          secondary={fmtINRCompact(act.commissionedValue) + ' value'}
          color="var(--teal, #2dd4bf)"
        />
      </div>

      {/* ── Monthly Pipeline by Stage Table ─────────────────────── */}
      <PipelineByStageMonthlyTable data={dashboard.pipelineByStageMonthly} />

      {/* ── Analytics Row: Pipeline · Top Clients · Top Offerings ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>

        <div className="card" style={{ padding: '14px 16px' }}>
          <p className="card-title">Pipeline by Stage</p>
          {charts.pipelineByStage.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>No data</div>
          ) : (
            charts.pipelineByStage
              .filter(s => s.value > 0)
              .sort((a, b) => b.value - a.value)
              .map((s) => (
                <div key={s.stage} className="data-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_COLORS[s.stage] || 'var(--primary)', flexShrink: 0 }} />
                    <span className="data-row-label" style={{ textTransform: 'capitalize' }}>{s.stage}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{s.count}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: STAGE_COLORS[s.stage] || 'var(--primary)' }}>
                    {fmtINRCompact(s.value)}
                  </span>
                </div>
              ))
          )}
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <p className="card-title">Top Clients by Revenue</p>
          {charts.topClients.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>No invoiced data yet</div>
          ) : (
            charts.topClients.map((c, i) => {
              const pct = charts.topClients[0].value > 0 ? (c.value / charts.topClients[0].value) * 100 : 0
              return (
                <RankedRow key={i} rank={i + 1} label={c.label}
                  value={fmtINRCompact(c.value)} pct={pct}
                  color="var(--primary)" isTop={i === 0} />
              )
            })
          )}
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <p className="card-title">Top Offerings by Pipeline</p>
          {charts.topOfferings.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>No pipeline data yet</div>
          ) : (
            charts.topOfferings.map((o, i) => {
              const pct = charts.topOfferings[0].value > 0 ? (o.value / charts.topOfferings[0].value) * 100 : 0
              return (
                <RankedRow key={i} rank={i + 1} label={o.label}
                  value={fmtINRCompact(o.value)} pct={pct}
                  color="var(--green)" isTop={i === 0} />
              )
            })
          )}
        </div>

      </div>

      {/* ── Receivables Aging ──────────────────────────────────── */}
      <PendingInvoicesTable
        title="Receivables — Pending 30–44 Days"
        rows={dashboard.pendingInvoices30to44}
        accentColor="var(--amber)"
      />
      <PendingInvoicesTable
        title="Receivables — Pending 45+ Days"
        rows={dashboard.pendingInvoices45plus}
        accentColor="var(--red)"
      />

      {/* ── Avg Payout Cycle ───────────────────────────────────── */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <p className="card-title">Avg Payout Cycle (Days)</p>
        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 12 }}>
          receivedDate − invoiceDate · paid invoices only
        </div>
        {avgPayoutSorted.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>No paid invoice data yet</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px 24px' }}>
            {avgPayoutSorted.slice(0, 12).map((c, i) => {
              const maxDays = avgPayoutSorted[0].avgDays || 1
              const pct = (c.avgDays / maxDays) * 100
              const color = c.avgDays > 60 ? 'var(--red)' : c.avgDays > 30 ? 'var(--amber)' : 'var(--green)'
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '72%' }}>{c.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color, flexShrink: 0 }}>{c.avgDays}d · {c.count}</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
