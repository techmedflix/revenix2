'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import InvoiceModal, { type InvoicePrefill } from '@/components/InvoiceModal'
import MarkReceivedModal from '@/components/MarkReceivedModal'
import BulkReceiveModal, { type BulkReceiveResult } from '@/components/BulkReceiveModal'
import ChangeStatusModal from '@/components/ChangeStatusModal'
import ImportModal from '@/components/ImportModal'
import InvoicePdfImportModal from '@/components/InvoicePdfImportModal'
import { FY_OPTIONS, projectCategoryLabel } from '@/lib/constants'
import { fmtDate, formatApiError } from '@/lib/utils'
import { useGlobalFilters } from '@/lib/GlobalFiltersContext'
import { useToast } from '@/lib/ToastContext'
import { apiFetch } from '@/lib/api-fetch'

const DOC_TYPE_LABELS: Record<string, string> = {
  INV: 'Invoice', PI: 'Proforma Invoice', QUOTE: 'Quotation', CN: 'Credit Note',
}

// Sentinel value for the "Standalone (no account)" option in the Company filter.
const STANDALONE_FILTER = '__standalone__'

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

// Full-text hover with no delay — the native `title` tooltip lags ~1s, which made
// clipped invoice descriptions painful to read.
function HoverText({ text }: { text: string }) {
  const [hover, setHover] = useState(false)
  if (!text) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>-</span>
  return (
    <span
      style={{ position: 'relative', display: 'block' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-muted)' }}>
        {text}
      </span>
      {hover ? (
        <span
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 300, marginTop: 2,
            maxWidth: 420, width: 'max-content', whiteSpace: 'normal', wordBreak: 'break-word',
            background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 6,
            padding: '6px 9px', fontSize: 11, lineHeight: 1.4, color: 'var(--text)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  )
}

function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const count = selected.size
  const buttonLabel = count === 0 ? 'All' : count === 1 ? [...selected][0] : `${count} selected`
  const visibleOptions = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options

  function toggle(val: string) {
    const next = new Set(selected)
    if (next.has(val)) next.delete(val)
    else next.add(val)
    onChange(next)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {label}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
            padding: '4px 8px', minWidth: 120, fontSize: 12, fontWeight: count > 0 ? 600 : 400,
            background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
            borderRadius: 6, color: count > 0 ? 'var(--primary)' : 'var(--text)', cursor: 'pointer',
            borderColor: count > 0 ? 'var(--primary)' : 'var(--border-strong)',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{buttonLabel}</span>
          <span style={{ fontSize: 9, opacity: 0.6 }}>▼</span>
        </button>
      </label>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200, marginTop: 4,
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 8, padding: '6px 0', minWidth: 180, maxHeight: 260,
          overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          {options.length > 6 && (
            <div style={{ padding: '0 8px 4px' }}>
              <input
                type="text"
                autoFocus
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '100%', fontSize: 12, padding: '4px 6px' }}
              />
            </div>
          )}
          {count > 0 && (
            <button
              type="button"
              onClick={() => { onChange(new Set()); setOpen(false) }}
              style={{ width: '100%', textAlign: 'left', padding: '4px 12px', fontSize: 11, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border-strong)', marginBottom: 4 }}
            >
              Clear selection
            </button>
          )}
          {visibleOptions.length === 0 ? (
            <div style={{ padding: '5px 12px', fontSize: 12, color: 'var(--text-faint)' }}>No matches</div>
          ) : (
            visibleOptions.map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={selected.has(opt.value)}
                  onChange={() => toggle(opt.value)}
                  style={{ width: 13, height: 13, accentColor: 'var(--primary)', cursor: 'pointer', flexShrink: 0 }}
                />
                <span style={{ color: selected.has(opt.value) ? 'var(--text)' : 'var(--text-muted)' }}>{opt.label}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}

type InvoiceRow = {
  id: string
  entity: 'PMD' | 'Medflix' | 'Metflix'
  docType: 'INV' | 'PI' | 'QUOTE' | 'CN'
  invNo: string | null
  pi: string | null
  po: string | null
  date: string
  effDate: string | null
  fy: string
  expectedFY: string | null
  clientCode: string | null
  clientName: string | null
  company: string | null
  gstId: string | null
  state: string | null
  creditDays: number
  projectCategory: string | null
  offeringName: string | null
  sac: string | null
  desc: string | null
  currency: string
  fxRate: number
  gross: number
  disc: number
  net: number
  gst: number
  gstRate: number
  amt: number
  dueDate: string | null
  expectedPaymentDate: string | null
  status: 'draft' | 'sent' | 'overdue' | 'partial' | 'gst_pending' | 'paid' | 'cancelled' | 'credit_note'
  comments: string | null
  irn: string | null
  ackNo: string | null
  ackDate: string | null
  amountReceived: number
  pendingAmount: number
  tdsPercent: number | null
  tdsAmount: number | null
  gstWithheld: boolean
  gstWithheldAmount: number | null
  accountId: string | null
  linkedInvoiceId: string | null
  opportunityId: string | null
  account?: { id: string; name: string } | null
  linkedInvoice?: { id: string; invNo: string | null; amt: number } | null
  receipts: Array<{
    id: string
    amountReceived: number
    receivedDate: string
    tdsPercent: number
    tdsAmount: number
    gstWithheld: boolean
    gstWithheldAmount: number
    netToBank: number
    notes: string | null
  }>
}

type Account = {
  id: string
  name: string
  type: 'company' | 'cluster' | 'division' | 'brand'
  parentId: string | null
  vendorRegistered?: boolean
}

function getAncestor(accountId: string, accountsById: Map<string, Account>, targetType: Account['type']) {
  let current = accountsById.get(accountId) || null
  while (current) {
    if (current.type === targetType) return current
    current = current.parentId ? accountsById.get(current.parentId) || null : null
  }
  return null
}

// A won opportunity, offered in the invoice form as "Order Book / Particulars" to auto-fill
// category/offering/description/qty from the deal and link the invoice to it.
type WonOpportunity = {
  id: string
  accountId: string
  account: { id: string; name: string } | null
  projectType: string
  projectCategory: string
  description: string | null
  totalQty: number | null
  unitRevenue: number | null
  estimatedValue: number
  invoicedAmount: number
}

const STATUS_COLORS: Record<InvoiceRow['status'], string> = {
  draft: '#6b7280',
  sent: '#2563eb',
  overdue: '#dc2626',
  partial: '#d97706',
  gst_pending: '#0891b2',
  paid: '#16a34a',
  cancelled: '#9ca3af',
  credit_note: '#7c3aed',
}

function quarterFromDate(dateStr: string) {
  const d = new Date(dateStr)
  const m = d.getMonth() + 1
  if (m >= 4 && m <= 6) return 'Q1'
  if (m >= 7 && m <= 9) return 'Q2'
  if (m >= 10 && m <= 12) return 'Q3'
  return 'Q4'
}

export default function InvoicingClient() {
  const { entity: globalEntity, fy: globalFY } = useGlobalFilters()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [allStatuses, setAllStatuses] = useState<string[]>([])
  const [allFYs, setAllFYs] = useState<string[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [wonOpportunities, setWonOpportunities] = useState<WonOpportunity[]>([])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set())
  const [localFY, setLocalFY] = useState<Set<string>>(new Set())
  const [quarterFilter, setQuarterFilter] = useState<Set<string>>(new Set())
  const [docTypeFilter, setDocTypeFilter] = useState<Set<string>>(new Set())
  const [gstPendingFilter, setGstPendingFilter] = useState(false)
  const [companyFilter, setCompanyFilter] = useState<Set<string>>(new Set())
  const [projectTypeFilter, setProjectTypeFilter] = useState<Set<string>>(new Set())
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set())

  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoiceEditing, setInvoiceEditing] = useState<InvoiceRow | null>(null)
  const [invoiceStep, setInvoiceStep] = useState(1)
  const [invoicePrefill, setInvoicePrefill] = useState<InvoicePrefill | null>(null)
  const [showPdfImport, setShowPdfImport] = useState(false)
  // When the invoice form was opened from the PDF-import review list, return to that
  // list on close so the other parsed rows aren't lost.
  const [pdfReturnPending, setPdfReturnPending] = useState(false)
  const [pdfDoneInvNo, setPdfDoneInvNo] = useState<string | null>(null)
  // Set synchronously by InvoiceModal.onSaved (which fires just before onClose) so
  // close can tell a real save from a cancel.
  const pdfSavedInvNoRef = useRef<string | null>(null)

  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receiveInvoice, setReceiveInvoice] = useState<InvoiceRow | null>(null)
  const [receiveGstDefault, setReceiveGstDefault] = useState(false)
  const [showBulkReceive, setShowBulkReceive] = useState(false)

  const [changeStatusInvoice, setChangeStatusInvoice] = useState<InvoiceRow | null>(null)
  const [changeStatusTarget, setChangeStatusTarget] = useState<'sent' | 'overdue'>('sent')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showReceivedDatesImport, setShowReceivedDatesImport] = useState(false)
  const [showFieldsImport, setShowFieldsImport] = useState(false)
  const { toast } = useToast()

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Effective FY = local override if set, else global
  const effectiveFY = localFY.size > 0 ? [...localFY][0] : globalFY

  async function load() {
    setLoading(true)
    setError('')

    const params = new URLSearchParams()
    if (globalEntity) params.set('entity', globalEntity)
    if (effectiveFY) params.set('fy', effectiveFY)
    if (gstPendingFilter) params.set('gstPending', 'true')

    try {
      const [invRes, allInvRes, accRes, wonRes] = await Promise.all([
        apiFetch(`/api/invoices${params.toString() ? `?${params.toString()}` : ''}`),
        // Fetch unfiltered to populate dynamic dropdown options
        apiFetch('/api/invoices?_meta=options'),
        apiFetch('/api/accounts'),
        apiFetch('/api/opportunities?leadType=won'),
      ])

      if (!invRes.ok) {
        const e = await invRes.json().catch(() => ({}))
        throw new Error(`Failed to load invoices (${invRes.status}): ${e.error || ''}`)
      }
      if (!accRes.ok || !wonRes.ok) throw new Error('Failed to load invoicing data')

      const invData = (await invRes.json()) as InvoiceRow[]
      const allInvData = allInvRes.ok ? (await allInvRes.json()) as InvoiceRow[] : invData
      const accData = (await accRes.json()) as { accounts: Account[] }
      const wonData = (await wonRes.json()) as WonOpportunity[]

      setInvoices(invData)
      // Build dropdown options from ALL invoices (not filtered)
      const statusSet = new Set(allInvData.map((r) => r.status))
      setAllStatuses(['draft','sent','overdue','partial','gst_pending','paid','cancelled','credit_note'].filter((v) => statusSet.has(v as InvoiceRow['status'])))
      const fySet = new Set(allInvData.map((r) => r.fy).filter(Boolean))
      setAllFYs(FY_OPTIONS.filter((f) => fySet.has(f)))
      setAccounts(accData.accounts || [])
      setWonOpportunities(wonData || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load invoicing data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFY, globalEntity, globalFY, gstPendingFilter])

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  // Resolve an invoice to its top-level company name — rolls up divisions/clusters to their
  // parent company (invoices are often linked to a division/cluster account, not the company
  // itself), falling back to the legacy free-text fields for standalone/unlinked invoices.
  function companyNameForRow(row: InvoiceRow) {
    if (row.accountId) {
      const company = getAncestor(row.accountId, accountsById, 'company')
      if (company) return company.name
    }
    return row.account?.name || row.company || row.clientName || ''
  }

  // Client-side filtered view (status, docType, quarter, company, type, category all client-side)
  const filteredInvoices = useMemo(() => {
    const q = search.toLowerCase()
    return invoices.filter((row) => {
      const company = companyNameForRow(row).toLowerCase()
      const projType = (row.offeringName || '').toLowerCase()
      const projCat = (row.projectCategory || '').toLowerCase()
      const invNo = (row.invNo || '').toLowerCase()
      const desc = (row.desc || '').toLowerCase()

      if (q && !company.includes(q) && !invNo.includes(q) && !projType.includes(q) && !projCat.includes(q) && !desc.includes(q)) return false
      if (statusFilter.size > 0 && !statusFilter.has(row.status)) return false
      if (docTypeFilter.size > 0 && !docTypeFilter.has(row.docType)) return false
      if (companyFilter.size > 0) {
        // "Standalone" matches invoices with no company-account link — the ones that
        // read as a plain name in the list but show "Standalone" in the editor.
        const isStandalone = !row.accountId || !getAncestor(row.accountId, accountsById, 'company')
        const matchesName = companyFilter.has(companyNameForRow(row))
        const matchesStandalone = companyFilter.has(STANDALONE_FILTER) && isStandalone
        if (!matchesName && !matchesStandalone) return false
      }
      if (projectTypeFilter.size > 0 && !projectTypeFilter.has(row.offeringName || '')) return false
      if (categoryFilter.size > 0 && !categoryFilter.has(row.projectCategory || '')) return false
      if (quarterFilter.size > 0 && !quarterFilter.has(quarterFromDate(row.date))) return false
      return true
    })
  }, [invoices, search, statusFilter, docTypeFilter, companyFilter, projectTypeFilter, categoryFilter, quarterFilter, accountsById])

  // Reset to page 1 whenever the filtered set changes shape (new search/filter, or a reload)
  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, docTypeFilter, companyFilter, projectTypeFilter, categoryFilter, quarterFilter, pageSize])

  const pageCount = Math.max(1, Math.ceil(filteredInvoices.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pagedInvoices = useMemo(
    () => filteredInvoices.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredInvoices, currentPage, pageSize],
  )

  // Dynamic dropdown options from ALL loaded invoices (rolled up to top-level company).
  // "Standalone" is a pseudo-option covering invoices with no company-account link.
  const allCompanies = useMemo(() => {
    const s = new Set<string>()
    let hasStandalone = false
    invoices.forEach(r => {
      const n = companyNameForRow(r)
      if (n) s.add(n)
      if (!r.accountId || !getAncestor(r.accountId, accountsById, 'company')) hasStandalone = true
    })
    const named = Array.from(s).sort()
    return hasStandalone ? [STANDALONE_FILTER, ...named] : named
  }, [invoices, accountsById])

  const allProjectTypes = useMemo(() => {
    const s = new Set<string>()
    invoices.forEach(r => { if (r.offeringName) s.add(r.offeringName) })
    return Array.from(s).sort()
  }, [invoices])

  const allCategories = useMemo(() => {
    const s = new Set<string>()
    invoices.forEach(r => { if (r.projectCategory) s.add(r.projectCategory) })
    return Array.from(s).sort()
  }, [invoices])

  const { totals, tdsDeducted } = useMemo(() => {
    const t = { total: 0, received: 0, pending: 0, gstPending: 0 }
    let tds = 0
    for (const row of filteredInvoices) {
      // Exclude non-receivable rows from all totals
      if (['cancelled', 'credit_note', 'draft'].includes(row.status)) continue
      if (['PI', 'QUOTE'].includes(row.docType)) continue
      t.total += row.gross
      t.received += row.amountReceived
      const tdsAmt = row.tdsAmount ?? 0
      if (row.status !== 'paid') {
        t.pending += Math.max(0, row.gross - row.amountReceived - tdsAmt)
        t.gstPending += row.gst
      }
      if (row.tdsAmount != null && row.tdsAmount > 0) tds += row.tdsAmount
    }
    return { totals: t, tdsDeducted: tds }
  }, [invoices])

  async function updateStatus(id: string, status: InvoiceRow['status']) {
    const res = await apiFetch(`/api/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      toast('Status updated', 'success')
    } else {
      const payload = await res.json().catch(() => ({}))
      toast(formatApiError(payload, 'Failed to update status'), 'error')
    }
    load()
  }

  function handleStatusChange(row: InvoiceRow, newStatus: string) {
    if (newStatus === row.status) return
    if (newStatus === 'paid' || newStatus === 'partial' || newStatus === 'gst_pending') {
      // Open the receipt flow instead of writing the status directly — GST Pending is
      // just a receipt with the GST slice withheld, so it asks the same questions.
      setReceiveGstDefault(newStatus === 'gst_pending')
      setReceiveInvoice(row)
      setShowReceiveModal(true)
    } else if (newStatus === 'sent' || newStatus === 'overdue') {
      // Receivables/Overdue are normally derived from the due date — confirm the manual
      // change (and let the user adjust the due date) before pinning it.
      setChangeStatusTarget(newStatus)
      setChangeStatusInvoice(row)
    } else {
      updateStatus(row.id, newStatus as InvoiceRow['status'])
    }
  }

  async function runBulkReceive(result: BulkReceiveResult) {
    if (result.failed > 0) {
      toast(
        `${result.succeeded} marked received. ${result.failed} failed: ${result.failMessages.join(' ')}`,
        'error',
      )
    } else if (result.succeeded > 0) {
      toast(`${result.succeeded} invoice${result.succeeded !== 1 ? 's' : ''} marked received`, 'success')
    }
    setSelectedIds(new Set())
    load()
  }

  async function duplicateInvoice(row: InvoiceRow) {
    const payload = {
      entity: row.entity,
      docType: row.docType,
      invNo: null,
      pi: row.pi,
      po: row.po,
      date: new Date().toISOString(),
      effDate: null,
      clientCode: row.clientCode,
      clientName: row.clientName,
      company: row.company,
      gstId: row.gstId,
      state: row.state,
      creditDays: row.creditDays,
      offeringName: row.offeringName,
      sac: row.sac,
      desc: row.desc,
      currency: row.currency,
      fxRate: row.fxRate,
      gross: row.gross,
      disc: row.disc,
      gstRate: row.gstRate,
      dueDate: row.dueDate,
      expectedPaymentDate: row.expectedPaymentDate,
      status: 'draft' as const,
      comments: row.comments,
      accountId: row.accountId,
    }
    const res = await apiFetch('/api/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      toast('Invoice duplicated!', 'success')
    } else {
      const info = await res.json().catch(() => ({}))
      toast(formatApiError(info, 'Failed to duplicate invoice'), 'error')
    }
    load()
  }

  async function deleteSelected() {
    const count = selectedIds.size
    if (!confirm(`Delete ${count} invoice${count !== 1 ? 's' : ''}?`)) return
    const results = await Promise.all(
      Array.from(selectedIds).map(async (id) => {
        const res = await apiFetch(`/api/invoices/${id}`, { method: 'DELETE' })
        if (res.ok) return { ok: true as const }
        const payload = await res.json().catch(() => ({}))
        return { ok: false as const, message: formatApiError(payload, 'Failed to delete') }
      }),
    )
    const failed = results.filter((r) => !r.ok)
    if (failed.length > 0) {
      const uniqueMessages = Array.from(new Set(failed.map((r) => (r as { message: string }).message)))
      toast(`${results.length - failed.length} of ${results.length} deleted. ${failed.length} failed: ${uniqueMessages.join(' ')}`, 'error')
    } else {
      toast(`${count} invoice${count !== 1 ? 's' : ''} deleted`, 'success')
    }
    load()
    setSelectedIds(new Set())
  }

  async function exportToExcel() {
    const XLSX = await import('xlsx')
    const rows = invoices.map((row) => ({
      'Inv#': row.invNo || `${row.docType}-draft`,
      'Company': row.company || row.clientName || '',
      'Entity': row.entity,
      'Doc Type': row.docType,
      'FY': row.fy || '',
      'Qtr': quarterFromDate(row.date),
      'Date': row.date.slice(0, 10),
      'Gross (INR)': row.net,
      'GST': row.gst,
      'Total (INR)': row.amt,
      'Received': row.amountReceived,
      'Pending': Math.max(0, row.amt - row.amountReceived),
      'TDS %': row.tdsPercent ?? '',
      'TDS Deducted': row.tdsAmount ?? 0,
      'GST Withheld': row.gstWithheld ? (row.gstWithheldAmount ?? 0) : 0,
      'Status': STATUS_LABEL[row.status] || row.status,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices')
    XLSX.writeFile(wb, 'invoices.xlsx')
  }

  async function downloadInvoiceTemplate() {
    const XLSX = await import('xlsx')
    const headers = [
      'Invoice #', 'Entity (PMD/Medflix)', 'Doc Type (INV/PI/QUOTE/CN)',
      'Company Name', 'Client Name', 'GST ID', 'State', 'Credit Days',
      'Date (YYYY-MM-DD)', 'FY (e.g. FY 25-26)', 'Project Category', 'Project Type',
      'SAC Code', 'Description', 'Currency', 'FX Rate',
      'Gross Amount (INR)', 'Discount', 'GST Rate (%)',
      'Due Date (YYYY-MM-DD)', 'Status (draft/sent/paid/etc)', 'TDS % (e.g. 2)',
      'Comments',
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers])
    ws['!cols'] = headers.map(() => ({ wch: 22 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice Template')
    XLSX.writeFile(wb, 'invoice-import-template.xlsx')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Invoicing</h1>
        <div className="stack" style={{ gap: 8 }}>
          {selectedIds.size > 0 ? (
            <>
              <button
                className="button-muted"
                style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
                onClick={() => setShowBulkReceive(true)}
              >
                Mark Received ({selectedIds.size})
              </button>
              <button
                className="button-muted"
                style={{ color: '#dc2626', borderColor: '#dc2626' }}
                onClick={deleteSelected}
              >
                Delete Selected ({selectedIds.size})
              </button>
            </>
          ) : null}
          <button className="button-muted" onClick={downloadInvoiceTemplate} title="Download blank Excel template for bulk import">
            ↓ Template
          </button>
          <button
            className="button-muted"
            onClick={() => setShowImportModal(true)}
            title="Import invoices from Google Sheet or Excel file"
            style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
          >
            ↑ Import
          </button>
          <button
            className="button-muted"
            onClick={() => setShowPdfImport(true)}
            title="Read one or more invoice PDFs and pre-fill the values"
            style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
          >
            ↑ PDF
          </button>
          <button
            className="button-muted"
            onClick={() => setShowReceivedDatesImport(true)}
            title="Upload an Excel/CSV of Invoice Number + Received Date to correct received dates in bulk"
            style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
          >
            ↑ Recd Dates
          </button>
          <button
            className="button-muted"
            onClick={() => setShowFieldsImport(true)}
            title="Bulk-update SAC/HSN, Client GSTIN, IRN, Project Category/Type, Registered Name by Invoice Number"
            style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
          >
            ↑ Fields
          </button>
          <button className="button-muted" onClick={exportToExcel}>
            Export
          </button>
          <button
            className="button-primary"
            onClick={() => {
              setInvoiceEditing(null)
              setInvoicePrefill(null)
              setInvoiceStep(1)
              setShowInvoiceModal(true)
            }}
          >
            + New Invoice
          </button>
        </div>
      </div>

      {/* KPI Pills */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          { label: 'Gross Invoiced', value: totals.total, color: '#0f6ef2' },
          { label: 'Received', value: totals.received, color: '#16a34a' },
          { label: 'Receivables', value: totals.pending, color: '#d97706' },
          { label: 'TDS Deducted', value: tdsDeducted, color: '#7c3aed' },
          { label: 'GST Outstanding', value: totals.gstPending, color: '#dc2626' },
        ].map((pill) => (
          <div
            key={pill.label}
            className="card"
            style={{ flex: '1 1 160px', padding: '10px 16px', borderTop: `3px solid ${pill.color}` }}
          >
            <div className="kpi-sub">{pill.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: pill.color, marginTop: 2 }}>
              ₹{pill.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card toolbar-card" style={{ marginBottom: 12 }}>
        <div className="stack" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label>
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Invoice #, company, type…"
              style={{ minWidth: 200 }}
            />
          </label>

          <MultiSelect
            label="FY"
            options={allFYs.map(f => ({ value: f, label: f }))}
            selected={localFY}
            onChange={setLocalFY}
          />

          <MultiSelect
            label="Quarter"
            options={[
              { value: 'Q1', label: 'Q1 (Apr–Jun)' },
              { value: 'Q2', label: 'Q2 (Jul–Sep)' },
              { value: 'Q3', label: 'Q3 (Oct–Dec)' },
              { value: 'Q4', label: 'Q4 (Jan–Mar)' },
            ]}
            selected={quarterFilter}
            onChange={setQuarterFilter}
          />

          <MultiSelect
            label="Status"
            options={allStatuses.map(s => ({ value: s, label: STATUS_LABEL[s] || s }))}
            selected={statusFilter}
            onChange={setStatusFilter}
          />

          <MultiSelect
            label="Doc Type"
            options={[
              { value: 'INV', label: 'Invoice' },
              { value: 'PI', label: 'Proforma Invoice' },
              { value: 'QUOTE', label: 'Quotation' },
              { value: 'CN', label: 'Credit Note' },
            ]}
            selected={docTypeFilter}
            onChange={setDocTypeFilter}
          />

          <MultiSelect
            label="Company"
            options={allCompanies.map(c => ({ value: c, label: c === STANDALONE_FILTER ? 'Standalone (no account)' : c }))}
            selected={companyFilter}
            onChange={setCompanyFilter}
          />

          <MultiSelect
            label="Category"
            options={allCategories.map(c => ({ value: c, label: projectCategoryLabel(c) }))}
            selected={categoryFilter}
            onChange={setCategoryFilter}
          />

          <MultiSelect
            label="Project Type"
            options={allProjectTypes.map(t => ({ value: t, label: t }))}
            selected={projectTypeFilter}
            onChange={setProjectTypeFilter}
          />

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            GST Withheld
            <select
              value={gstPendingFilter ? 'yes' : 'no'}
              onChange={(e) => setGstPendingFilter(e.target.value === 'yes')}
            >
              <option value="no">All</option>
              <option value="yes">Withheld only</option>
            </select>
          </label>

          {(localFY.size > 0 || statusFilter.size > 0 || search || quarterFilter.size > 0 || docTypeFilter.size > 0 || gstPendingFilter || companyFilter.size > 0 || projectTypeFilter.size > 0 || categoryFilter.size > 0) ? (
            <button
              className="button-muted"
              style={{ alignSelf: 'flex-end' }}
              onClick={() => {
                setLocalFY(new Set())
                setStatusFilter(new Set())
                setSearch('')
                setQuarterFilter(new Set())
                setDocTypeFilter(new Set())
                setGstPendingFilter(false)
                setCompanyFilter(new Set())
                setProjectTypeFilter(new Set())
                setCategoryFilter(new Set())
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {loading ? <div className="card">Loading invoices...</div> : null}
      {error ? <div className="error">{error}</div> : null}

      {!loading ? (
        <>
        <div className="table-wrap">
          <table style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 32 }}>
                  <input
                    type="checkbox"
                    title="Select all rows on this page"
                    checked={pagedInvoices.length > 0 && pagedInvoices.every((r) => selectedIds.has(r.id))}
                    onChange={(e) => {
                      const next = new Set(selectedIds)
                      if (e.target.checked) {
                        pagedInvoices.forEach((r) => next.add(r.id))
                      } else {
                        pagedInvoices.forEach((r) => next.delete(r.id))
                      }
                      setSelectedIds(next)
                    }}
                  />
                </th>
                <th style={{ minWidth: 130 }}>Invoice #</th>
                <th style={{ minWidth: 160 }}>Company</th>
                <th style={{ minWidth: 130 }}>Type / Category</th>
                <th style={{ minWidth: 240 }}>Description</th>
                <th style={{ minWidth: 100 }}>Date</th>
                <th style={{ minWidth: 110 }}>Gross (INR)</th>
                <th style={{ minWidth: 110 }}>Total (INR)</th>
                <th style={{ minWidth: 120 }}>Status</th>
                <th style={{ minWidth: 120 }}>Pending</th>
                <th style={{ minWidth: 100 }}>Due Date</th>
                <th style={{ minWidth: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: 24 }}>No invoices found.</td>
                </tr>
              ) : (
                pagedInvoices.map((row) => {
                  const tds = row.tdsAmount ?? 0
                  const pending = (row.status === 'credit_note' || row.status === 'cancelled' || ['PI', 'QUOTE'].includes(row.docType))
                    ? 0
                    : row.status === 'paid'
                      ? 0
                      : Math.max(0, row.amt - row.amountReceived - tds)
                  const projCategory = row.projectCategory || '-'
                  const projType = row.offeringName || '-'
                  const projDesc = row.desc || '-'
                  // Rolled up to the top-level company (not row.account?.name directly) — an
                  // invoice is often linked to a division/cluster account, and showing that raw
                  // name instead of the company made rows unreadable once a division was set.
                  const companyName = companyNameForRow(row) || '-'
                  const isOverdue = row.status === 'overdue'

                  const isExpanded = expandedIds.has(row.id)
                  return (
                    <React.Fragment key={row.id}>
                    <tr
                      style={{ background: isOverdue ? 'rgba(255,95,95,0.06)' : undefined, cursor: 'pointer' }}
                      onClick={(e) => {
                        // Let checkboxes, the expand toggle, the status dropdown and the
                        // action buttons handle their own clicks.
                        if ((e.target as HTMLElement).closest('button, input, select, a')) return
                        setInvoiceEditing(row); setInvoicePrefill(null); setInvoiceStep(1); setShowInvoiceModal(true)
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds)
                            if (e.target.checked) next.add(row.id)
                            else next.delete(row.id)
                            setSelectedIds(next)
                          }}
                        />
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <button
                            onClick={() => toggleExpand(row.id)}
                            title={isExpanded ? 'Collapse' : 'Expand details'}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--text-faint)', fontSize: 10, lineHeight: 1, flexShrink: 0 }}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                          {row.invNo || `${row.docType}-draft`}
                        </div>
                      </td>
                      <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }} title={companyName}>
                        {companyName}
                      </td>
                      <td style={{ fontSize: 12, lineHeight: 1.35 }}>
                        <div>{projType}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {projCategory !== '-' ? projectCategoryLabel(projCategory) : '-'}
                        </div>
                      </td>
                      <td style={{ maxWidth: 240 }}>
                        <HoverText text={projDesc !== '-' ? projDesc : ''} />
                      </td>
                      <td style={{ fontSize: 12 }}>{fmtDate(row.date)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>₹{row.gross.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13 }}>₹{row.amt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                      <td>
                        <select
                          value={row.status}
                          onChange={(e) => handleStatusChange(row, e.target.value)}
                          style={{
                            fontSize: 11, padding: '2px 6px', border: '1.5px solid',
                            borderColor: STATUS_COLORS[row.status], color: STATUS_COLORS[row.status],
                            background: 'var(--surface-2)', borderRadius: 4, fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          <option value="draft">{STATUS_LABEL.draft}</option>
                          <option value="sent">{STATUS_LABEL.sent}</option>
                          <option value="overdue">{STATUS_LABEL.overdue}</option>
                          <option value="partial">{STATUS_LABEL.partial}</option>
                          <option value="gst_pending">{STATUS_LABEL.gst_pending}</option>
                          <option value="paid">{STATUS_LABEL.paid}</option>
                          <option value="cancelled">{STATUS_LABEL.cancelled}</option>
                          <option value="credit_note">{STATUS_LABEL.credit_note}</option>
                        </select>
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 13 }}>
                        <div style={{ color: pending > 0 ? 'var(--red)' : 'var(--green)' }}>
                          ₹{pending.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                        {row.amountReceived > 0 && pending > 0 ? (
                          <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)' }}>
                            ₹{row.amountReceived.toLocaleString('en-IN', { maximumFractionDigits: 0 })} in
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`badge ${isOverdue ? 'badge-red' : 'badge-blue'}`}
                          style={{ fontSize: 11 }}
                        >
                          {fmtDate(row.dueDate)}
                        </span>
                      </td>
                      <td>
                        <div className="stack" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          {/* Mark Received / Receipt History */}
                          <button
                            className="icon-btn"
                            onClick={() => { setReceiveInvoice(row); setShowReceiveModal(true) }}
                            title={row.status === 'paid' ? 'View/edit receipts' : 'Mark received'}
                            style={{ padding: '4px 7px', color: 'var(--green)', border: '1px solid rgba(34,217,138,0.35)', borderRadius: 6, background: 'rgba(34,217,138,0.10)', display: 'flex', alignItems: 'center' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </button>
                          {/* Edit */}
                          <button
                            className="icon-btn"
                            onClick={() => { setInvoiceEditing(row); setInvoicePrefill(null); setInvoiceStep(1); setShowInvoiceModal(true) }}
                            title="Edit invoice"
                            style={{ padding: '4px 7px', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          {/* Duplicate */}
                          <button
                            className="icon-btn"
                            onClick={() => duplicateInvoice(row)}
                            title="Duplicate invoice"
                            style={{ padding: '4px 7px', color: 'var(--text-faint)', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                          </button>
                          {/* Preview */}
                          <button
                            className="icon-btn"
                            onClick={() => { setInvoiceEditing(row); setInvoicePrefill(null); setInvoiceStep(3); setShowInvoiceModal(true) }}
                            title="Preview"
                            style={{ padding: '4px 7px', color: 'var(--primary)', border: '1px solid rgba(74,158,255,0.35)', borderRadius: 6, background: 'rgba(74,158,255,0.10)', display: 'flex', alignItems: 'center' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                              <circle cx="12" cy="12" r="3"/>
                            </svg>
                          </button>
                          {/* Delete */}
                          <button
                            className="icon-btn"
                            onClick={async () => {
                              if (!confirm(`Delete invoice ${row.invNo || row.id}?`)) return
                              const r = await apiFetch(`/api/invoices/${row.id}`, { method: 'DELETE' })
                              if (r.ok) {
                                toast('Invoice deleted', 'success')
                              } else {
                                const payload = await r.json().catch(() => ({}))
                                toast(formatApiError(payload, 'Failed to delete invoice'), 'error')
                              }
                              load()
                            }}
                            title="Delete invoice"
                            style={{ padding: '4px 7px', color: '#dc2626', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 6, background: 'rgba(220,38,38,0.08)', display: 'flex', alignItems: 'center' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                              <path d="M10 11v6M14 11v6"/>
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr key={`${row.id}-detail`} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td colSpan={12} style={{ padding: '10px 16px 14px 44px', borderBottom: '2px solid var(--border-strong)' }}>
                          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12, marginBottom: 10 }}>
                            <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Doc Type: </span><span style={{ color: 'var(--text)' }}>{DOC_TYPE_LABELS[row.docType] || row.docType}</span></div>
                            <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Entity: </span><span style={{ color: 'var(--text)' }}>{row.entity}</span></div>
                            <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>FY: </span><span style={{ color: 'var(--text)' }}>{row.fy || '—'}</span></div>
                            <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Quarter: </span><span style={{ color: 'var(--text)' }}>{quarterFromDate(row.date)}</span></div>
                            <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>GST: </span><span style={{ color: 'var(--text)' }}>₹{row.gst.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ({row.gstRate}%)</span></div>
                            <div>
                              <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>TDS: </span>
                              <span style={{ color: row.tdsAmount ? 'var(--purple)' : 'var(--text-faint)' }}>
                                {row.tdsAmount ? `₹${row.tdsAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${row.tdsPercent}%)` : '—'}
                              </span>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>GST Withheld: </span>
                              <span style={{ color: row.gstWithheld ? 'var(--amber)' : 'var(--text-faint)' }}>
                                {row.gstWithheld ? (row.gstWithheldAmount ? `₹${row.gstWithheldAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : 'Yes') : '—'}
                              </span>
                            </div>
                            {row.creditDays ? <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Credit Days: </span><span style={{ color: 'var(--text)' }}>{row.creditDays}</span></div> : null}
                            {row.po ? <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>PO: </span><span style={{ color: 'var(--text)' }}>{row.po}</span></div> : null}
                          </div>
                          {/* e-Invoice acknowledgement */}
                          {(row.irn || row.ackNo || row.ackDate) ? (
                            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12, marginBottom: 10 }}>
                              {row.irn ? (
                                <div style={{ maxWidth: '100%' }} title={row.irn}>
                                  <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>IRN: </span>
                                  <span style={{ color: 'var(--text)', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{row.irn}</span>
                                </div>
                              ) : null}
                              {row.ackNo ? <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Ack No: </span><span style={{ color: 'var(--text)' }}>{row.ackNo}</span></div> : null}
                              {row.ackDate ? <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Ack Date: </span><span style={{ color: 'var(--text)' }}>{fmtDate(row.ackDate)}</span></div> : null}
                            </div>
                          ) : null}
                          {/* Account linking */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                            <span style={{ color: 'var(--text-faint)', fontWeight: 600, whiteSpace: 'nowrap' }}>Linked Account:</span>
                            {row.account ? (
                              <span style={{ color: 'var(--primary)', fontWeight: 600 }}>✓ {row.account.name}</span>
                            ) : (
                              <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>Not linked</span>
                            )}
                            <select
                              value={row.accountId || ''}
                              onChange={async (e) => {
                                const accountId = e.target.value || null
                                const res = await apiFetch(`/api/invoices/${row.id}`, {
                                  method: 'PATCH',
                                  headers: { 'content-type': 'application/json' },
                                  body: JSON.stringify({ accountId }),
                                })
                                if (!res.ok) {
                                  const payload = await res.json().catch(() => ({}))
                                  toast(formatApiError(payload, 'Failed to link account'), 'error')
                                }
                                load()
                              }}
                              style={{
                                fontSize: 11, padding: '2px 6px', border: '1px solid var(--border-strong)',
                                background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 4, maxWidth: 220,
                              }}
                            >
                              <option value="">— Select account —</option>
                              {accounts
                                .filter((a) => a.type === 'company')
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((a) => (
                                  <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                            </select>
                          </div>
                          {/* Credit note invoice linking */}
                          {row.status === 'credit_note' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 8 }}>
                              <span style={{ color: 'var(--purple)', fontWeight: 600, whiteSpace: 'nowrap' }}>Linked Invoice:</span>
                              {row.linkedInvoice ? (
                                <span style={{ color: 'var(--purple)', fontWeight: 600 }}>✓ {row.linkedInvoice.invNo || row.linkedInvoice.id} (₹{row.linkedInvoice.amt.toLocaleString('en-IN', { maximumFractionDigits: 0 })})</span>
                              ) : (
                                <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>Not linked</span>
                              )}
                              <select
                                value={row.linkedInvoiceId || ''}
                                onChange={async (e) => {
                                  const linkedInvoiceId = e.target.value || null
                                  const res = await apiFetch(`/api/invoices/${row.id}`, {
                                    method: 'PATCH',
                                    headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({ linkedInvoiceId }),
                                  })
                                  if (!res.ok) {
                                    const payload = await res.json().catch(() => ({}))
                                    toast(formatApiError(payload, 'Failed to link invoice'), 'error')
                                  }
                                  load()
                                }}
                                style={{
                                  fontSize: 11, padding: '2px 6px', border: '1px solid rgba(124,58,237,0.4)',
                                  background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 4, maxWidth: 280,
                                }}
                              >
                                <option value="">— Select invoice to nullify —</option>
                                {invoices
                                  .filter((i) => i.id !== row.id && i.status !== 'credit_note' && i.status !== 'cancelled')
                                  .sort((a, b) => (b.invNo || '').localeCompare(a.invNo || ''))
                                  .map((i) => (
                                    <option key={i.id} value={i.id}>
                                      {i.invNo || i.id} — {i.account?.name || i.company || i.clientName || '?'} — ₹{i.amt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredInvoices.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            <div>
              Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredInvoices.length)} of {filteredInvoices.length}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Rows per page
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="button-muted" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Prev
                </button>
                <span>Page {currentPage} of {pageCount}</span>
                <button className="button-muted" disabled={currentPage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : null}
        </>
      ) : null}

      <InvoiceModal
        open={showInvoiceModal}
        invoice={invoiceEditing}
        accounts={accounts}
        wonOpportunities={wonOpportunities}
        initialStep={invoiceStep}
        prefill={invoicePrefill}
        onClose={() => {
          setShowInvoiceModal(false)
          setInvoicePrefill(null)
          if (pdfReturnPending) {
            setPdfReturnPending(false)
            setPdfDoneInvNo(pdfSavedInvNoRef.current)
            pdfSavedInvNoRef.current = null
            setShowPdfImport(true)
          }
        }}
        onSaved={() => {
          load()
          if (pdfReturnPending) pdfSavedInvNoRef.current = invoicePrefill?.invNo || null
        }}
        onAccountsChanged={load}
      />

      <InvoicePdfImportModal
        open={showPdfImport}
        accounts={accounts}
        wonOpportunities={wonOpportunities}
        markDoneInvNo={pdfDoneInvNo}
        onClose={() => { setShowPdfImport(false); setPdfDoneInvNo(null) }}
        onCreated={load}
        onReviewOne={(pf) => {
          setShowPdfImport(false)
          setPdfReturnPending(true)
          setPdfDoneInvNo(null)
          pdfSavedInvNoRef.current = null
          setInvoiceEditing(null)
          setInvoicePrefill(pf)
          setInvoiceStep(1)
          setShowInvoiceModal(true)
        }}
      />

      <MarkReceivedModal
        open={showReceiveModal}
        invoice={receiveInvoice}
        receipts={receiveInvoice?.receipts ?? []}
        defaultGstWithheld={receiveGstDefault}
        onClose={() => setShowReceiveModal(false)}
        onSaved={load}
      />

      <BulkReceiveModal
        open={showBulkReceive}
        invoices={filteredInvoices.filter((r) => selectedIds.has(r.id))}
        onClose={() => setShowBulkReceive(false)}
        onComplete={runBulkReceive}
      />

      <ChangeStatusModal
        open={changeStatusInvoice !== null}
        invoice={changeStatusInvoice}
        targetStatus={changeStatusTarget}
        onClose={() => setChangeStatusInvoice(null)}
        onSaved={load}
      />

      <ImportModal
        open={showImportModal}
        title="Import Invoices"
        sheetApiPath="/api/invoices/import-sheet"
        excelApiPath="/api/invoices/import-excel"
        defaultSheetUrl="https://docs.google.com/spreadsheets/d/102XpFlGrSGbhdJwgr58-bduOm2wfctE-wXyIVlqLkXE/export?format=csv&gid=401418141"
        templateColumns={[
          'Invoice #', 'Entity (PMD/Medflix)', 'Doc Type', 'Company', 'Client Name',
          'GST ID', 'State', 'Credit Days', 'Date', 'FY', 'Project Category',
          'Project Type', 'SAC', 'Description', 'Currency', 'FX Rate',
          'Gross (INR)', 'Discount', 'GST Rate %', 'Due Date', 'Status',
          'TDS %', 'Comments', 'Amount Received', 'GST Withheld (Yes/No)',
        ]}
        onClose={() => setShowImportModal(false)}
        onImported={load}
      />

      <ImportModal
        open={showReceivedDatesImport}
        title="Update Received Dates"
        sheetApiPath="/api/invoices/import-received-dates"
        excelApiPath="/api/invoices/import-received-dates"
        templateColumns={['Invoice Number', 'Received Date (DD/MM/YYYY)']}
        resultVerb="updated"
        onClose={() => setShowReceivedDatesImport(false)}
        onImported={load}
      />

      <ImportModal
        open={showFieldsImport}
        title="Bulk Update Invoice Fields"
        sheetApiPath="/api/invoices/import-fields"
        excelApiPath="/api/invoices/import-fields"
        templateColumns={['Invoice Number', 'SAC/HSN', 'Client GSTIN', 'IRN', 'Project Category', 'Project Type', 'Registered Name']}
        resultVerb="updated"
        note="Columns are matched by header name — include only the ones you want to change. A blank cell in an included column clears that field."
        onClose={() => setShowFieldsImport(false)}
        onImported={load}
      />
    </div>
  )
}
