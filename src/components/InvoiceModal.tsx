'use client'

import { useEffect, useMemo, useState } from 'react'
import { FX_RATES, FY_OPTIONS, PROJECT_TYPE_MAP, projectCategoryLabel } from '@/lib/constants'
import { dateOnlyISO, formatApiError, getFY } from '@/lib/utils'
import { useToast } from '@/lib/ToastContext'

type RegisteredEntity = {
  id: string
  legalName: string
  gstin: string
  state: string
  isDefault: boolean
}

type Account = {
  id: string
  name: string
  type: 'company' | 'cluster' | 'division' | 'brand'
  parentId: string | null
  vendorRegistered?: boolean
  registeredEntities?: RegisteredEntity[]
}

// A won opportunity, offered as "Order Book / Particulars" to auto-fill category/offering/
// description/qty from the deal, and link the invoice to it for partial/invoiced tracking.
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
  offeringName: string | null
  sac: string | null
  desc: string | null
  currency: string
  fxRate: number
  gross: number
  disc: number
  gstRate: number
  dueDate: string | null
  expectedPaymentDate: string | null
  status: 'draft' | 'sent' | 'overdue' | 'partial' | 'gst_pending' | 'paid' | 'cancelled' | 'credit_note'
  comments: string | null
  irn?: string | null
  ackNo?: string | null
  ackDate?: string | null
  accountId: string | null
  opportunityId: string | null
}

// Values pulled from a parsed invoice PDF, used to pre-fill a brand-new invoice
// for the user to review. Every field is optional — whatever the parser couldn't
// read just falls back to the normal "New Invoice" defaults.
export type InvoicePrefill = {
  entity?: 'PMD' | 'Medflix'
  docType?: 'INV' | 'PI' | 'QUOTE' | 'CN'
  invNo?: string | null
  po?: string | null
  pi?: string | null
  date?: string | null
  dueDate?: string | null
  clientName?: string | null
  company?: string | null
  gstId?: string | null
  state?: string | null
  creditDays?: number | null
  sac?: string | null
  desc?: string | null
  qty?: number | null
  unitRevenue?: number | null
  currency?: string | null
  gross?: number | null
  gstRate?: number | null
  accountId?: string | null
  projectCategory?: string | null
  offeringName?: string | null
  opportunityId?: string | null
  comments?: string | null
  irn?: string | null
  ackNo?: string | null
  ackDate?: string | null
}

type Props = {
  open: boolean
  invoice: InvoiceRow | null
  accounts: Account[]
  wonOpportunities: WonOpportunity[]
  initialStep?: number
  /** Pre-fill values for a new invoice (e.g. read from an uploaded PDF). Ignored when editing. */
  prefill?: InvoicePrefill | null
  onClose: () => void
  onSaved: () => void
  onAccountsChanged?: () => void
}

function toISO(dateValue: string | null) {
  if (!dateValue) return null
  return new Date(`${dateValue}T00:00:00`).toISOString()
}

function addDays(dateInput: string, days: number) {
  const d = new Date(`${dateInput}T00:00:00`)
  d.setDate(d.getDate() + days)
  return dateOnlyISO(d)
}

// Get descendants of an account
function getDescendants(accountId: string, accounts: Account[]): Account[] {
  const children = accounts.filter(a => a.parentId === accountId)
  return children.flatMap(c => [c, ...getDescendants(c.id, accounts)])
}

function getAncestor(accountId: string, accountsById: Map<string, Account>, type: string): Account | null {
  let current = accountsById.get(accountId) || null
  while (current) {
    if (current.type === type) return current
    current = current.parentId ? accountsById.get(current.parentId) || null : null
  }
  return null
}

