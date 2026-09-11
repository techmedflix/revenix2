'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import CreateOpportunityModal from '@/components/CreateOpportunityModal'
import EditOpportunityModal from '@/components/EditOpportunityModal'
import LogActivityModal from '@/components/LogActivityModal'
import ActivityDrawer from '@/components/ActivityDrawer'
import WonModal from '@/components/WonModal'
import LostModal from '@/components/LostModal'
import UpdateStageModal from '@/components/UpdateStageModal'
import ProposalDetailsModal from '@/components/ProposalDetailsModal'
import ImportModal from '@/components/ImportModal'
import MultiSelectFilter from '@/components/MultiSelectFilter'
import { fmtDate, fmtINRCompact, formatApiError, getFY } from '@/lib/utils'
import { apiFetch } from '@/lib/api-fetch'
import { projectCategoryLabel } from '@/lib/constants'
import { useGlobalFilters } from '@/lib/GlobalFiltersContext'
import { useTheme } from '@/lib/ThemeContext'
import {
  CLIENT_TYPE_LABEL, type ClientType,
  LEAD_TYPES, LEAD_TYPE_LABEL, type LeadType,
  LEAD_STAGES, LEAD_STAGE_LABEL, type LeadStage,
  effectiveProbability,
  remainingContractValue, remainingContractContribution, remainingContractCost,
  weightedPipelineValue, weightedPipelineContribution,
} from '@/lib/opportunityStages'

type AccountType = 'company' | 'cluster' | 'division' | 'brand'

type Account = {
  id: string
  name: string
  type: AccountType
  parentId: string | null
}

type LinkedInvoice = { id: string; invNo: string | null; net: number; amt: number; status: string }
type Poc = { id: string; name: string; designation: string | null; phone: string | null; email: string | null }

type Opportunity = {
  id: string
  oppNo: string | null
  accountId: string
  account: Account | null
  owner: { id: string; name: string | null; email: string }
  projectCategory: string
  projectType: string
  estimatedValue: number
  estimatedCost: number
  contributionValue: number
  contributionPercent: number
  invoicedAmount: number
  invoices: LinkedInvoice[]
  clientType: ClientType | null
  leadType: LeadType | null
  leadStage: LeadStage | null
  probability: number | null
  expectedKickoff: string | null
  nextCallDate: string | null
  clientPocId: string | null
  clientPoc: Poc | null
  description: string | null
  medical: boolean
  negotiationReason: string | null
  totalQty: number | null
  unitRevenue: number | null
  unitCost: number | null
  ownerId: string
  createdAt?: string
  _count?: { activities: number }
  activities?: Array<{ activityType: string; createdAt: string }>
}

// ── Client Type style ──────────────────────────────────────────────────────
const CLIENT_TYPE_STYLE: Record<ClientType, { bg: string; color: string }> = {
  new:      { bg: 'rgba(168,85,247,0.12)', color: '#d8b4fe' },
  existing: { bg: 'rgba(56,189,248,0.12)', color: '#7dd3fc' },
}
const CLIENT_TYPE_STYLE_LIGHT: Record<ClientType, { bg: string; color: string }> = {
  new:      { bg: 'rgba(168,85,247,0.12)', color: '#7e22ce' },
  existing: { bg: 'rgba(56,189,248,0.12)', color: '#0369a1' },
}

// ── Lead Type style ────────────────────────────────────────────────────────
const LEAD_TYPE_STYLE: Record<LeadType, { bg: string; color: string }> = {
  won:  { bg: 'rgba(34,197,94,0.15)',   color: '#86efac' },
  hot:  { bg: 'rgba(249,115,22,0.2)',   color: '#fdba74' },
  warm: { bg: 'rgba(45,212,191,0.15)',  color: '#5eead4' },
  cold: { bg: 'rgba(56,189,248,0.15)',  color: '#7dd3fc' },
  lost: { bg: 'rgba(255,95,95,0.15)',   color: '#ff8080' },
}
const LEAD_TYPE_STYLE_LIGHT: Record<LeadType, { bg: string; color: string }> = {
  won:  { bg: 'rgba(34,197,94,0.15)',   color: '#15803d' },
  hot:  { bg: 'rgba(249,115,22,0.18)',  color: '#c2410c' },
  warm: { bg: 'rgba(45,212,191,0.15)',  color: '#0f766e' },
  cold: { bg: 'rgba(56,189,248,0.15)',  color: '#0369a1' },
  lost: { bg: 'rgba(255,95,95,0.15)',   color: '#dc2626' },
}

// ── Lead Stage style ───────────────────────────────────────────────────────
const LEAD_STAGE_STYLE: Record<LeadStage, { bg: string; color: string }> = {
  proposal:         { bg: 'rgba(245,158,11,0.15)',  color: '#fcd34d' },
  pilot:            { bg: 'rgba(129,140,248,0.16)', color: '#a5b4fc' },
  commissioned:     { bg: 'rgba(34,217,138,0.15)',  color: '#5eeaac' },
  partial_invoiced: { bg: 'rgba(56,189,248,0.15)',  color: '#7dd3fc' },
  invoiced:         { bg: 'rgba(16,185,129,0.18)',  color: '#6ee7b7' },
}
const LEAD_STAGE_STYLE_LIGHT: Record<LeadStage, { bg: string; color: string }> = {
  proposal:         { bg: 'rgba(245,158,11,0.15)',  color: '#b45309' },
  pilot:            { bg: 'rgba(129,140,248,0.16)', color: '#4f46e5' },
  commissioned:     { bg: 'rgba(34,217,138,0.15)',  color: '#15803d' },
  partial_invoiced: { bg: 'rgba(56,189,248,0.15)',  color: '#0369a1' },
  invoiced:         { bg: 'rgba(16,185,129,0.18)',  color: '#047857' },
}

// FY is derived from Expected Kick-off Date (falling back to createdAt) — there's no stored FY field.
function oppFY(row: { expectedKickoff: string | null; createdAt?: string }): string {
  return getFY(row.expectedKickoff || row.createdAt || new Date())
}

function getAncestor(accountId: string, accountsById: Map<string, Account>, targetType: AccountType) {
  let current = accountsById.get(accountId) || null
  while (current) {
    if (current.type === targetType) return current
    current = current.parentId ? accountsById.get(current.parentId) || null : null
  }
  return null
}

