'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { InvoicePrefill } from './InvoiceModal'
import { PROJECT_TYPE_MAP, projectCategoryLabel } from '@/lib/constants'
import { formatApiError } from '@/lib/utils'
import { useToast } from '@/lib/ToastContext'

type RegisteredEntity = { id: string; legalName: string; gstin: string; state: string; isDefault: boolean }
type Account = {
  id: string
  name: string
  type: 'company' | 'cluster' | 'division' | 'brand'
  parentId: string | null
  vendorRegistered?: boolean
  registeredEntities?: RegisteredEntity[]
}

type WonOpportunity = {
  id: string
  accountId: string
  account: { id: string; name: string } | null
  projectType: string
  projectCategory: string
  description: string | null
  estimatedValue: number
  invoicedAmount: number
}

type ParsedDraft = {
  entity: 'PMD' | 'Medflix'
  docType: 'INV' | 'PI' | 'QUOTE' | 'CN'
  invNo: string | null
  po: string | null
  pi: string | null
  date: string | null
  dueDate: string | null
  clientName: string | null
  company: string | null
  gstId: string | null
  state: string | null
  creditDays: number | null
  sac: string | null
  desc: string | null
  qty: number | null
  unitRevenue: number | null
  currency: string
  gross: number | null
  gstRate: number | null
  printedTaxable: number | null
  printedTax: number | null
  printedTotal: number | null
  sellerGstin: string | null
  irn: string | null
  ackNo: string | null
  ackDate: string | null
}

type FileResult =
  | { filename: string; ok: true; draft: ParsedDraft; warnings: string[]; recognised: boolean }
  | { filename: string; ok: false; error: string }

type Row = {
  filename: string
  draft: ParsedDraft
  warnings: string[]
  recognised: boolean
  parseError?: string
  include: boolean
  accountId: string // '' = standalone
  matched: boolean
  projectCategory: string
  offeringName: string
  opportunityId: string // '' = none
  status: 'pending' | 'creating' | 'done' | 'failed'
  resultMsg?: string
}

type Props = {
  open: boolean
  accounts: Account[]
  wonOpportunities: WonOpportunity[]
  onClose: () => void
  /** called after one or more invoices were created — reload the list */
  onCreated: () => void
  /** open the full 3-step invoice form pre-filled with a single parsed invoice */
  onReviewOne: (prefill: InvoicePrefill) => void
  /** an invoice number that was just created via the full form — mark its row done */
  markDoneInvNo?: string | null
}