export default function InvoiceModal({ open, invoice, accounts, wonOpportunities, initialStep, prefill, onClose, onSaved, onAccountsChanged }: Props) {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { toast } = useToast()

  // Inline "add new registered entity" state
  const [showNewEntity, setShowNewEntity] = useState(false)
  const [newEntityLegalName, setNewEntityLegalName] = useState('')
  const [newEntityGstin, setNewEntityGstin] = useState('')
  const [newEntityState, setNewEntityState] = useState('')
  const [newEntityIsDefault, setNewEntityIsDefault] = useState(false)
  const [savingEntity, setSavingEntity] = useState(false)

  // Identity
  const [entity, setEntity] = useState<'PMD' | 'Medflix'>('PMD')
  const [docType, setDocType] = useState<'INV' | 'PI' | 'QUOTE' | 'CN'>('INV')
  const [invNo, setInvNo] = useState('')
  const [pi, setPi] = useState('')
  const [po, setPo] = useState('')
  const [date, setDate] = useState(dateOnlyISO(new Date()))
  const [projectCategory, setProjectCategory] = useState('')
  const [offeringName, setOfferingName] = useState('')
  const [customOffering, setCustomOffering] = useState('')
  const [sac, setSac] = useState('')
  const [desc, setDesc] = useState('')

  // Fetched project types from API, with fallback to constants (kept in sync with Order Book)
  const [projectTypeMap, setProjectTypeMap] = useState<Record<string, string[]>>(PROJECT_TYPE_MAP)

  useEffect(() => {
    fetch('/api/project-types')
      .then((r) => r.json())
      .then((data: { categories: Record<string, string[]> }) => {
        if (data.categories && Object.keys(data.categories).length > 0) {
          setProjectTypeMap(data.categories)
        }
      })
      .catch(() => {
        // fall back to hardcoded constants
      })
  }, [])

  const allOfferings = useMemo(() => Object.values(projectTypeMap).flat(), [projectTypeMap])

  // Client
  const [accountId, setAccountId] = useState('')
  const [entityId, setEntityId] = useState('')
  const [clusterId, setClusterId] = useState('')
  const [divisionId, setDivisionId] = useState('')
  // Selector to auto-fill fields from a won opportunity and link this invoice to it, so it
  // counts toward that opportunity's Partial/Invoiced totals in the Order Book.
  const [oppPickerId, setOppPickerId] = useState('')
  const [clientCode, setClientCode] = useState('')
  const [clientName, setClientName] = useState('')
  const [company, setCompany] = useState('')
  const [gstId, setGstId] = useState('')
  const [state, setState] = useState('')
  const [creditDays, setCreditDays] = useState(45)

  // Qty / unit pricing
  const [qty, setQty] = useState('')
  const [unitRevenue, setUnitRevenue] = useState('')

  // Financials
  const [currency, setCurrency] = useState('INR')
  const [fxRate, setFxRate] = useState(1)
  const [gross, setGross] = useState('')
  const [disc, setDisc] = useState('0')
  const [gstRate, setGstRate] = useState('18')

  // Status
  const [status, setStatus] = useState<'draft' | 'sent' | 'overdue' | 'partial' | 'gst_pending' | 'paid' | 'cancelled' | 'credit_note'>('sent')
  const [dueDate, setDueDate] = useState('')
  const [expectedPaymentDate, setExpectedPaymentDate] = useState('')
  const [comments, setComments] = useState('')
  // e-Invoice acknowledgement details (from the IRP / government portal)
  const [irn, setIrn] = useState('')
  const [ackNo, setAckNo] = useState('')
  const [ackDate, setAckDate] = useState('')
  const [estimatedTdsPct, setEstimatedTdsPct] = useState('0')
  const [customTdsPct, setCustomTdsPct] = useState('')

  const accountsById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  // Invoices can only be raised against vendor-registered companies — except we still show the
  // currently-selected company on an existing invoice even if it isn't (e.g. legacy data), so
  // editing doesn't silently swap out the billed-to company.
  const companies = useMemo(() => {
    const list = accounts.filter(a => a.type === 'company' && a.vendorRegistered)
    if (accountId && !list.some(a => a.id === accountId)) {
      const current = accountsById.get(accountId)
      if (current?.type === 'company') list.push(current)
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [accounts, accountId, accountsById])

  // Cluster is hidden from the form for now, but clusterId still loads/saves for
  // any legacy invoice already linked at cluster level (see load effect below).
  const divisions = useMemo(() => {
    if (!accountId) return []
    const baseId = clusterId || accountId
    return getDescendants(baseId, accounts).filter(a => a.type === 'division').sort((a, b) => a.name.localeCompare(b.name))
  }, [accountId, clusterId, accounts])

  const fy = useMemo(() => getFY(date), [date])

  const selectedOpportunity = useMemo(
    () => wonOpportunities.find((o) => o.id === oppPickerId) || null,
    [wonOpportunities, oppPickerId],
  )

  useEffect(() => {
    if (!open) return
    setStep(initialStep && initialStep >= 1 && initialStep <= 3 ? initialStep : 1)
    setError('')

    if (!invoice) {
      const today = dateOnlyISO(new Date())
      setEntity('PMD'); setDocType('INV'); setInvNo(''); setPi(''); setPo('')
      setDate(today)
      setAccountId(''); setEntityId(''); setClusterId(''); setDivisionId(''); setOppPickerId('')
      setClientCode(''); setClientName(''); setCompany(''); setGstId(''); setState('')
      setCreditDays(45)
      setProjectCategory(''); setOfferingName(''); setCustomOffering(''); setSac(''); setDesc('')
      setQty(''); setUnitRevenue('')
      setCurrency('INR'); setFxRate(1); setGross(''); setDisc('0'); setGstRate('18')
      setStatus('sent')
      setDueDate(addDays(today, 45))
      setExpectedPaymentDate(addDays(today, 45))
      setComments('')
      setIrn(''); setAckNo(''); setAckDate('')
      setEstimatedTdsPct('0'); setCustomTdsPct('')

      // Overlay parsed-PDF values on top of the blank defaults, if provided.
      if (prefill) {
        if (prefill.entity) setEntity(prefill.entity)
        if (prefill.docType) setDocType(prefill.docType)
        if (prefill.invNo) setInvNo(prefill.invNo)
        if (prefill.po) setPo(prefill.po)
        if (prefill.pi) setPi(prefill.pi)
        const pDate = prefill.date && !Number.isNaN(new Date(prefill.date).getTime()) ? prefill.date : today
        setDate(pDate)
        const pCreditDays = prefill.creditDays != null && prefill.creditDays > 0 ? prefill.creditDays : 45
        setCreditDays(pCreditDays)
        // Use the PDF's printed due date if we read one; otherwise derive from credit days.
        const pDue = prefill.dueDate && !Number.isNaN(new Date(prefill.dueDate).getTime())
          ? prefill.dueDate
          : addDays(pDate, pCreditDays)
        setDueDate(pDue)
        setExpectedPaymentDate(pDue)
        if (prefill.sac) setSac(prefill.sac)
        if (prefill.desc) setDesc(prefill.desc)
        if (prefill.clientName) setClientName(prefill.clientName)
        if (prefill.company) setCompany(prefill.company)
        if (prefill.gstId) setGstId(prefill.gstId)
        if (prefill.state) setState(prefill.state)
        if (prefill.accountId && accountsById.get(prefill.accountId)?.type === 'company') {
          setAccountId(prefill.accountId)
          const acc = accountsById.get(prefill.accountId)
          const matchByGstin = acc?.registeredEntities?.find(
            (e) => e.gstin.replace(/\s/g, '').toUpperCase() === (prefill.gstId || '').replace(/\s/g, '').toUpperCase(),
          )
          const ent = matchByGstin || acc?.registeredEntities?.find((e) => e.isDefault)
          if (ent) { setEntityId(ent.id); setCompany(ent.legalName); setGstId(ent.gstin); setState(ent.state) }
        }
        if (prefill.currency) setCurrency(prefill.currency)
        if (prefill.qty != null) setQty(String(prefill.qty))
        if (prefill.unitRevenue != null) setUnitRevenue(String(prefill.unitRevenue))
        if (prefill.gross != null) setGross(String(prefill.gross))
        if (prefill.gstRate != null) setGstRate(String(prefill.gstRate))
        if (prefill.projectCategory) setProjectCategory(prefill.projectCategory)
        if (prefill.offeringName) setOfferingName(prefill.offeringName)
        if (prefill.opportunityId) setOppPickerId(prefill.opportunityId)
        if (prefill.comments) setComments(prefill.comments)
        if (prefill.irn) setIrn(prefill.irn)
        if (prefill.ackNo) setAckNo(prefill.ackNo)
        if (prefill.ackDate) {
          const ad = new Date(prefill.ackDate)
          if (!Number.isNaN(ad.getTime())) setAckDate(dateOnlyISO(ad))
        }
      }
      return
    }

    const invDate = dateOnlyISO(new Date(invoice.date))
    const selCurrency = invoice.currency || 'INR'
    const selRate = invoice.fxRate || FX_RATES[selCurrency] || 1

    setEntity(invoice.entity === 'Metflix' ? 'Medflix' : invoice.entity as 'PMD' | 'Medflix')
    setDocType(invoice.docType)
    setInvNo(invoice.invNo || ''); setPi(invoice.pi || ''); setPo(invoice.po || '')
    setDate(invDate)
    const savedOffering = invoice.offeringName || ''
    const isKnown = allOfferings.includes(savedOffering)
    setOfferingName(isKnown ? savedOffering : (savedOffering ? '__custom__' : ''))
    setCustomOffering(isKnown ? '' : savedOffering)
    // Infer project category from offering
    const inferredCat = Object.entries(projectTypeMap).find(([, types]) => types.includes(savedOffering))?.[0] || ''
    setProjectCategory(inferredCat)
    setSac(invoice.sac || ''); setDesc(invoice.desc || '')

    if (invoice.accountId) {
      const acc = accountsById.get(invoice.accountId)
      if (acc?.type === 'company') { setAccountId(acc.id); setClusterId(''); setDivisionId('') }
      else if (acc?.type === 'cluster') {
        const parentCompany = getAncestor(acc.id, accountsById, 'company')
        setAccountId(parentCompany?.id || ''); setClusterId(acc.id); setDivisionId('')
      } else if (acc?.type === 'division') {
        const parentCompany = getAncestor(acc.id, accountsById, 'company')
        const parentCluster = getAncestor(acc.id, accountsById, 'cluster')
        setAccountId(parentCompany?.id || ''); setClusterId(parentCluster?.id || ''); setDivisionId(acc.id)
      } else {
        setAccountId(invoice.accountId); setClusterId(''); setDivisionId('')
      }
    } else {
      // Legacy invoices imported with only the free-text company/client name and no
      // account link show up as "Standalone" here. Try to resolve a matching company
      // account by name so the picker reflects what the list already shows (the change
      // only persists if the user saves).
      const wanted = (invoice.company || invoice.clientName || '').trim().toLowerCase()
      const matched = wanted
        ? accounts.find((a) => a.type === 'company' && a.name.trim().toLowerCase() === wanted)
        : undefined
      setAccountId(matched?.id || ''); setClusterId(''); setDivisionId('')
    }
    setOppPickerId(invoice.opportunityId || '')
    setClientCode(invoice.clientCode || ''); setClientName(invoice.clientName || '')
    setCompany(invoice.company || ''); setGstId(invoice.gstId || ''); setState(invoice.state || '')
    setEntityId('')
    setCreditDays(invoice.creditDays || 45)

    setQty(String((invoice as any).qty ?? ''))
    setUnitRevenue(String((invoice as any).unitRevenue ?? ''))
    setCurrency(selCurrency); setFxRate(selRate)
    setGross(String((invoice.gross || 0) / selRate))
    setDisc(String((invoice.disc || 0) / selRate))
    setGstRate(String(invoice.gstRate || 18))

    setStatus(invoice.status || 'sent')
    setDueDate(invoice.dueDate ? dateOnlyISO(new Date(invoice.dueDate)) : addDays(invDate, invoice.creditDays || 45))
    setExpectedPaymentDate(invoice.expectedPaymentDate ? dateOnlyISO(new Date(invoice.expectedPaymentDate)) : '')
    setComments(invoice.comments || '')
    setIrn(invoice.irn || '')
    setAckNo(invoice.ackNo || '')
    setAckDate(invoice.ackDate ? dateOnlyISO(new Date(invoice.ackDate)) : '')
    const tdsPct = (invoice as any).tdsPercent
    const knownTds = ['0', '2', '10']
    const tdsPctStr = String(tdsPct || 0)
    if (knownTds.includes(tdsPctStr)) {
      setEstimatedTdsPct(tdsPctStr); setCustomTdsPct('')
    } else if (tdsPct) {
      setEstimatedTdsPct('other'); setCustomTdsPct(tdsPctStr)
    } else {
      setEstimatedTdsPct('0'); setCustomTdsPct('')
    }
  }, [invoice, open, accounts, accountsById, initialStep, allOfferings, projectTypeMap, prefill])

  // Auto-update FX rate when currency changes
  useEffect(() => {
    const defaultRate = FX_RATES[currency]
    if (defaultRate) setFxRate(defaultRate)
  }, [currency])

  // Auto-fill clientName/company when account changes
  useEffect(() => {
    if (!accountId) return
    const acc = accountsById.get(accountId)
    if (acc && !clientName) setClientName(acc.name)
    if (acc && !company) {
      const defaultEntity = acc.registeredEntities?.find((e) => e.isDefault)
      if (defaultEntity) {
        setEntityId(defaultEntity.id)
        setCompany(defaultEntity.legalName)
        setGstId(defaultEntity.gstin)
        setState(defaultEntity.state)
      } else {
        setCompany(acc.name)
      }
    }
  }, [accountId, accountsById, clientName, company])

  function applyEntitySelection(acc: Account | undefined, id: string) {
    setEntityId(id)
    const entity = acc?.registeredEntities?.find((e) => e.id === id)
    if (entity) {
      setCompany(entity.legalName)
      setGstId(entity.gstin)
      setState(entity.state)
    } else if (acc) {
      setCompany(acc.name)
    }
  }

  function openNewEntity() {
    setShowNewEntity(true)
    setNewEntityLegalName('')
    setNewEntityGstin('')
    setNewEntityState('')
    setNewEntityIsDefault(false)
  }

  async function saveNewEntity() {
    if (!accountId) return
    if (!newEntityLegalName.trim() || !newEntityGstin.trim() || !newEntityState.trim()) {
      setError('Legal name, GSTIN, and state are all required')
      return
    }
    setSavingEntity(true)
    setError('')
    try {
      const res = await fetch(`/api/accounts/${accountId}/registered-entities`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          legalName: newEntityLegalName.trim(),
          gstin: newEntityGstin.trim(),
          state: newEntityState.trim(),
          isDefault: newEntityIsDefault,
        }),
      })
      if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(formatApiError(p, 'Failed to create registered entity')) }
      const created = await res.json()
      setEntityId(created.id)
      setCompany(created.legalName)
      setGstId(created.gstin)
      setState(created.state)
      setShowNewEntity(false)
      toast('Registered entity created!', 'success')
      onAccountsChanged?.()
    } catch (err: any) {
      setError(err.message || 'Failed to create registered entity')
      toast(err.message || 'Failed to create registered entity', 'error')
    } finally {
      setSavingEntity(false)
    }
  }

  const grossValue = Number(gross) || 0
  const discValue = Number(disc) || 0
  const gstRateValue = Number(gstRate) || 0
  const netValue = Math.max(0, grossValue - discValue)
  const gstValue = netValue * (gstRateValue / 100)
  const totalValue = netValue + gstValue
  const totalINR = totalValue * fxRate
  const netINR = netValue * fxRate
  const gstINR = gstValue * fxRate

  const estimatedTdsPctValue = estimatedTdsPct === 'other' ? (Number(customTdsPct) || 0) : (Number(estimatedTdsPct) || 0)
  // TDS is deducted on the taxable (net) value, but the client still remits the GST —
  // so what lands in the bank is the full invoice total minus TDS.
  const estTds = netINR * (estimatedTdsPctValue / 100)
  const estNetToBank = totalINR - estTds

  const effectiveAccountId = divisionId || clusterId || accountId || null
  const effectiveOffering = offeringName === '__custom__' ? customOffering : offeringName

  function canGoNext() {
    if (step === 1) return !!date
    if (step === 2) return Number(gross) > 0
    return true
  }

  function goNext() {
    if (!canGoNext()) {
      setError(step === 1 ? 'Invoice date is required' : 'Gross amount is required')
      return
    }
    setError('')
    setStep(s => Math.min(s + 1, 3))
  }

  function goPrev() {
    setError('')
    setStep(s => Math.max(s - 1, 1))
  }

  async function submit() {
    setError('')
    if (!date) { setError('Invoice date is required'); return }
    if (!gross || Number(gross) <= 0) { setError('Gross amount is required'); return }
    if (!dueDate) { setError('Due date is required'); return }

    const payload = {
      entity, docType,
      invNo: invNo.trim() || null, pi: pi.trim() || null, po: po.trim() || null,
      date: toISO(date), effDate: null,
      clientCode: clientCode.trim() || null, clientName: clientName.trim() || null,
      company: company.trim() || null, gstId: gstId.trim() || null,
      state: state.trim() || null, creditDays,
      projectCategory: projectCategory.trim() || null,
      offeringName: effectiveOffering.trim() || null, sac: sac.trim() || null,
      desc: desc.trim() || null,
      qty: qty !== '' ? Number(qty) : null,
      unitRevenue: unitRevenue !== '' ? Number(unitRevenue) : null,
      currency, fxRate,
      gross: Number(gross), disc: Number(disc || 0), gstRate: gstRateValue,
      dueDate: toISO(dueDate),
      expectedPaymentDate: expectedPaymentDate ? toISO(expectedPaymentDate) : null,
      status, comments: comments.trim() || null,
      irn: irn.trim() || null,
      ackNo: ackNo.trim() || null,
      ackDate: ackDate ? toISO(ackDate) : null,
      accountId: effectiveAccountId,
      opportunityId: oppPickerId || null,
      tdsPercent: estimatedTdsPctValue,
    }

    setSaving(true)
    try {
      const res = await fetch(invoice ? `/api/invoices/${invoice.id}` : '/api/invoices', {
        method: invoice ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const info = await res.json().catch(() => ({}))
        const msg = formatApiError(info, 'Failed to save invoice')
        setError(msg)
        toast(msg, 'error')
        return
      }
      toast(invoice ? 'Invoice updated!' : 'Invoice created!', 'success')
      await maybeRegisterGstin()
      onSaved(); onClose()
    } finally {
      setSaving(false)
    }
  }

  // If the invoice carries a GSTIN that isn't yet a registered entity on the selected
  // company account, add it so it shows up in the Registered Entity dropdown next time.
  async function maybeRegisterGstin() {
    const gstin = gstId.trim()
    const acc = accountId ? accountsById.get(accountId) : undefined
    if (!acc || !/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/i.test(gstin)) return
    const existing = acc.registeredEntities || []
    if (existing.some((e) => e.gstin.trim().toUpperCase() === gstin.toUpperCase())) return
    try {
      const res = await fetch(`/api/accounts/${accountId}/registered-entities`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          legalName: company.trim() || clientName.trim() || acc.name,
          gstin,
          state: state.trim() || '—',
          isDefault: existing.length === 0,
        }),
      })
      if (res.ok) {
        toast(`Added GSTIN to ${acc.name}`, 'success')
        onAccountsChanged?.()
      }
    } catch {
      // Non-fatal — the invoice itself saved fine.
    }
  }

  if (!open) return null

  const STEPS = ['Details', 'Billing', 'Status']

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 860 }}>
        {/* Header */}
        <div className="page-header" style={{ alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{invoice ? 'Edit Invoice' : 'New Invoice'}</h3>
          <button className="button-muted" onClick={onClose}>Close</button>
        </div>

        {/* Step Progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 20 }}>
          {STEPS.map((label, i) => {
            const s = i + 1
            const active = step === s
            const done = step > s
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
                <button
                  onClick={() => { if (done || (invoice && s <= step + 1)) { setError(''); setStep(s) } }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px', borderRadius: 999, border: 'none',
                    background: active ? 'var(--primary)' : done ? 'var(--primary-soft)' : 'var(--surface-2)',
                    color: active ? '#fff' : done ? 'var(--primary)' : 'var(--text-muted)',
                    fontWeight: 700, fontSize: 12, cursor: done || invoice ? 'pointer' : 'default',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? 'rgba(255,255,255,0.25)' : done ? 'var(--primary)' : 'var(--border)',
                    color: active ? '#fff' : done ? '#fff' : 'var(--text-muted)',
                    fontSize: 11, fontWeight: 800, flexShrink: 0,
                  }}>
                    {done ? '✓' : s}
                  </span>
                  {label}
                </button>
                {i < STEPS.length - 1 && (
                  <div style={{ flex: 1, height: 2, background: done ? 'var(--primary)' : 'var(--border)', margin: '0 4px' }} />
                )}
              </div>
            )
          })}
        </div>

        {/* STEP 1: Details */}
        {step === 1 ? (
          <div className="form-grid" style={{ marginTop: 4 }}>
            <label>
              Document Type
              <select value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)}>
                <option value="INV">Tax Invoice</option>
                <option value="PI">Proforma Invoice</option>
                <option value="QUOTE">Quotation</option>
                <option value="CN">Credit Note</option>
              </select>
            </label>
            <label>
              Entity
              <select value={entity} onChange={(e) => setEntity(e.target.value as 'PMD' | 'Medflix')}>
                <option value="PMD">PMD</option>
                <option value="Medflix">Medflix</option>
              </select>
            </label>
            <label>
              Invoice Date <span style={{ color: 'var(--error)', fontSize: 12 }}>*</span>
              <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setDueDate(addDays(e.target.value, creditDays || 45)) }} />
            </label>
            <label>
              Financial Year (auto)
              <input value={fy} readOnly style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }} />
            </label>
            <label>
              Invoice Number
              <input value={invNo} onChange={(e) => setInvNo(e.target.value)} placeholder="PMD/INV/25-26/001" />
            </label>
            <label>
              Linked PI Number
              <input value={pi} onChange={(e) => setPi(e.target.value)} placeholder="Optional" />
            </label>
            <label>
              Client PO Number
              <input value={po} onChange={(e) => setPo(e.target.value)} placeholder="Optional" />
            </label>
            <label>
              Project Category
              <select value={projectCategory} onChange={(e) => { setProjectCategory(e.target.value); setOfferingName('') }}>
                <option value="">Select category...</option>
                {Object.keys(projectTypeMap).map((cat) => (
                  <option key={cat} value={cat}>{projectCategoryLabel(cat)}</option>
                ))}
              </select>
            </label>
            <label>
              Project Type
              <select value={offeringName} onChange={(e) => setOfferingName(e.target.value)} disabled={!projectCategory}>
                <option value="">Select type...</option>
                {(projectTypeMap[projectCategory] || []).map((o) => <option key={o} value={o}>{o}</option>)}
                <option value="__custom__">Other (type below)</option>
              </select>
            </label>
            {offeringName === '__custom__' ? (
              <label>
                Custom Type Name
                <input value={customOffering} onChange={(e) => setCustomOffering(e.target.value)} placeholder="Enter type name" />
              </label>
            ) : null}
            <label>
              SAC / HSN Code
              <input value={sac} onChange={(e) => setSac(e.target.value)} placeholder="998313" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Description
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Detailed description of services rendered" />
            </label>

            <div style={{ gridColumn: '1 / -1', height: 1, background: 'var(--border)', margin: '8px 0' }} />
            <div style={{ gridColumn: '1 / -1', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>
              Client
            </div>
            <label>
              Company
              <select value={accountId} onChange={(e) => {
                const id = e.target.value
                setAccountId(id); setClusterId(''); setDivisionId('')
                const acc = accountsById.get(id)
                if (acc) {
                  setClientName(acc.name)
                  const defaultEntity = acc.registeredEntities?.find((ent) => ent.isDefault)
                  applyEntitySelection(acc, defaultEntity?.id || '')
                } else {
                  setEntityId('')
                }
              }}>
                <option value="">Standalone (no account)</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {accountId ? (
              <label>
                Registered Entity
                {!showNewEntity ? (
                  <select
                    value={entityId}
                    onChange={(e) => {
                      if (e.target.value === '__new__') { openNewEntity(); return }
                      applyEntitySelection(accountsById.get(accountId), e.target.value)
                    }}
                  >
                    <option value="">— Select —</option>
                    {(accountsById.get(accountId)?.registeredEntities || []).map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.gstin ? `${ent.gstin} — ` : ''}{ent.legalName}{ent.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                    <option value="__new__">+ Add New Entity</option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input value="New registered entity (see below)" readOnly style={{ flex: 1, background: 'var(--surface-2)', color: 'var(--text-muted)' }} />
                    <button type="button" className="button-muted" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => setShowNewEntity(false)}>
                      Cancel
                    </button>
                  </div>
                )}
              </label>
            ) : null}

            {showNewEntity ? (
              <div style={{ gridColumn: '1 / -1', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: 'var(--text-muted)' }}>New Registered Entity</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 10 }}>
                  <label>
                    Legal Name *
                    <input value={newEntityLegalName} onChange={(e) => setNewEntityLegalName(e.target.value)} placeholder="e.g. Pfizer Healthcare Pvt Ltd" autoFocus />
                  </label>
                  <label>
                    GSTIN *
                    <input value={newEntityGstin} onChange={(e) => setNewEntityGstin(e.target.value)} placeholder="e.g. 24AAHCP8352J1Z4" />
                  </label>
                  <label>
                    State *
                    <input value={newEntityState} onChange={(e) => setNewEntityState(e.target.value)} placeholder="e.g. Gujarat" />
                  </label>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row', marginTop: 8 }}>
                  <input type="checkbox" checked={newEntityIsDefault} onChange={(e) => setNewEntityIsDefault(e.target.checked)} />
                  Use as default for new invoices
                </label>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="button-muted" onClick={() => setShowNewEntity(false)}>
                    Cancel
                  </button>
                  <button type="button" className="button-primary" onClick={saveNewEntity} disabled={savingEntity}>
                    {savingEntity ? 'Saving...' : 'Save Entity'}
                  </button>
                </div>
              </div>
            ) : null}
            <label>
              Division (optional)
              <select value={divisionId} onChange={(e) => setDivisionId(e.target.value)} disabled={!accountId || divisions.length === 0}>
                <option value="">None</option>
                {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label>
              Order Book / Particulars
              <select value={oppPickerId} onChange={(e) => {
                const pid = e.target.value; setOppPickerId(pid)
                const sel = wonOpportunities.find((o) => o.id === pid)
                if (sel?.account && !accountId) { setAccountId(sel.account.id); setClientName(sel.account.name); setCompany(sel.account.name) }
                if (sel) {
                  setProjectCategory(sel.projectCategory || '')
                  setOfferingName(sel.projectType || '')
                  if (sel.description) setDesc(sel.description)
                  if (sel.totalQty != null) setQty(String(sel.totalQty))
                  if (sel.unitRevenue != null) setUnitRevenue(String(sel.unitRevenue))
                  // Default Gross to what's still un-invoiced on this deal, not the full
                  // commissioned value — partial invoicing against an opportunity is common,
                  // and defaulting to the full amount nudged people away from that.
                  const remaining = Math.max(0, sel.estimatedValue - sel.invoicedAmount)
                  setGross(String(remaining))
                }
              }}>
                <option value="">Not linked</option>
                {(accountId
                  ? wonOpportunities.filter(o => o.accountId === accountId || getDescendants(accountId, accounts).some(d => d.id === o.accountId) || getAncestor(o.accountId, accountsById, 'company')?.id === accountId)
                  : wonOpportunities
                ).map((o) => {
                  const remaining = Math.max(0, o.estimatedValue - o.invoicedAmount)
                  const label = [
                    o.account?.name,
                    o.projectType,
                    o.description ? `— ${o.description.slice(0, 40)}` : '',
                    `(₹${remaining.toLocaleString('en-IN')} remaining)`,
                  ].filter(Boolean).join(' ')
                  return <option key={o.id} value={o.id}>{label}</option>
                })}
              </select>
              {oppPickerId && selectedOpportunity ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  ₹{Math.max(0, selectedOpportunity.estimatedValue - selectedOpportunity.invoicedAmount).toLocaleString('en-IN')} still to invoice
                  {' '}(of ₹{selectedOpportunity.estimatedValue.toLocaleString('en-IN')} total) — Gross defaulted to that; adjust it below for a partial amount.
                </div>
              ) : null}
            </label>
          </div>
        ) : null}

        {/* STEP 2: Billing */}
        {step === 2 ? (
          <div className="form-grid" style={{ marginTop: 4 }}>
            <div style={{ gridColumn: '1 / -1', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>
              Client Details
            </div>
            <label>
              Display Name
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Name on invoice header" />
            </label>
            <label>
              Registered Firm Name
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Legal entity name" />
            </label>
            <label>
              Client Code
              <input value={clientCode} onChange={(e) => setClientCode(e.target.value)} placeholder="Internal code" />
            </label>
            <label>
              GSTIN
              <input value={gstId} onChange={(e) => setGstId(e.target.value)} placeholder="27XXXXX0000X1ZX" />
            </label>
            <label>
              State of Supply
              <input value={state} onChange={(e) => setState(e.target.value)} placeholder="Maharashtra" />
            </label>
            <label>
              Credit Days
              <input type="number" min="1" max="365" value={creditDays} onChange={(e) => { const d = Number(e.target.value) || 45; setCreditDays(d); setDueDate(addDays(date, d)) }} />
            </label>

            <div style={{ gridColumn: '1 / -1', height: 1, background: 'var(--border)', margin: '8px 0' }} />
            <div style={{ gridColumn: '1 / -1', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>
              Financials
            </div>
            <label>
              Quantity (units)
              <input
                type="number" min="0" step="1" value={qty}
                onChange={(e) => {
                  setQty(e.target.value)
                  const q = Number(e.target.value)
                  const u = Number(unitRevenue)
                  if (q > 0 && u > 0) setGross(String(q * u))
                }}
                placeholder="e.g. 3"
              />
            </label>
            <label>
              Unit Revenue ({currency})
              <input
                type="number" min="0" step="0.01" value={unitRevenue}
                onChange={(e) => {
                  setUnitRevenue(e.target.value)
                  const q = Number(qty)
                  const u = Number(e.target.value)
                  if (q > 0 && u > 0) setGross(String(q * u))
                }}
                placeholder="e.g. 100000"
              />
            </label>
            {qty !== '' && unitRevenue !== '' && Number(qty) > 0 && Number(unitRevenue) > 0 ? (
              <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 4 }}>
                {Number(qty)} × ₹{Number(unitRevenue).toLocaleString('en-IN')} = ₹{(Number(qty) * Number(unitRevenue)).toLocaleString('en-IN')} auto-filled as gross
              </div>
            ) : null}
            <label>
              Currency
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {Object.keys(FX_RATES).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              FX Rate (editable)
              <input type="number" min="0.01" step="0.01" value={fxRate} onChange={(e) => setFxRate(Number(e.target.value) || 1)} style={{ fontWeight: 700 }} />
            </label>
            <label>
              Gross ({currency}) <span style={{ color: 'var(--error)', fontSize: 12 }}>*</span>
              <input type="number" min="0" value={gross} onChange={(e) => setGross(e.target.value)} />
            </label>
            <label>
              Discount ({currency})
              <input type="number" min="0" value={disc} onChange={(e) => setDisc(e.target.value)} />
            </label>
            <label>
              GST Rate
              <select value={gstRate} onChange={(e) => setGstRate(e.target.value)}>
                <option value="0">0%</option>
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </select>
            </label>
            <label>
              Estimated TDS %
              <select value={estimatedTdsPct} onChange={(e) => setEstimatedTdsPct(e.target.value)}>
                <option value="0">0%</option>
                <option value="2">2%</option>
                <option value="10">10%</option>
                <option value="other">Other</option>
              </select>
            </label>
            {estimatedTdsPct === 'other' ? (
              <label>
                Custom TDS %
                <input type="number" min="0" max="100" step="0.1" value={customTdsPct} onChange={(e) => setCustomTdsPct(e.target.value)} placeholder="e.g. 7.5" />
              </label>
            ) : null}
            <label>
              Due Date
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>

            {/* Financial Summary */}
            <div style={{ gridColumn: '1 / -1', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10 }}>
                Summary (INR)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[
                  { label: 'Net', value: `₹${netINR.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` },
                  { label: `GST ${gstRate}%`, value: `₹${gstINR.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` },
                  { label: 'Total', value: `₹${totalINR.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, highlight: true },
                  ...(currency !== 'INR' ? [{ label: `Total (${currency})`, value: totalValue.toLocaleString('en-IN', { maximumFractionDigits: 2 }) }] : []),
                  ...(estimatedTdsPctValue > 0 ? [
                    { label: `Est. TDS ${estimatedTdsPctValue}%`, value: `₹${estTds.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, muted: true },
                    { label: 'Est. Net to Bank', value: `₹${estNetToBank.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, accent: true },
                  ] : []),
                ].map((item: any) => (
                  <div key={item.label}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: item.highlight ? 'var(--primary)' : item.muted ? 'var(--text-muted)' : item.accent ? '#047857' : 'var(--text)' }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* STEP 3: Status */}
        {step === 3 ? (
          <div style={{ marginTop: 4 }}>
            <div className="form-grid" style={{ marginTop: 4 }}>
              <label>
                Status
                <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                  <option value="draft">Draft</option>
                  <option value="sent">Receivables</option>
                  <option value="overdue">Overdue</option>
                  <option value="partial">Partial</option>
                  <option value="gst_pending">GST Pending</option>
                  <option value="paid">Received</option>
                </select>
              </label>
              <label>
                Due Date
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              <label>
                Expected Payment Date
                <input type="date" value={expectedPaymentDate} onChange={(e) => setExpectedPaymentDate(e.target.value)} />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Comments / Notes
                <textarea value={comments} onChange={(e) => setComments(e.target.value)} />
              </label>

              <div style={{ gridColumn: '1 / -1', height: 1, background: 'var(--border)', margin: '8px 0' }} />
              <div style={{ gridColumn: '1 / -1', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>
                e-Invoice details <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional — auto-filled when read from a government e-invoice PDF)</span>
              </div>
              <label style={{ gridColumn: '1 / -1' }}>
                IRN
                <input value={irn} onChange={(e) => setIrn(e.target.value)} placeholder="64-character Invoice Reference Number" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
              </label>
              <label>
                Ack No.
                <input value={ackNo} onChange={(e) => setAckNo(e.target.value)} placeholder="Acknowledgement number" />
              </label>
              <label>
                Ack Date
                <input type="date" value={ackDate} onChange={(e) => setAckDate(e.target.value)} />
              </label>
            </div>
          </div>
        ) : null}

        {error ? <div className="error" style={{ marginTop: 10 }}>{error}</div> : null}

        {/* Navigation */}
        <div className="stack" style={{ justifyContent: 'space-between', marginTop: 16 }}>
          <div>
            {step > 1 ? (
              <button className="button-muted" onClick={goPrev}>← Back</button>
            ) : (
              <button className="button-muted" onClick={onClose}>Cancel</button>
            )}
          </div>
          <div className="stack">
            {step < 3 ? (
              <button className="button-primary" onClick={goNext}>
                Next →
              </button>
            ) : (
              <button className="button-primary" onClick={submit} disabled={saving}>
                {saving ? 'Saving...' : invoice ? 'Update Invoice' : 'Create Invoice'}
              </button>

            )}
          </div>
        </div>
      </div>
    </div>
  )
}