// ── Filter persistence (survive tab/page navigation within the same session) ─
const FILTER_STORAGE_KEY = 'orderBookFilters'

type StoredFilters = {
  companyFilters: string[]
  pillFilters: string[]
  myOnly: boolean
  projectTypeFilters: string[]
  projectCategoryFilters: string[]
  ownerFilters: string[]
}

function loadStoredFilters(): Partial<StoredFilters> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(FILTER_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function nextCallClass(d: string | null) {
  if (!d) return 'badge-blue'
  const target = new Date(d)
  const today = new Date()
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const targetOnly = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  if (targetOnly < todayOnly) return 'badge-red'
  if (targetOnly.getTime() === todayOnly.getTime()) return 'badge-amber'
  return 'badge-green'
}

// ── Top-row pills ──────────────────────────────────────────────────────────
// One flat set of pill filters. A row shows if it matches ANY selected pill
// (OR, not AND) — so "Commissioned + Hot" widens the list instead of colliding
// to an empty set the way the old activeOnly/leadType/leadStage AND-stack did.
type PillKey = 'active' | 'commissioned' | 'invoiced' | 'partial' | 'hot' | 'warm' | 'cold' | 'lost'
const PILL_KEYS: PillKey[] = ['active', 'commissioned', 'invoiced', 'partial', 'hot', 'warm', 'cold', 'lost']

function pillMatches(key: PillKey, row: { leadType: LeadType | null; leadStage: LeadStage | null }): boolean {
  switch (key) {
    case 'active':       return row.leadType === 'hot' || row.leadType === 'warm' || row.leadType === 'cold'
    // Commissioned bucket = commissioned + partially-invoiced, driven off the stage
    // so deals with a blank Lead Type still show up here.
    case 'commissioned': return row.leadStage === 'commissioned' || row.leadStage === 'partial_invoiced'
    case 'invoiced':      return row.leadStage === 'invoiced'
    case 'partial':       return row.leadStage === 'partial_invoiced'
    default:              return row.leadType === key // won / hot / warm / cold / lost
  }
}

// Remaining (uncollected) value + probability-weighted pipeline figures for one row.
// Fully invoiced deals are realized, not pipeline → 0. Partially invoiced deals
// count only the still-uninvoiced share, with Contribution scaled to match.
// Delegates to the shared maths in opportunityStages so the Dashboard's
// Won/Active KPIs land on the exact same numbers.
function rowPipeline(row: Opportunity) {
  return {
    actualValue: remainingContractValue(row),
    actualContribution: remainingContractContribution(row),
    weightedValue: weightedPipelineValue(row),
    weightedContribution: weightedPipelineContribution(row),
  }
}

// Pick actual vs probability-weighted figures for a row. `lost` deals always report
// actual — a 0%-weighted lost figure tells you nothing about what was lost.
function rowFigures(row: Opportunity, mode: 'weighted' | 'actual') {
  const p = rowPipeline(row)
  const actual = mode === 'actual' || row.leadType === 'lost'
  return {
    value: actual ? p.actualValue : p.weightedValue,
    contribution: actual ? p.actualContribution : p.weightedContribution,
  }
}

export default function OrderBookClient() {
  const { data: session } = useSession()
  const { fy: globalFy } = useGlobalFilters()
  const { theme } = useTheme()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [accounts, setAccounts] = useState<Account[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])

  const [companyFilters, setCompanyFilters] = useState<Set<string>>(
    () => new Set(loadStoredFilters().companyFilters),
  )
  const [pillFilters, setPillFilters] = useState<Set<PillKey>>(
    () => new Set(loadStoredFilters().pillFilters as PillKey[] | undefined),
  )
  const [myOnly, setMyOnly] = useState(() => loadStoredFilters().myOnly ?? false)
  const [projectTypeFilters, setProjectTypeFilters] = useState<Set<string>>(
    () => new Set(loadStoredFilters().projectTypeFilters),
  )
  const [projectCategoryFilters, setProjectCategoryFilters] = useState<Set<string>>(
    () => new Set(loadStoredFilters().projectCategoryFilters),
  )
  const [ownerFilters, setOwnerFilters] = useState<Set<string>>(
    () => new Set(loadStoredFilters().ownerFilters),
  )
  const [sortBy, setSortBy] = useState<'created' | 'value'>(() => {
    if (typeof window === 'undefined') return 'created'
    const saved = window.localStorage.getItem('orderBookSortBy')
    return saved === 'created' || saved === 'value' ? saved : 'created'
  })

  useEffect(() => {
    window.localStorage.setItem('orderBookSortBy', sortBy)
  }, [sortBy])

  // 'weighted' = pipeline figures scaled by win probability; 'actual' = full remaining value.
  const [pipelineMode, setPipelineMode] = useState<'weighted' | 'actual'>(() => {
    if (typeof window === 'undefined') return 'weighted'
    return window.localStorage.getItem('orderBookPipelineMode') === 'actual' ? 'actual' : 'weighted'
  })
  useEffect(() => {
    window.localStorage.setItem('orderBookPipelineMode', pipelineMode)
  }, [pipelineMode])

  // Persist filters to sessionStorage so they survive navigating away and back
  useEffect(() => {
    const payload: StoredFilters = {
      companyFilters: Array.from(companyFilters),
      pillFilters: Array.from(pillFilters),
      myOnly,
      projectTypeFilters: Array.from(projectTypeFilters),
      projectCategoryFilters: Array.from(projectCategoryFilters),
      ownerFilters: Array.from(ownerFilters),
    }
    window.sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(payload))
  }, [
    companyFilters, pillFilters,
    myOnly, projectTypeFilters, projectCategoryFilters, ownerFilters,
  ])

  const [showImportModal, setShowImportModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [logOpportunityId, setLogOpportunityId] = useState<string | null>(null)
  const [showWonModal, setShowWonModal] = useState(false)
  const [wonOpportunity, setWonOpportunity] = useState<Opportunity | null>(null)
  const [showLostModal, setShowLostModal] = useState(false)
  const [lostOpportunity, setLostOpportunity] = useState<Opportunity | null>(null)
  const [showStageModal, setShowStageModal] = useState(false)
  const [stageOpportunity, setStageOpportunity] = useState<Opportunity | null>(null)
  const [stageTargetInitial, setStageTargetInitial] = useState<'commissioned' | 'partial_invoiced' | 'invoiced'>('commissioned')
  const [activityOpportunityId, setActivityOpportunityId] = useState<string | null>(null)
  const [editOpportunity, setEditOpportunity] = useState<Opportunity | null>(null)
  const [updatingId, setUpdatingId] = useState('')
  const [updatingLeadTypeId, setUpdatingLeadTypeId] = useState('')
  const [editingProbId, setEditingProbId] = useState<string | null>(null)
  const [showProposalModal, setShowProposalModal] = useState(false)
  const [proposalOpportunity, setProposalOpportunity] = useState<Opportunity | null>(null)
  const [proposalTargetLeadType, setProposalTargetLeadType] = useState<LeadType>('hot')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [expandedOppIds, setExpandedOppIds] = useState<Set<string>>(new Set())

  function toggleOppExpand(id: string) {
    setExpandedOppIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Any approved user can edit/delete any row
  const canEdit = (_row: Opportunity) => true

  const accountById = useMemo(() => new Map(accounts.map((r) => [r.id, r])), [accounts])

  // Companies that actually have opportunities in the order book (not every account in the system)
  const companies = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of opportunities) {
      const company = getAncestor(row.accountId, accountById, 'company')
      if (company) map.set(company.id, company.name)
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [accountById, opportunities])

  // Unique project types from loaded opportunities
  const projectTypes = useMemo(() => {
    const set = new Set<string>()
    for (const row of opportunities) {
      if (row.projectType) set.add(row.projectType)
    }
    return Array.from(set).sort()
  }, [opportunities])

  // Unique project categories from loaded opportunities
  const projectCategories = useMemo(() => {
    const set = new Set<string>()
    for (const row of opportunities) {
      if (row.projectCategory) set.add(row.projectCategory)
    }
    return Array.from(set).sort()
  }, [opportunities])

  // Unique owners from loaded opportunities
  const owners = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of opportunities) {
      if (row.owner?.id) {
        map.set(row.owner.id, row.owner.name || row.owner.email)
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [opportunities])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [accRes, oppRes] = await Promise.all([apiFetch('/api/accounts'), apiFetch('/api/opportunities')])
      if (!accRes.ok || !oppRes.ok) throw new Error('Failed to load order book data')
      const accPayload = (await accRes.json()) as { accounts: Account[] }
      const oppPayload = (await oppRes.json()) as Opportunity[]
      setAccounts(accPayload.accounts || [])
      setOpportunities(oppPayload)
      setSelectedIds(new Set())
    } catch (err: any) {
      setError(err.message || 'Failed to load order book')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Rows passing every filter EXCEPT the top-row pills. Both the pill summary and
  // the table derive from this, so a pill's headline count can never disagree with
  // the number of rows you get when you click it.
  const baseFiltered = useMemo(() => {
    return opportunities.filter((row) => {
      if (myOnly && row.owner.id !== session?.user?.id) return false
      const company = getAncestor(row.accountId, accountById, 'company')
      if (companyFilters.size > 0 && (!company || !companyFilters.has(company.id))) return false
      if (globalFy && oppFY(row) !== globalFy) return false
      if (projectTypeFilters.size > 0 && !projectTypeFilters.has(row.projectType)) return false
      if (projectCategoryFilters.size > 0 && !projectCategoryFilters.has(row.projectCategory)) return false
      if (ownerFilters.size > 0 && !ownerFilters.has(row.owner.id)) return false
      return true
    })
  }, [opportunities, myOnly, session?.user?.id, accountById, companyFilters, globalFy, projectTypeFilters, projectCategoryFilters, ownerFilters])

  // Per-pill { count, value, contribution }. value/contribution follow the pipeline
  // mode toggle (weighted vs actual) — EXCEPT the Invoiced pill (money actually billed)
  // and the Lost pill (always actual, so you see what was really lost).
  const pillSummary = useMemo(() => {
    const acc = Object.fromEntries(
      PILL_KEYS.map((k) => [k, { count: 0, value: 0, contribution: 0 }]),
    ) as Record<PillKey, { count: number; value: number; contribution: number }>
    for (const row of baseFiltered) {
      const fig = rowFigures(row, pipelineMode)
      for (const k of PILL_KEYS) {
        if (!pillMatches(k, row)) continue
        acc[k].count += 1
        acc[k].value += k === 'invoiced' ? row.invoicedAmount : fig.value
        acc[k].contribution += fig.contribution
      }
    }
    return acc
  }, [baseFiltered, pipelineMode])

  const filtered = useMemo(() => {
    const pk = Array.from(pillFilters)
    const rows = baseFiltered.filter(
      (row) => pk.length === 0 || pk.some((k) => pillMatches(k, row)),
    )

    rows.sort((a, b) => {
      if (sortBy === 'created') {
        const aTs = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bTs = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return bTs - aTs
      }
      if (sortBy === 'value') {
        return b.estimatedValue - a.estimatedValue
      }
      return 0
    })

    return rows
  }, [baseFiltered, pillFilters, sortBy])

  function togglePill(k: PillKey) {
    setPillFilters(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  function toggleSelectRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.id)))
    }
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return
    const confirmed = window.confirm(`Delete ${selectedIds.size} selected opportunit${selectedIds.size === 1 ? 'y' : 'ies'}? This cannot be undone.`)
    if (!confirmed) return
    setDeleting(true)
    setError('')
    try {
      const results = await Promise.all(
        Array.from(selectedIds).map(async (id) => {
          const res = await apiFetch(`/api/opportunities/${id}`, { method: 'DELETE' })
          if (res.ok) return { id, ok: true as const }
          const payload = await res.json().catch(() => ({}))
          return { id, ok: false as const, message: formatApiError(payload, 'Failed to delete') }
        }),
      )
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        const uniqueMessages = Array.from(new Set(failed.map((r) => (r as { message: string }).message)))
        setError(
          `${results.length - failed.length} of ${results.length} deleted. ${failed.length} failed: ${uniqueMessages.join(' ')}`,
        )
      }
      await load()
    } catch (err: any) {
      setError(err.message || 'Failed to delete selected opportunities')
    } finally {
      setDeleting(false)
    }
  }

  async function downloadOrderBookTemplate() {
    const XLSX = await import('xlsx')
    const headers = [
      'Company Name', 'Division / Cluster', 'Client POC',
      'Medical (Yes/No)', 'Project Category', 'Project Type', 'Description',
      'Revenue (INR)', 'Cost (INR)',
      'Lead Type (won/hot/warm/cold/lost)',
      'Lead Stage (proposal/commissioned)',
      'Expected Kick-off Date (YYYY-MM-DD)', 'Owner Email',
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers])
    ws['!cols'] = headers.map(() => ({ wch: 24 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Order Book Template')
    XLSX.writeFile(wb, 'order-book-import-template.xlsx')
  }

  async function exportToExcel() {
    const XLSX = await import('xlsx')
    const headers = [
      'OB No', 'Company', 'Division', 'Client POC', 'Medical/Mktg', 'Project Category', 'Project Type',
      'Description', 'Value', 'Cost', 'Contribution', 'Invoiced Amount', 'Linked Invoices',
      'Lead Type', 'Probability %', 'Stage', 'Owner', 'Expected Kick-off',
    ]

    const rows = filtered.map((row) => [
      row.oppNo || '',
      getCompanyName(row),
      getDivisionName(row),
      row.clientPoc?.name || '',
      row.medical ? 'Medical' : 'Mktg',
      projectCategoryLabel(row.projectCategory),
      row.projectType,
      row.description || '',
      row.estimatedValue,
      row.estimatedCost,
      row.contributionValue,
      row.invoicedAmount,
      row.invoices.map((i) => i.invNo || i.id).join(', '),
      row.leadType ? LEAD_TYPE_LABEL[row.leadType] : '',
      row.probability != null ? row.probability : '',
      row.leadStage ? LEAD_STAGE_LABEL[row.leadStage] : '',
      row.owner.name || row.owner.email,
      row.expectedKickoff ? fmtDate(row.expectedKickoff) : '',
    ])

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Order Book')
    XLSX.writeFile(wb, `order-book-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function getCompanyName(row: Opportunity) {
    return getAncestor(row.accountId, accountById, 'company')?.name || row.account?.name || '-'
  }

  function getDivisionName(row: Opportunity) {
    const div = getAncestor(row.accountId, accountById, 'division')
    const cluster = getAncestor(row.accountId, accountById, 'cluster')
    return div?.name || cluster?.name || '-'
  }

  async function updateLeadStage(row: Opportunity, stage: LeadStage) {
    setUpdatingId(row.id)
    setError('')
    try {
      const res = await apiFetch(`/api/opportunities/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadStage: stage }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(formatApiError(payload, 'Failed to update lead stage'))
      }
      await load()
    } catch (err: any) {
      setError(err.message || 'Failed to update lead stage')
    } finally {
      setUpdatingId('')
    }
  }

  async function updateLeadType(row: Opportunity, lt: LeadType) {
    if (lt === 'won') {
      setWonOpportunity(row)
      setShowWonModal(true)
      return
    }
    if (lt === 'lost') {
      setLostOpportunity(row)
      setShowLostModal(true)
      return
    }
    setUpdatingLeadTypeId(row.id)
    setError('')
    try {
      const res = await apiFetch(`/api/opportunities/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadType: lt }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(formatApiError(payload, 'Failed to update lead type'))
      }
      await load()
    } catch (err: any) {
      setError(err.message || 'Failed to update lead type')
    } finally {
      setUpdatingLeadTypeId('')
    }
  }

  // Inline probability edit. Empty input → null → reverts the row to its lead-type
  // default; any number 0-100 → stored as a manual override.
  async function saveProbability(row: Opportunity, raw: string) {
    setEditingProbId(null)
    const trimmed = raw.trim()
    const value = trimmed === '' ? null : Math.round(Number(trimmed))
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
      setError('Probability must be a whole number between 0 and 100')
      return
    }
    if ((value ?? null) === (row.probability ?? null)) return
    setUpdatingId(row.id)
    setError('')
    try {
      const res = await apiFetch(`/api/opportunities/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ probability: value }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(formatApiError(payload, 'Failed to update probability'))
      }
      await load()
    } catch (err: any) {
      setError(err.message || 'Failed to update probability')
    } finally {
      setUpdatingId('')
    }
  }