function normName(s: string) {
  return s
    .toLowerCase()
    .replace(/\b(private|pvt|limited|ltd|llp|inc|incorporated|company|co|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function matchAccountId(draft: ParsedDraft, companies: Account[]): string {
  const g = (draft.gstId || '').replace(/\s/g, '').toUpperCase()
  if (g) {
    const byGstin = companies.find((c) =>
      c.registeredEntities?.some((e) => e.gstin.replace(/\s/g, '').toUpperCase() === g),
    )
    if (byGstin) return byGstin.id
  }
  const n = normName(draft.company || draft.clientName || '')
  if (n.length >= 3) {
    const exact = companies.find((c) => normName(c.name) === n)
    if (exact) return exact.id
    const partial = companies.find((c) => {
      const cn = normName(c.name)
      return cn.length >= 3 && (cn.includes(n) || n.includes(cn))
    })
    if (partial) return partial.id
  }
  return ''
}

function draftToPrefill(row: Row): InvoicePrefill {
  const draft = row.draft
  return {
    entity: draft.entity,
    docType: draft.docType,
    invNo: draft.invNo,
    po: draft.po,
    pi: draft.pi,
    date: draft.date,
    dueDate: draft.dueDate,
    clientName: draft.clientName,
    company: draft.company,
    gstId: draft.gstId,
    state: draft.state,
    creditDays: draft.creditDays,
    sac: draft.sac,
    desc: draft.desc,
    qty: draft.qty,
    unitRevenue: draft.unitRevenue,
    currency: draft.currency,
    gross: draft.gross,
    gstRate: draft.gstRate,
    accountId: row.accountId || null,
    projectCategory: row.projectCategory || null,
    offeringName: row.offeringName || null,
    opportunityId: row.opportunityId || null,
    irn: draft.irn,
    ackNo: draft.ackNo,
    ackDate: draft.ackDate,
  }
}

const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export default function InvoicePdfImportModal({ open, accounts, wonOpportunities, onClose, onCreated, onReviewOne, markDoneInvNo }: Props) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<'select' | 'review'>('select')
  const [files, setFiles] = useState<File[]>([])
  const [parsing, setParsing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [createdAny, setCreatedAny] = useState(false)
  const [projectTypeMap, setProjectTypeMap] = useState<Record<string, string[]>>(PROJECT_TYPE_MAP)

  useEffect(() => {
    if (!open) return
    fetch('/api/project-types')
      .then((r) => r.json())
      .then((data: { categories?: Record<string, string[]> }) => {
        if (data.categories && Object.keys(data.categories).length > 0) setProjectTypeMap(data.categories)
      })
      .catch(() => {})
  }, [open])

  // A row created via the full form is done — untick it and mark it so the user
  // doesn't create it a second time when they come back to this list.
  useEffect(() => {
    if (!markDoneInvNo) return
    setRows((prev) =>
      prev.map((r) =>
        r.draft?.invNo === markDoneInvNo && r.status !== 'done'
          ? { ...r, status: 'done', include: false, resultMsg: 'Created via form' }
          : r,
      ),
    )
  }, [markDoneInvNo])

  const companies = useMemo(
    () =>
      accounts
        .filter((a) => a.type === 'company' && a.vendorRegistered)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  )

  const categoryList = useMemo(() => Object.keys(projectTypeMap).sort(), [projectTypeMap])

  if (!open) return null

  // Won opportunities linkable to a row — scoped to the row's client account when one is set.
  function opportunitiesFor(accountId: string) {
    if (!accountId) return wonOpportunities
    return wonOpportunities.filter((o) => {
      // match on the invoice's company account or any descendant (division/cluster/brand)
      let a = accounts.find((x) => x.id === o.accountId) || null
      while (a) {
        if (a.id === accountId) return true
        a = a.parentId ? accounts.find((x) => x.id === a!.parentId) || null : null
      }
      return false
    })
  }

  function resetAll() {
    setPhase('select')
    setFiles([])
    setRows([])
    setError('')
    setParsing(false)
    setCreating(false)
    setCreatedAny(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    if (createdAny) onCreated()
    resetAll()
    onClose()
  }

  function rowIsCreatable(r: Row) {
    return (
      !r.parseError &&
      !!r.draft.invNo &&
      !!r.draft.date &&
      !Number.isNaN(new Date(`${r.draft.date}T00:00:00`).getTime()) &&
      r.draft.gross != null &&
      r.draft.gross > 0
    )
  }

  async function runParse() {
    setError('')
    if (files.length === 0) {
      setError('Choose at least one PDF file')
      return
    }
    setParsing(true)
    try {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      const res = await fetch('/api/invoices/parse-pdf', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(formatApiError(data, 'Could not read the PDFs'))
        return
      }
      const results: FileResult[] = data.results || []
      const next: Row[] = results.map((r) => {
        if (!r.ok) {
          return {
            filename: r.filename,
            draft: {} as ParsedDraft,
            warnings: [],
            recognised: false,
            parseError: r.error,
            include: false,
            accountId: '',
            matched: false,
            projectCategory: '',
            offeringName: '',
            opportunityId: '',
            status: 'pending',
          }
        }
        const accountId = matchAccountId(r.draft, companies)
        const row: Row = {
          filename: r.filename,
          draft: r.draft,
          warnings: r.warnings,
          recognised: r.recognised,
          include: false,
          accountId,
          matched: !!accountId,
          projectCategory: '',
          offeringName: '',
          opportunityId: '',
          status: 'pending',
        }
        row.include = rowIsCreatable(row)
        return row
      })
      setRows(next)
      setPhase('review')
    } catch (e) {
      setError(String(e))
    } finally {
      setParsing(false)
    }
  }

  function patchDraft(idx: number, patch: Partial<ParsedDraft>) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r
        const updated: Row = { ...r, draft: { ...r.draft, ...patch } }
        // keep the include checkbox honest as fields are edited
        if (!rowIsCreatable(updated)) updated.include = false
        return updated
      }),
    )
  }

  function patchRow(idx: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  // Linking an Order Book deal pulls its category / project type across (unless the
  // user has already picked them), and pins the client account to the deal's.
  function pickOpportunity(idx: number, oppId: string) {
    const opp = wonOpportunities.find((o) => o.id === oppId)
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r
        if (!opp) return { ...r, opportunityId: '' }
        return {
          ...r,
          opportunityId: oppId,
          projectCategory: r.projectCategory || opp.projectCategory || '',
          offeringName: r.offeringName || opp.projectType || '',
          accountId: r.accountId || opp.accountId,
        }
      }),
    )
  }

  async function createAll() {
    setError('')
    const targets = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.include && rowIsCreatable(r))
    if (targets.length === 0) {
      setError('Nothing selected to create — tick at least one row (rows need an invoice number, date and amount).')
      return
    }
    setCreating(true)
    let ok = 0
    let failed = 0
    for (const { r, i } of targets) {
      setRows((prev) => prev.map((x, j) => (j === i ? { ...x, status: 'creating', resultMsg: undefined } : x)))
      const d = r.draft
      const payload = {
        entity: d.entity,
        docType: d.docType,
        invNo: d.invNo,
        po: d.po || null,
        pi: d.pi || null,
        date: new Date(`${d.date}T00:00:00`).toISOString(),
        // Explicit due date if the PDF stated one; otherwise let the server derive it from
        // credit days (default 45) so it's never silently left equal to the invoice date.
        dueDate: d.dueDate ? new Date(`${d.dueDate}T00:00:00`).toISOString() : null,
        clientName: d.clientName,
        company: d.company,
        gstId: d.gstId,
        state: d.state,
        creditDays: d.creditDays != null && d.creditDays > 0 ? d.creditDays : 45,
        sac: d.sac,
        desc: d.desc,
        qty: d.qty,
        unitRevenue: d.unitRevenue,
        currency: d.currency || 'INR',
        gross: d.gross,
        disc: 0,
        gstRate: d.gstRate != null ? d.gstRate : 18,
        status: 'sent' as const,
        accountId: r.accountId || null,
        projectCategory: r.projectCategory || null,
        offeringName: r.offeringName || null,
        opportunityId: r.opportunityId || null,
        irn: d.irn,
        ackNo: d.ackNo,
        ackDate: d.ackDate,
      }
      try {
        const res = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const info = await res.json().catch(() => ({}))
        if (!res.ok) {
          failed++
          setRows((prev) =>
            prev.map((x, j) =>
              j === i ? { ...x, status: 'failed', resultMsg: formatApiError(info, 'Failed') } : x,
            ),
          )
        } else {
          ok++
          setRows((prev) =>
            prev.map((x, j) => (j === i ? { ...x, status: 'done', include: false, resultMsg: 'Created' } : x)),
          )
        }
      } catch (e) {
        failed++
        setRows((prev) => prev.map((x, j) => (j === i ? { ...x, status: 'failed', resultMsg: String(e) } : x)))
      }
    }
    setCreating(false)
    if (ok > 0) {
      setCreatedAny(true)
      onCreated()
      toast(`${ok} invoice${ok === 1 ? '' : 's'} created${failed ? `, ${failed} failed` : ''}`, failed ? 'error' : 'success')
    } else {
      toast(`All ${failed} failed — see the notes on each row`, 'error')
    }
  }

  const okRows = rows.filter((r) => !r.parseError)
  const includeCount = rows.filter((r) => r.include).length

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? handleClose() : null)}>
      <div className="modal-card" style={{ maxWidth: phase === 'review' ? 1040 : 560 }}>
        <div className="page-header" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Import Invoices from PDF</h3>
          <button className="button-muted" onClick={handleClose}>Close</button>
        </div>

        {phase === 'select' ? (
          <div style={{ marginTop: 16 }}>
            <label>
              PDF file(s)
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
              <span style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4, display: 'block' }}>
                Tax invoices generated by our billing system (PMD / Medflix). Select several to import them in one go —
                up to 25 files. Scanned or photographed invoices can’t be read.
              </span>
            </label>

            {files.length > 0 ? (
              <div className="card" style={{ marginTop: 12, padding: 10, background: 'var(--surface-2)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-faint)' }}>
                  {files.length} file{files.length === 1 ? '' : 's'} selected
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px' }}>
                  {files.map((f, i) => (
                    <span key={i} style={{ fontSize: 11, padding: '2px 6px', background: 'var(--surface-3)', borderRadius: 4 }}>
                      {f.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? <div className="error" style={{ marginTop: 10 }}>{error}</div> : null}

            <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="button-muted" onClick={handleClose}>Cancel</button>
              <button className="button-primary" onClick={runParse} disabled={parsing || files.length === 0}>
                {parsing ? 'Reading…' : 'Read PDFs'}
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'review' ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Review what was read below. Edit any field inline, pick the client account, then create the ticked rows —
              or open one in the full form. Nothing is saved until you click <strong>Create</strong>.
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}></th>
                    <th style={{ padding: '6px 8px' }}>File</th>
                    <th style={{ padding: '6px 8px' }}>Invoice #</th>
                    <th style={{ padding: '6px 8px' }}>Date</th>
                    <th style={{ padding: '6px 8px' }}>Client account</th>
                    <th style={{ padding: '6px 8px' }}>Category / Type / Order Book</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Gross</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>GST %</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '6px 8px' }}>Notes</th>
                    <th style={{ padding: '6px 8px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    if (r.parseError) {
                      return (
                        <tr key={idx} style={{ borderTop: '1px solid var(--border)', background: 'rgba(220,38,38,0.06)' }}>
                          <td style={{ padding: '6px 8px' }} />
                          <td style={{ padding: '6px 8px' }}>{r.filename}</td>
                          <td style={{ padding: '6px 8px', color: '#dc2626' }} colSpan={9}>
                            Couldn’t read this file: {r.parseError}
                          </td>
                        </tr>
                      )
                    }
                    const d = r.draft
                    const gross = d.gross ?? 0
                    const rate = d.gstRate ?? 0
                    const total = gross + gross * (rate / 100)
                    const creatable = rowIsCreatable(r)
                    return (
                      <Fragment key={idx}>
                      <tr style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <input
                            type="checkbox"
                            checked={r.include}
                            disabled={!creatable || r.status === 'done'}
                            title={creatable ? '' : 'Needs an invoice number, a valid date and an amount'}
                            onChange={(e) =>
                              setRows((prev) => prev.map((x, j) => (j === idx ? { ...x, include: e.target.checked } : x)))
                            }
                          />
                        </td>
                        <td style={{ padding: '6px 8px', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.filename}>
                          {r.filename}
                          {!r.recognised ? (
                            <span style={{ display: 'block', color: '#dc2626', fontSize: 10 }}>unknown layout</span>
                          ) : null}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input
                            value={d.invNo || ''}
                            onChange={(e) => patchDraft(idx, { invNo: e.target.value || null })}
                            style={{ width: 120, fontSize: 12 }}
                            placeholder="required"
                          />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input
                            type="date"
                            value={d.date || ''}
                            onChange={(e) => patchDraft(idx, { date: e.target.value || null })}
                            style={{ fontSize: 12 }}
                          />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <select
                            value={r.accountId}
                            onChange={(e) =>
                              setRows((prev) => prev.map((x, j) => (j === idx ? { ...x, accountId: e.target.value } : x)))
                            }
                            style={{ fontSize: 12, maxWidth: 170 }}
                          >
                            <option value="">Standalone — {d.company || d.clientName || 'no name'}</option>
                            {companies.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                          {r.matched && r.accountId ? (
                            <span style={{ display: 'block', color: 'var(--green)', fontSize: 10 }}>auto-matched</span>
                          ) : null}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 190 }}>
                            <select
                              value={r.projectCategory}
                              onChange={(e) => patchRow(idx, { projectCategory: e.target.value, offeringName: '' })}
                              style={{ fontSize: 11 }}
                            >
                              <option value="">— Category —</option>
                              {categoryList.map((c) => (
                                <option key={c} value={c}>{projectCategoryLabel(c)}</option>
                              ))}
                            </select>
                            <select
                              value={r.offeringName}
                              onChange={(e) => patchRow(idx, { offeringName: e.target.value })}
                              disabled={!r.projectCategory}
                              style={{ fontSize: 11 }}
                            >
                              <option value="">{r.projectCategory ? '— Project type —' : 'pick a category first'}</option>
                              {(projectTypeMap[r.projectCategory] || []).map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                              {r.offeringName && !(projectTypeMap[r.projectCategory] || []).includes(r.offeringName) ? (
                                <option value={r.offeringName}>{r.offeringName}</option>
                              ) : null}
                            </select>
                            <select
                              value={r.opportunityId}
                              onChange={(e) => pickOpportunity(idx, e.target.value)}
                              style={{ fontSize: 11 }}
                            >
                              <option value="">— Link Order Book (optional) —</option>
                              {opportunitiesFor(r.accountId).map((o) => (
                                <option key={o.id} value={o.id}>
                                  {(o.account?.name ? `${o.account.name} · ` : '') + o.projectType}
                                  {` · ₹${Math.round(o.estimatedValue).toLocaleString('en-IN')}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <input
                            type="number"
                            value={d.gross ?? ''}
                            onChange={(e) => patchDraft(idx, { gross: e.target.value === '' ? null : Number(e.target.value) })}
                            style={{ width: 100, fontSize: 12, textAlign: 'right' }}
                          />
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <input
                            type="number"
                            value={d.gstRate ?? ''}
                            onChange={(e) => patchDraft(idx, { gstRate: e.target.value === '' ? null : Number(e.target.value) })}
                            style={{ width: 52, fontSize: 12, textAlign: 'right' }}
                          />
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {inr(total)}
                          {d.printedTotal != null && Math.abs(d.printedTotal - total) > 1 ? (
                            <span style={{ display: 'block', color: '#d97706', fontSize: 10 }}>
                              PDF: {inr(d.printedTotal)}
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: '6px 8px', maxWidth: 200 }}>
                          {r.warnings.length === 0 ? (
                            <span style={{ color: 'var(--green)' }}>✓ clean</span>
                          ) : (
                            <details>
                              <summary style={{ color: '#d97706', cursor: 'pointer' }}>
                                ⚠ {r.warnings.length} note{r.warnings.length === 1 ? '' : 's'}
                              </summary>
                              <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--text-muted)' }}>
                                {r.warnings.map((w, i) => (
                                  <li key={i}>{w}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                          {r.resultMsg ? (
                            <span
                              style={{
                                display: 'block',
                                marginTop: 2,
                                fontSize: 11,
                                color: r.status === 'done' ? 'var(--green)' : r.status === 'failed' ? '#dc2626' : 'var(--text-muted)',
                              }}
                            >
                              {r.status === 'creating' ? 'Creating…' : r.resultMsg}
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          <button
                            className="button-muted"
                            style={{ fontSize: 11, padding: '3px 7px' }}
                            disabled={r.status === 'done'}
                            onClick={() => onReviewOne(draftToPrefill(r))}
                          >
                            Open form →
                          </button>
                        </td>
                      </tr>
                      <tr style={{ background: 'var(--surface-2)' }}>
                        <td />
                        <td colSpan={10} style={{ padding: '0 8px 8px' }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <label style={{ flex: '1 1 320px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                              Description
                              <textarea
                                value={d.desc || ''}
                                onChange={(e) => patchDraft(idx, { desc: e.target.value || null })}
                                rows={2}
                                style={{ width: '100%', fontSize: 12, resize: 'vertical', marginTop: 2 }}
                                placeholder="read from the PDF — edit if needed"
                              />
                            </label>
                            <label style={{ width: 120, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                              HSN / SAC
                              <input
                                value={d.sac || ''}
                                onChange={(e) => patchDraft(idx, { sac: e.target.value || null })}
                                style={{ width: '100%', fontSize: 12, marginTop: 2 }}
                              />
                            </label>
                            <label style={{ width: 150, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                              PO Number
                              <input
                                value={d.po || ''}
                                onChange={(e) => patchDraft(idx, { po: e.target.value || null })}
                                style={{ width: '100%', fontSize: 12, marginTop: 2 }}
                              />
                            </label>
                          </div>
                        </td>
                      </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {error ? <div className="error" style={{ marginTop: 10 }}>{error}</div> : null}

            <div className="stack" style={{ justifyContent: 'space-between', marginTop: 14 }}>
              <button className="button-muted" onClick={() => { setPhase('select'); setRows([]); setError('') }}>
                ← Back
              </button>
              <div className="stack" style={{ gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                  {okRows.length} read · {includeCount} selected
                </span>
                <button className="button-muted" onClick={handleClose}>Done</button>
                <button className="button-primary" onClick={createAll} disabled={creating || includeCount === 0}>
                  {creating ? 'Creating…' : `Create ${includeCount || ''} invoice${includeCount === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