const allFilteredSelected = filtered.length > 0 && selectedIds.size === filtered.length

  // Revenue/Contribution Pipeline for the currently-filtered rows. Figures follow the
  // pipeline-mode toggle: 'weighted' scales each row by its win probability, 'actual'
  // takes the full remaining value. Fully invoiced deals are realised, not pipeline, so
  // they contribute 0; partially invoiced deals contribute only their still-uninvoiced
  // share, with Contribution scaled proportionally. Lost deals are never pipeline — they
  // are tallied separately (always at actual value) and shown on the Lost pill.
  // `breakdown` shows how the Revenue total splits across buckets so it visibly adds up.
  const pipelineKpis = useMemo(() => {
    let revenue = 0
    let contribution = 0
    let lostCount = 0
    let lostValue = 0
    let lostContribution = 0
    const breakdown: Record<'commissioned' | 'hot' | 'warm' | 'cold' | 'other', number> = {
      commissioned: 0, hot: 0, warm: 0, cold: 0, other: 0,
    }
    const companyIds = new Set<string>()
    for (const row of filtered) {
      if (row.leadType === 'lost') {
        const p = rowPipeline(row)
        lostCount += 1
        lostValue += p.actualValue
        lostContribution += p.actualContribution
        continue
      }
      const fig = rowFigures(row, pipelineMode)
      revenue += fig.value
      contribution += fig.contribution
      if (row.leadStage === 'commissioned' || row.leadStage === 'partial_invoiced') breakdown.commissioned += fig.value
      else if (row.leadType === 'hot' || row.leadType === 'warm' || row.leadType === 'cold') breakdown[row.leadType] += fig.value
      else breakdown.other += fig.value
      const company = getAncestor(row.accountId, accountById, 'company')
      if (company) companyIds.add(company.id)
    }
    return { revenue, contribution, companies: companyIds.size, breakdown, lostCount, lostValue, lostContribution }
  }, [filtered, accountById, pipelineMode])

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Order Book</h1>
        <div className="stack">
          <button
            className="button-muted"
            onClick={() => setMyOnly((v) => !v)}
            style={myOnly ? { color: 'var(--primary)', borderColor: 'var(--primary)', background: 'var(--primary-soft)' } : undefined}
          >
            {myOnly ? '✓ My Projects' : 'My Projects Only'}
          </button>
          {selectedIds.size > 0 ? (
            <button
              className="button-muted"
              onClick={deleteSelected}
              disabled={deleting}
              style={{ color: '#dc2626', borderColor: '#dc2626' }}
            >
              {deleting ? 'Deleting...' : `Delete Selected (${selectedIds.size})`}
            </button>
          ) : null}
          <button className="button-muted" onClick={downloadOrderBookTemplate} title="Download blank Excel template for bulk import">
            ↓ Template
          </button>
          <button
            className="button-muted"
            onClick={() => setShowImportModal(true)}
            title="Import opportunities from Excel file"
            style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
          >
            ↑ Import
          </button>
          <button className="button-muted" onClick={exportToExcel}>
            Export
          </button>
          <button className="button-primary" onClick={() => setShowCreateModal(true)}>
            + Create Opportunity
          </button>
          <button
            className="button-muted"
            onClick={() => { setLogOpportunityId(null); setShowLogModal(true) }}
          >
            + Log Activity
          </button>
        </div>
      </div>

      {/* Pipeline KPI Strip */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
        {[
          { label: 'Revenue Pipeline', value: pipelineKpis.revenue, color: 'var(--primary)' },
          { label: 'Contribution Pipeline', value: pipelineKpis.contribution, color: 'var(--green)' },
          { label: 'Companies', value: pipelineKpis.companies, isCount: true, color: 'var(--amber)' },
          { label: 'Projects', value: filtered.length, isCount: true, color: 'var(--purple)' },
        ].map((k) => (
          <div key={k.label} className="card" style={{ flex: '1 1 0', padding: '8px 14px', borderTop: `3px solid ${k.color}` }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{k.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: k.color, marginTop: 2 }}>
              {k.isCount ? k.value : fmtINRCompact(k.value as number)}
            </div>
          </div>
        ))}
      </div>

      {/* Mode toggle + how the Revenue Pipeline number adds up, by bucket */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
          {(['weighted', 'actual'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPipelineMode(m)}
              style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                padding: '4px 10px', border: 'none', cursor: 'pointer',
                background: pipelineMode === m ? 'var(--primary)' : 'var(--surface-2)',
                color: pipelineMode === m ? '#fff' : 'var(--text-muted)',
              }}
            >
              {m === 'weighted' ? 'Probability %' : 'Actual'}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, flex: '1 1 300px' }}>
          {pipelineMode === 'weighted'
            ? 'Remaining value weighted by win probability (Commissioned 95% · Hot 50% · Warm 20% · Cold 5%, unless a row overrides it). '
            : 'Full remaining value — no probability applied. '}
          {(() => {
            const b = pipelineKpis.breakdown
            const parts = [
              ['Commissioned', b.commissioned],
              ['Hot', b.hot],
              ['Warm', b.warm],
              ['Cold', b.cold],
              ...(b.other > 0 ? [['Other', b.other] as [string, number]] : []),
            ] as [string, number][]
            return (
              <span>
                {parts.map(([lbl, v], i) => (
                  <span key={lbl}>
                    {i > 0 ? ' + ' : ''}{lbl} {fmtINRCompact(v)}
                  </span>
                ))}
                {' = '}<strong style={{ color: 'var(--text)' }}>{fmtINRCompact(pipelineKpis.revenue)}</strong>
              </span>
            )
          })()}
          {pipelineKpis.lostCount > 0 ? (
            <span style={{ color: 'var(--red)' }}>
              {'  ·  Lost (excluded): '}
              {pipelineKpis.lostCount} project{pipelineKpis.lostCount === 1 ? '' : 's'} · {fmtINRCompact(pipelineKpis.lostValue)} value · {fmtINRCompact(pipelineKpis.lostContribution)} contribution
            </span>
          ) : null}
        </div>
      </div>

      {/* Pills: Active · Commissioned · Invoiced · Partial · Hot · Warm · Cold · Lost — all clickable filters */}
      {(() => {
        const anyActive = pillFilters.size > 0
        const ltStyles = theme === 'light' ? LEAD_TYPE_STYLE_LIGHT  : LEAD_TYPE_STYLE
        const lsStyles = theme === 'light' ? LEAD_STAGE_STYLE_LIGHT : LEAD_STAGE_STYLE
        const activeStyle = { bg: 'rgba(245,158,11,0.15)', color: theme === 'light' ? '#b45309' : '#fcd34d' }

        function pill(
          key: string, label: string, style: { bg: string; color: string },
          isActive: boolean, onClick: () => void,
          count: number, value: number, contribution: number,
        ) {
          return (
            <button key={key} onClick={onClick} style={{
              flex: '1 1 118px', minWidth: 108, textAlign: 'left', cursor: 'pointer',
              padding: '9px 12px 8px', borderRadius: 10,
              borderTop: `3px solid ${style.color}`,
              borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
              ...(isActive ? { boxShadow: `0 0 0 1.5px ${style.color}` } : {}),
              background: isActive ? style.bg : 'var(--surface-2)',
              transition: 'box-shadow 0.12s ease, background 0.12s ease',
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                color: isActive ? style.color : 'var(--text-muted)', marginBottom: 4,
              }}>{label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                <span style={{ fontWeight: 800, fontSize: 17, color: style.color, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtINRCompact(value)}</span>
              </div>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>
                {fmtINRCompact(contribution)} contrib
              </div>
            </button>
          )
        }

        const vSep = <div key="sep" style={{ width: 1, alignSelf: 'stretch', minHeight: 50, background: 'var(--border)', flexShrink: 0 }} />

        return (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
              {pill(
                'active', 'Active', activeStyle,
                pillFilters.has('active'), () => togglePill('active'),
                pillSummary.active.count, pillSummary.active.value, pillSummary.active.contribution,
              )}
              {pill(
                'commissioned', 'Commissioned', ltStyles.won,
                pillFilters.has('commissioned'), () => togglePill('commissioned'),
                pillSummary.commissioned.count, pillSummary.commissioned.value, pillSummary.commissioned.contribution,
              )}
              {pill(
                'invoiced', LEAD_STAGE_LABEL.invoiced, lsStyles.invoiced,
                pillFilters.has('invoiced'), () => togglePill('invoiced'),
                pillSummary.invoiced.count, pillSummary.invoiced.value, pillSummary.invoiced.contribution,
              )}
              {pill(
                'partial', 'Partial', lsStyles.partial_invoiced,
                pillFilters.has('partial'), () => togglePill('partial'),
                pillSummary.partial.count, pillSummary.partial.value, pillSummary.partial.contribution,
              )}
              {vSep}
              {(['hot', 'warm', 'cold', 'lost'] as PillKey[]).map((lt) => pill(
                lt, LEAD_TYPE_LABEL[lt as LeadType], ltStyles[lt as LeadType],
                pillFilters.has(lt), () => togglePill(lt),
                pillSummary[lt].count, pillSummary[lt].value, pillSummary[lt].contribution,
              ))}
              {anyActive && (
                <button className="button-muted" style={{ alignSelf: 'center', fontSize: 11, flex: '0 0 auto' }}
                  onClick={() => setPillFilters(new Set())}>
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {/* Filters toolbar */}
      <div className="card toolbar-card">
        <div className="stack" style={{ flexWrap: 'wrap', gap: 10 }}>
          <MultiSelectFilter
            label="Company"
            placeholder="All Companies"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            selected={companyFilters}
            onChange={setCompanyFilters}
            minWidth={170}
          />
          <MultiSelectFilter
            label="Project Type"
            placeholder="All Types"
            options={projectTypes.map((pt) => ({ value: pt, label: pt }))}
            selected={projectTypeFilters}
            onChange={setProjectTypeFilters}
          />
          <MultiSelectFilter
            label="Project Category"
            placeholder="All Categories"
            options={projectCategories.map((pc) => ({ value: pc, label: projectCategoryLabel(pc) }))}
            selected={projectCategoryFilters}
            onChange={setProjectCategoryFilters}
          />
          <MultiSelectFilter
            label="Owner"
            placeholder="All Owners"
            options={owners.map(([id, name]) => ({ value: id, label: name }))}
            selected={ownerFilters}
            onChange={setOwnerFilters}
          />
          <label>
            Sort By
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'created' | 'value')}>
              <option value="created">Created (Newest)</option>
              <option value="value">Value (Highest)</option>
            </select>
          </label>
          {(companyFilters.size > 0 || pillFilters.size > 0 || projectTypeFilters.size > 0 || projectCategoryFilters.size > 0 || ownerFilters.size > 0 || myOnly) ? (
            <button
              className="button-muted"
              style={{ alignSelf: 'flex-end', fontSize: 11 }}
              onClick={() => {
                setCompanyFilters(new Set())
                setMyOnly(false)
                setPillFilters(new Set())
                setProjectTypeFilters(new Set())
                setProjectCategoryFilters(new Set())
                setOwnerFilters(new Set())
              }}
            >
              Clear All Filters
            </button>
          ) : null}
        </div>
      </div>

      {loading ? <div className="card">Loading pipeline...</div> : null}
      {error ? <div className="error">{error}</div> : null}

      {!loading ? (
        <div className="table-wrap">
          <table style={{ minWidth: 1120 }}>
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    title="Select all"
                  />
                </th>
                <th style={{ minWidth: 150 }}>Company</th>
                <th style={{ minWidth: 100 }}>Client POC</th>
                <th style={{ minWidth: 120 }}>Project Type</th>
                <th style={{ minWidth: 200 }}>Description</th>
                <th style={{ minWidth: 100 }}>Value</th>
                <th style={{ minWidth: 110 }}>Contribution</th>
                <th style={{ minWidth: 100 }}>Lead Type</th>
                <th style={{ minWidth: 68 }}>Prob %</th>
                <th style={{ minWidth: 120 }}>Lead Stage</th>
                <th style={{ minWidth: 110 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                    No opportunities found for selected filters.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const lsStyle = row.leadStage ? (theme === 'light' ? LEAD_STAGE_STYLE_LIGHT : LEAD_STAGE_STYLE)[row.leadStage] : { bg: 'rgba(150,150,150,0.15)', color: '#999' }
                  const isSelected = selectedIds.has(row.id)
                  const isExpanded = expandedOppIds.has(row.id)
                  const editable = canEdit(row)
                  return (
                    <React.Fragment key={row.id}>
                    <tr
                      style={{ ...(isSelected ? { background: 'rgba(37, 99, 235, 0.10)' } : {}), ...(!editable ? { opacity: 0.82 } : {}), cursor: editable ? 'pointer' : 'default' }}
                      onClick={e => {
                        if (!editable) return
                        const target = e.target as HTMLElement
                        if (target.closest('button, input, select, a')) return
                        setEditOpportunity(row)
                      }}
                    >
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!editable}
                          onChange={() => editable && toggleSelectRow(row.id)}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                          <button
                            onClick={() => toggleOppExpand(row.id)}
                            title={isExpanded ? 'Collapse' : 'Expand details'}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 2px 0', color: 'var(--text-faint)', fontSize: 10, lineHeight: 1, flexShrink: 0 }}
                          >{isExpanded ? '▼' : '▶'}</button>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700 }}>{getCompanyName(row)}</div>
                            {(() => {
                              const div = getDivisionName(row)
                              return div && div !== '-' ? (
                                <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginTop: 1 }}>{div}</div>
                              ) : null
                            })()}
                          </div>
                        </div>
                      </td>
                      <td>{row.clientPoc?.name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{row.projectType}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{projectCategoryLabel(row.projectCategory)}</div>
                      </td>
                      <td
                        style={{ maxWidth: 220 }}
                        title={row.description || ''}
                      >
                        {row.description
                          ? <span style={{ fontSize: 11 }}>{row.description.length > 70 ? row.description.slice(0, 70) + '…' : row.description}</span>
                          : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {fmtINRCompact(row.estimatedValue)}
                        {row.invoicedAmount > 0 ? (
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#0369a1', marginTop: 2 }}>
                            − {fmtINRCompact(row.invoicedAmount)} invoiced{row.leadStage === 'invoiced' ? ' (full)' : ''}
                          </div>
                        ) : null}
                      </td>
                      {(() => {
                        // Contribution still to earn: invoicing a slice of revenue delivers that
                        // same slice of the work, so cost shrinks proportionally too (never
                        // "contribution − invoiced", which went to −cost once fully invoiced).
                        const remContribution = remainingContractContribution(row)
                        return (
                          <td style={{ fontWeight: 700, color: remContribution >= 0 ? '#047857' : '#dc2626' }}>
                            {fmtINRCompact(remContribution)}
                            {row.invoicedAmount > 0 ? (
                              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)', marginTop: 2 }}>
                                of {fmtINRCompact(row.contributionValue)}
                              </div>
                            ) : null}
                          </td>
                        )
                      })()}
                      {/* Lead Type */}
                      <td>
                        {(() => {
                          const ltStyleMap = theme === 'light' ? LEAD_TYPE_STYLE_LIGHT : LEAD_TYPE_STYLE
                          const lt = row.leadType
                          const ltStyle = lt ? ltStyleMap[lt] : { bg: 'var(--surface-2)', color: 'var(--text-muted)' }
                          return editable ? (
                            <select value={lt || ''} onChange={e => updateLeadType(row, e.target.value as LeadType)}
                              disabled={updatingLeadTypeId === row.id}
                              style={{ background: ltStyle.bg, color: ltStyle.color, border: `1px solid ${ltStyle.color}40`, borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '4px 10px', minWidth: 90, appearance: 'none', cursor: 'pointer' }}>
                              <option value="">—</option>
                              {LEAD_TYPES.map(l => <option key={l} value={l}>{LEAD_TYPE_LABEL[l]}</option>)}
                            </select>
                          ) : lt ? (
                            <span style={{ background: ltStyle.bg, color: ltStyle.color, border: `1px solid ${ltStyle.color}40`, borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '4px 10px', display: 'inline-block' }}>
                              {LEAD_TYPE_LABEL[lt]}
                            </span>
                          ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                        })()}
                      </td>
                      {/* Probability — editable badge. Blank border = lead-type default; primary = manual override. */}
                      <td>
                        {editable && editingProbId === row.id ? (
                          <input
                            autoFocus
                            type="number"
                            min={0}
                            max={100}
                            defaultValue={row.probability ?? ''}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => saveProbability(row, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              if (e.key === 'Escape') setEditingProbId(null)
                            }}
                            style={{ width: 54, fontSize: 12, padding: '3px 5px' }}
                          />
                        ) : (
                          <button
                            type="button"
                            disabled={!editable}
                            onClick={() => setEditingProbId(row.id)}
                            title={row.probability == null ? 'Default from lead type — click to set a manual value' : 'Manual override — click to edit (clear the field to revert to default)'}
                            style={{
                              fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 800,
                              padding: '3px 9px', borderRadius: 999, cursor: editable ? 'pointer' : 'default',
                              border: `1px solid ${row.probability == null ? 'var(--border)' : 'var(--primary)'}`,
                              color: row.probability == null ? 'var(--text-muted)' : 'var(--primary)',
                              background: row.probability == null ? 'var(--surface-2)' : 'var(--primary-soft)',
                            }}
                          >
                            {effectiveProbability(row)}%
                          </button>
                        )}
                        {row.probability == null ? (
                          <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>default</div>
                        ) : null}
                      </td>
                      {/* Lead Stage — Proposal/Commissioned save instantly; Partial/Invoiced open the
                          "Update Invoicing Status" modal to link real invoices and derive the amount. */}
                      <td>
                        {editable && (row.leadStage === 'partial_invoiced' || row.leadStage === 'invoiced') ? (
                          <button
                            type="button"
                            onClick={() => { setStageOpportunity(row); setStageTargetInitial(row.leadStage as 'partial_invoiced' | 'invoiced'); setShowStageModal(true) }}
                            title="Edit invoicing status / linked invoices"
                            style={{ background: lsStyle.bg, color: lsStyle.color, border: `1px solid ${lsStyle.color}40`, borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer' }}
                          >
                            {LEAD_STAGE_LABEL[row.leadStage]}
                          </button>
                        ) : editable ? (
                          <select
                            value={row.leadStage || ''}
                            onChange={(e) => {
                              const next = e.target.value as LeadStage | ''
                              if (!next) return
                              if (next === 'partial_invoiced' || next === 'invoiced') {
                                setStageOpportunity(row)
                                setStageTargetInitial(next)
                                setShowStageModal(true)
                              } else {
                                updateLeadStage(row, next)
                              }
                            }}
                            disabled={updatingId === row.id}
                            style={{ background: lsStyle.bg, color: lsStyle.color, border: `1px solid ${lsStyle.color}40`, borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '4px 10px', minWidth: 100, appearance: 'none', cursor: 'pointer' }}>
                            <option value="">—</option>
                            {LEAD_STAGES.map((s) => <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>)}
                          </select>
                        ) : row.leadStage ? (
                          <span style={{ background: lsStyle.bg, color: lsStyle.color, border: `1px solid ${lsStyle.color}40`, borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '4px 10px', display: 'inline-block' }}>
                            {LEAD_STAGE_LABEL[row.leadStage]}
                          </span>
                        ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                      </td>
                      <td>
                        {editable ? (
                          <div className="stack" style={{ gap: 5 }}>
                            <button
                              className="icon-btn"
                              onClick={() => setEditOpportunity(row)}
                              title="Edit opportunity"
                              style={{ padding: '4px 8px', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, background: '#f9fafb', display: 'flex', alignItems: 'center' }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                            <button
                              className="icon-btn"
                              onClick={() => { setLogOpportunityId(row.id); setShowLogModal(true) }}
                              title="Log activity"
                              style={{ padding: '4px 8px', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: 6, background: '#f0f9ff', display: 'flex', alignItems: 'center' }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19"/>
                                <line x1="5" y1="12" x2="19" y2="12"/>
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontStyle: 'italic' }}>View only</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr key={`${row.id}-detail`} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td colSpan={11} style={{ padding: '8px 16px 10px 52px', borderBottom: '2px solid var(--border-strong)' }}>
                          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
                            <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>OB No: </span><span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{row.oppNo || '—'}</span></div>
                            <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Owner: </span><span style={{ color: 'var(--text)' }}>{row.owner.name || row.owner.email}</span></div>
                            <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Cost: </span><span style={{ color: 'var(--text)' }}>
                              {row.invoicedAmount > 0
                                ? <>{fmtINRCompact(remainingContractCost(row))} <span style={{ color: 'var(--text-faint)' }}>of {fmtINRCompact(row.estimatedCost)}</span></>
                                : fmtINRCompact(row.estimatedCost)}
                            </span></div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Client Type: </span>
                              <span className="badge" style={{ fontSize: 10 }}>{CLIENT_TYPE_LABEL[(row.clientType || 'new') as ClientType]}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Activity Logs: </span>
                              <button
                                className="icon-btn"
                                style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: 800, padding: '1px 8px' }}
                                onClick={() => setActivityOpportunityId(row.id)}
                                title="View logs"
                              >
                                {row._count?.activities || 0} · view
                              </button>
                            </div>
                            <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Division: </span><span style={{ color: 'var(--text)' }}>{getDivisionName(row)}</span></div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Function: </span>
                              <span className={`badge ${row.medical ? 'badge-blue' : 'badge-green'}`} style={{ fontSize: 10 }}>
                                {row.medical ? 'Medical' : 'Marketing'}
                              </span>
                            </div>
                            <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Expected Kick-off: </span><span style={{ color: 'var(--text)' }}>{row.expectedKickoff ? fmtDate(row.expectedKickoff) : '—'}</span></div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Next Call: </span>
                              <span className={`badge ${nextCallClass(row.nextCallDate)}`} style={{ fontSize: 10 }}>
                                {row.nextCallDate ? fmtDate(row.nextCallDate) : '—'}
                              </span>
                            </div>
                            {row.invoices.length > 0 ? (
                              <div>
                                <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Linked Invoices: </span>
                                <span style={{ color: 'var(--text)' }}>
                                  {row.invoices.map((i) => `${i.invNo || i.id} (${fmtINRCompact(i.net)})`).join(', ')}
                                </span>
                              </div>
                            ) : null}
                            {(() => {
                              const acts = row.activities || []
                              if (acts.length === 0) return null
                              const calls = acts.filter(a => a.activityType === 'call_attempted' || a.activityType === 'call_connected').length
                              const connected = acts.filter(a => a.activityType === 'call_connected').length
                              const meetings = acts.filter(a => a.activityType === 'meeting_done' || a.activityType === 'meeting_scheduled').length
                              const firstProposalIdx = acts.findIndex(a => a.activityType === 'proposal_sent')
                              const callsBeforeProposal = firstProposalIdx >= 0
                                ? acts.slice(0, firstProposalIdx).filter(a => a.activityType === 'call_attempted' || a.activityType === 'call_connected').length
                                : null
                              return (
                                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingLeft: 12, borderLeft: '2px solid var(--border)', marginLeft: 4 }}>
                                  {calls > 0 && <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Calls: </span><span style={{ color: 'var(--text)' }}>{calls}</span>{connected > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> ({connected} connected)</span>}</div>}
                                  {meetings > 0 && <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Meetings: </span><span style={{ color: 'var(--text)' }}>{meetings}</span></div>}
                                  {firstProposalIdx >= 0 && <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Proposals sent: </span><span style={{ color: '#047857', fontWeight: 700 }}>{acts.filter(a => a.activityType === 'proposal_sent').length}</span></div>}
                                  {callsBeforeProposal != null && <div style={{ fontSize: 11, color: '#0369a1', fontStyle: 'italic' }}>{callsBeforeProposal} call{callsBeforeProposal !== 1 ? 's' : ''} before first proposal</div>}
                                </div>
                              )
                            })()}
                            {row.totalQty != null ? (
                              <>
                                <div>
                                  <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Total Qty: </span>
                                  <span style={{ color: 'var(--text)', fontWeight: 700 }}>{row.totalQty}</span>
                                </div>
                                {row.unitRevenue != null && (
                                  <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Unit Revenue: </span><span style={{ color: 'var(--text)' }}>₹{row.unitRevenue.toLocaleString('en-IN')}</span></div>
                                )}
                                {row.unitCost != null && (
                                  <div><span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Unit Cost: </span><span style={{ color: 'var(--text)' }}>₹{row.unitCost.toLocaleString('en-IN')}</span></div>
                                )}
                              </>
                            ) : null}
                          </div>
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
      ) : null}

      <CreateOpportunityModal
        open={showCreateModal}
        accounts={accounts}
        onClose={() => setShowCreateModal(false)}
        onCreated={load}
      />

      <EditOpportunityModal
        open={editOpportunity !== null}
        opportunity={editOpportunity}
        accounts={accounts}
        onClose={() => setEditOpportunity(null)}
        onSaved={load}
      />

      <LogActivityModal
        open={showLogModal}
        opportunities={opportunities.map((r) => ({
          id: r.id,
          projectType: r.projectType,
          stage: r.leadStage || r.leadType || '',
          leadStage: r.leadStage || null,
          leadType: r.leadType || null,
          account: r.account,
          description: r.description,
          estimatedCost: r.estimatedCost,
        }))}
        preselectedOpportunityId={logOpportunityId}
        onClose={() => setShowLogModal(false)}
        onLogged={load}
      />

      <WonModal
        open={showWonModal}
        opportunity={wonOpportunity}
        onClose={() => setShowWonModal(false)}
        onSaved={load}
      />

      <LostModal
        open={showLostModal}
        opportunity={lostOpportunity}
        onClose={() => setShowLostModal(false)}
        onSaved={load}
      />

      <UpdateStageModal
        open={showStageModal}
        opportunity={stageOpportunity}
        initialStage={stageTargetInitial}
        onClose={() => setShowStageModal(false)}
        onSaved={load}
      />

      <ProposalDetailsModal
        open={showProposalModal}
        opportunity={proposalOpportunity}
        targetLeadType={proposalTargetLeadType}
        onClose={() => { setShowProposalModal(false); setProposalOpportunity(null) }}
        onSaved={load}
      />

      <ActivityDrawer
        open={Boolean(activityOpportunityId)}
        opportunityId={activityOpportunityId}
        onClose={() => setActivityOpportunityId(null)}
      />

      <ImportModal
        open={showImportModal}
        title="Import Opportunities"
        excelApiPath="/api/opportunities/import-excel"
        templateColumns={[
          'Company Name', 'Division / Cluster', 'Client POC',
          'Medical (Yes/No)', 'Project Category', 'Project Type', 'Description',
          'Revenue (INR)', 'Cost (INR)',
          'Lead Type (won/hot/warm/cold/lost)',
          'Lead Stage (proposal/commissioned)',
          'Expected Kick-off Date (YYYY-MM-DD)', 'Owner Email',
        ]}
        onClose={() => setShowImportModal(false)}
        onImported={load}
      />
    </div>
  )
}
