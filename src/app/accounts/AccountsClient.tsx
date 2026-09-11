'use client'

import { useEffect, useMemo, useState } from 'react'
import { fmtINRCompact, formatApiError } from '@/lib/utils'
import { useToast } from '@/lib/ToastContext'
import { apiFetch } from '@/lib/api-fetch'

type AccountType = 'company' | 'cluster' | 'division' | 'brand'

type RegisteredEntity = {
  id: string
  accountId: string
  legalName: string
  gstin: string
  state: string
  isDefault: boolean
}

type Account = {
  id: string
  name: string
  type: AccountType
  parentId: string | null
  msaStart: string | null
  msaExpiry: string | null
  gstRegistered: boolean
  vendorRegistered: boolean
  vendorCode: string | null
  children?: Account[]
  registeredEntities?: RegisteredEntity[]
}

type Stats = {
  openOpportunityCount: number
  openOpportunityValue: number
  receivables: number
  activeProjects: number
  activeProjectValue: number
  totalInvoicedFY: number
  hasInvoices: boolean
}

type AccountsPayload = {
  accounts: Account[]
  tree?: Account[]
  statsByCompany: Record<string, Stats>
}

// Modal for creating/editing a tree node (cluster / division / brand)
type NodeModalState = {
  mode: 'create' | 'edit'
  target: Account | null
  parentId: string | null
}

function childTypeOptions(parentType: AccountType | null): AccountType[] {
  if (!parentType) return ['company']
  if (parentType === 'company') return ['cluster', 'division']
  if (parentType === 'cluster') return ['division']
  if (parentType === 'division') return ['brand']
  return []
}

function buildChildrenByParent(accounts: Account[]) {
  const map = new Map<string, string[]>()
  for (const row of accounts) {
    if (!row.parentId) continue
    const current = map.get(row.parentId) || []
    current.push(row.id)
    map.set(row.parentId, current)
  }
  return map
}

function collectDescendants(rootId: string, childrenByParent: Map<string, string[]>) {
  const all = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    const children = childrenByParent.get(id) || []
    for (const childId of children) {
      if (all.has(childId)) continue
      all.add(childId)
      stack.push(childId)
    }
  }
  return all
}

/** Returns number of days from today until the given ISO date string, or null. */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/** Convert a DateTime string (ISO) to a yyyy-MM-dd value for <input type="date"> */
function toDateInputValue(val: string | null): string {
  if (!val) return ''
  return val.slice(0, 10)
}

/** Convert a yyyy-MM-dd date input value to a full ISO string for the API */
function toISOString(val: string): string | null {
  if (!val) return null
  return new Date(val).toISOString()
}

const TYPE_COLORS: Record<AccountType, { bg: string; text: string; dot: string }> = {
  company: { bg: '#dbeafe', text: '#1d4ed8', dot: '#1d4ed8' },
  cluster: { bg: '#f3e8ff', text: '#7c3aed', dot: '#7c3aed' },
  division: { bg: '#dcfce7', text: '#15803d', dot: '#15803d' },
  brand: { bg: '#fff7ed', text: '#c2410c', dot: '#c2410c' },
}

function TypeDot({ type }: { type: AccountType }) {
  const c = TYPE_COLORS[type]
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: c.dot,
        marginRight: 4,
        flexShrink: 0,
      }}
    />
  )
}

function TreeNode({
  node,
  level,
  expanded,
  toggle,
  onAdd,
  onEdit,
}: {
  node: Account
  level: number
  expanded: Set<string>
  toggle: (id: string) => void
  onAdd: (parent: Account) => void
  onEdit: (node: Account) => void
}) {
  const hasChildren = (node.children || []).length > 0
  const isOpen = expanded.has(node.id)
  const c = TYPE_COLORS[node.type]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 12 + level * 18,
          paddingRight: 12,
          height: 38,
          borderBottom: '1px solid var(--border)',
          background: level === 0 ? 'var(--surface-2)' : 'var(--surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <button
            onClick={() => (hasChildren ? toggle(node.id) : undefined)}
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              cursor: hasChildren ? 'pointer' : 'default',
              color: hasChildren ? '#64748b' : 'transparent',
              fontSize: 11,
              padding: 0,
              flexShrink: 0,
            }}
          >
            {hasChildren ? (isOpen ? '▾' : '▸') : '·'}
          </button>

          <TypeDot type={node.type} />

          <span
            style={{
              fontSize: 13,
              fontWeight: level === 0 ? 700 : 500,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {node.name}
          </span>

          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 10,
              background: c.bg,
              color: c.text,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {node.type}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {childTypeOptions(node.type).length > 0 ? (
            <button
              className="icon-btn"
              onClick={() => onAdd(node)}
              title="Add child"
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              + Add
            </button>
          ) : null}
          <button
            className="icon-btn"
            onClick={() => onEdit(node)}
            title="Edit"
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            Edit
          </button>
        </div>
      </div>

      {hasChildren && isOpen
        ? node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expanded={expanded}
              toggle={toggle}
              onAdd={onAdd}
              onEdit={onEdit}
            />
          ))
        : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AccountDetailModal
// ---------------------------------------------------------------------------
function AccountDetailModal({
  company,
  accounts,
  childrenByParent,
  onClose,
  onReload,
}: {
  company: Account
  accounts: Account[]
  childrenByParent: Map<string, string[]>
  onClose: () => void
  onReload: () => Promise<void>
}) {
  const [name, setName] = useState(company.name)
  const [msaStart, setMsaStart] = useState(toDateInputValue(company.msaStart))
  const [msaExpiry, setMsaExpiry] = useState(toDateInputValue(company.msaExpiry))
  const [vendorRegistered, setVendorRegistered] = useState(company.vendorRegistered)
  const [vendorCode, setVendorCode] = useState(company.vendorCode || '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set([company.id]))

  // Node create/edit sub-modal state
  const [nodeModal, setNodeModal] = useState<NodeModalState | null>(null)
  const [nodeName, setNodeName] = useState('')
  const [nodeType, setNodeType] = useState<AccountType>('cluster')
  const [nodeParentId, setNodeParentId] = useState('')
  const [nodeSaving, setNodeSaving] = useState(false)

  // Registered entity create/edit sub-modal state
  const [entityModal, setEntityModal] = useState<{ mode: 'create' | 'edit'; target: RegisteredEntity | null } | null>(null)
  const [entityLegalName, setEntityLegalName] = useState('')
  const [entityGstin, setEntityGstin] = useState('')
  const [entityState, setEntityState] = useState('')
  const [entityIsDefault, setEntityIsDefault] = useState(false)
  const [entitySaving, setEntitySaving] = useState(false)
  const [entityDeletingId, setEntityDeletingId] = useState('')

  function openEntityCreate() {
    setEntityModal({ mode: 'create', target: null })
    setEntityLegalName('')
    setEntityGstin('')
    setEntityState('')
    setEntityIsDefault(false)
  }

  function openEntityEdit(entity: RegisteredEntity) {
    setEntityModal({ mode: 'edit', target: entity })
    setEntityLegalName(entity.legalName)
    setEntityGstin(entity.gstin)
    setEntityState(entity.state)
    setEntityIsDefault(entity.isDefault)
  }

  function closeEntityModal() {
    setEntityModal(null)
  }

  async function submitEntityModal() {
    if (!entityModal) return
    if (!entityLegalName.trim() || !entityGstin.trim() || !entityState.trim()) {
      setError('Legal name, GSTIN, and state are all required')
      return
    }
    setEntitySaving(true)
    setError('')
    try {
      const body = {
        legalName: entityLegalName.trim(),
        gstin: entityGstin.trim(),
        state: entityState.trim(),
        isDefault: entityIsDefault,
      }
      const res =
        entityModal.mode === 'create'
          ? await apiFetch(`/api/accounts/${company.id}/registered-entities`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
          : await apiFetch(`/api/accounts/${company.id}/registered-entities/${entityModal.target!.id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
      if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(formatApiError(p, 'Failed to save registered entity')) }
      closeEntityModal()
      await onReload()
    } catch (err: any) {
      setError(err.message || 'Failed to save registered entity')
    } finally {
      setEntitySaving(false)
    }
  }

  async function deleteEntity(entity: RegisteredEntity) {
    if (!window.confirm(`Delete registered entity "${entity.legalName}"?`)) return
    setEntityDeletingId(entity.id)
    setError('')
    try {
      const res = await apiFetch(`/api/accounts/${company.id}/registered-entities/${entity.id}`, { method: 'DELETE' })
      if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(formatApiError(p, 'Failed to delete registered entity')) }
      await onReload()
    } catch (err: any) {
      setError(err.message || 'Failed to delete registered entity')
    } finally {
      setEntityDeletingId('')
    }
  }

  function openNodeCreate(parent: Account) {
    const defaultType = childTypeOptions(parent.type)[0] || 'cluster'
    setNodeModal({ mode: 'create', target: parent, parentId: parent.id })
    setNodeName('')
    setNodeType(defaultType)
    setNodeParentId(parent.id)
  }

  function openNodeEdit(node: Account) {
    setNodeModal({ mode: 'edit', target: node, parentId: node.parentId })
    setNodeName(node.name)
    setNodeType(node.type)
    setNodeParentId(node.parentId || '')
  }

  function closeNodeModal() {
    setNodeModal(null)
    setNodeName('')
    setNodeParentId('')
  }

  function validNodeParentOptions(): Account[] {
    if (!nodeModal) return []
    if (nodeModal.mode === 'create') return accounts
    const target = nodeModal.target
    if (!target) return []
    const forbidden = collectDescendants(target.id, childrenByParent)
    forbidden.add(target.id)
    if (target.type === 'company') return []
    if (target.type === 'cluster') return accounts.filter((r) => r.type === 'company' && !forbidden.has(r.id))
    if (target.type === 'division') return accounts.filter((r) => (r.type === 'company' || r.type === 'cluster') && !forbidden.has(r.id))
    return accounts.filter((r) => r.type === 'division' && !forbidden.has(r.id))
  }

  async function submitNodeModal() {
    if (!nodeModal) return
    if (!nodeName.trim()) { setError('Name is required'); return }
    setNodeSaving(true)
    setError('')
    try {
      if (nodeModal.mode === 'create') {
        const res = await apiFetch('/api/accounts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: nodeName.trim(), type: nodeType, parentId: nodeParentId || null }),
        })
        if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(formatApiError(p, 'Failed to create')) }
      }
      if (nodeModal.mode === 'edit' && nodeModal.target) {
        const res = await apiFetch(`/api/accounts/${nodeModal.target.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: nodeName.trim(), parentId: nodeParentId || null }),
        })
        if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(formatApiError(p, 'Failed to save')) }
      }
      closeNodeModal()
      await onReload()
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setNodeSaving(false)
    }
  }

  async function saveCompany() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch(`/api/accounts/${company.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          msaStart: toISOString(msaStart),
          msaExpiry: toISOString(msaExpiry),
          vendorRegistered,
          vendorCode: vendorCode.trim() || null,
        }),
      })
      if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(formatApiError(p, 'Failed to save')) }
      await onReload()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function deleteCompany() {
    setDeleting(true)
    setError('')
    try {
      const res = await apiFetch(`/api/accounts/${company.id}`, { method: 'DELETE' })
      if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(formatApiError(p, 'Failed to delete')) }
      await onReload()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to delete')
    } finally {
      setDeleting(false)
      setDeleteConfirm(false)
    }
  }

  // Find the freshest version of this company in accounts (after reloads)
  const companyNode = useMemo(() => {
    function findNode(nodes: Account[]): Account | null {
      for (const n of nodes) {
        if (n.id === company.id) return n
        if (n.children) {
          const found = findNode(n.children)
          if (found) return found
        }
      }
      return null
    }
    return findNode(accounts) || company
  }, [accounts, company])

  const nodeParentOptions = validNodeParentOptions()

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => (e.target === e.currentTarget ? onClose() : null)}
    >
      <div
        className="modal-card"
        style={{ maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="page-header" style={{ alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{company.name}</h3>
          <button className="button-muted" onClick={onClose}>Close</button>
        </div>

        {error ? <div className="error" style={{ marginBottom: 10 }}>{error}</div> : null}

        {/* Company details form */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>Company Details</div>
          <div className="form" style={{ gap: 10 }}>
            <label>
              Company Name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label>
                MSA Start Date
                <div style={{ position: 'relative' }}>
                  <input
                    type="date"
                    value={msaStart}
                    onChange={(e) => setMsaStart(e.target.value)}
                    style={{ paddingRight: 32 }}
                  />
                  {msaStart ? (
                    <button
                      onClick={() => setMsaStart('')}
                      title="Clear date"
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 14, lineHeight: 1 }}
                    >×</button>
                  ) : null}
                </div>
                {msaStart ? <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{new Date(msaStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span> : null}
              </label>
              <label>
                MSA Expiry Date
                <div style={{ position: 'relative' }}>
                  <input
                    type="date"
                    value={msaExpiry}
                    onChange={(e) => setMsaExpiry(e.target.value)}
                    style={{ paddingRight: 32, borderColor: msaExpiry && daysUntil(msaExpiry) !== null && daysUntil(msaExpiry)! <= 120 ? 'var(--red)' : undefined }}
                  />
                  {msaExpiry ? (
                    <button
                      onClick={() => setMsaExpiry('')}
                      title="Clear date"
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 14, lineHeight: 1 }}
                    >×</button>
                  ) : null}
                </div>
                {msaExpiry ? (
                  <span style={{ fontSize: 10, color: daysUntil(msaExpiry) !== null && daysUntil(msaExpiry)! <= 120 ? 'var(--red)' : 'var(--text-muted)', marginTop: 2, fontWeight: daysUntil(msaExpiry) !== null && daysUntil(msaExpiry)! <= 120 ? 700 : 400 }}>
                    {new Date(msaExpiry).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {daysUntil(msaExpiry) !== null && daysUntil(msaExpiry)! <= 120 ? ` · expires in ${daysUntil(msaExpiry)} days` : ''}
                  </span>
                ) : null}
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label>
                Vendor Registered?
                <select
                  value={vendorRegistered ? 'yes' : 'no'}
                  onChange={(e) => setVendorRegistered(e.target.value === 'yes')}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>
              {vendorRegistered ? (
                <label>
                  Vendor Code
                  <input value={vendorCode} onChange={(e) => setVendorCode(e.target.value)} placeholder="e.g. VEN-001" />
                </label>
              ) : <div />}
            </div>
          </div>
        </div>

        {/* Registered Entities */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Registered Entities</span>
            <button className="icon-btn" style={{ fontSize: 11 }} onClick={openEntityCreate}>+ Add Entity</button>
          </div>
          {(companyNode.registeredEntities || []).length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No registered entities yet. Invoices for this client will use the account name as-is until you add one.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(companyNode.registeredEntities || []).map((entity) => (
                <div key={entity.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {entity.legalName}
                      {entity.isDefault ? (
                        <span className="badge badge-blue" style={{ fontSize: 10 }}>Default</span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entity.gstin} · {entity.state}</div>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <button className="icon-btn" style={{ fontSize: 11 }} onClick={() => openEntityEdit(entity)}>Edit</button>
                    <button
                      className="icon-btn"
                      style={{ fontSize: 11, color: 'var(--red)' }}
                      onClick={() => deleteEntity(entity)}
                      disabled={entityDeletingId === entity.id}
                    >
                      {entityDeletingId === entity.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hierarchy tree */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Hierarchy</span>
            <button
              className="icon-btn"
              style={{ fontSize: 11 }}
              onClick={() => openNodeCreate(companyNode)}
            >
              + Add Child
            </button>
          </div>

          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <TreeNode
              node={companyNode}
              level={0}
              expanded={expanded}
              toggle={(id) =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
              onAdd={openNodeCreate}
              onEdit={openNodeEdit}
            />
          </div>
        </div>

        {/* Action buttons */}
        {deleteConfirm ? (
          <div style={{ background: 'rgba(255,95,95,0.10)', border: '1px solid rgba(255,95,95,0.35)', borderRadius: 8, padding: '12px 16px', marginTop: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>
              Delete &quot;{company.name}&quot;? This cannot be undone.
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <button className="button-muted" onClick={() => setDeleteConfirm(false)} disabled={deleting}>Cancel</button>
              <button
                onClick={deleteCompany}
                disabled={deleting}
                style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: 'var(--red)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                {deleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        ) : (
          <div className="stack" style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <button
              onClick={() => setDeleteConfirm(true)}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,95,95,0.4)', background: 'transparent', color: 'var(--red)', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
            >
              Delete Company
            </button>
            <div className="stack" style={{ gap: 8 }}>
              <button className="button-muted" onClick={onClose}>Cancel</button>
              <button className="button-primary" onClick={saveCompany} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Node create/edit sub-modal (rendered inside backdrop so it stacks above) */}
      {nodeModal ? (
        <div
          className="modal-backdrop"
          style={{ position: 'fixed' }}
          onClick={(e) => (e.target === e.currentTarget ? closeNodeModal() : null)}
        >
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <div className="page-header" style={{ alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                {nodeModal.mode === 'create' ? 'Add Account Node' : `Edit — ${nodeModal.target?.name || ''}`}
              </h3>
              <button className="button-muted" onClick={closeNodeModal}>Close</button>
            </div>

            {nodeModal.mode === 'create' && nodeModal.target ? (
              <div className="kpi-sub" style={{ marginBottom: 10 }}>
                Under: <strong>{nodeModal.target.name}</strong> ({nodeModal.target.type})
              </div>
            ) : null}

            <div className="form" style={{ gap: 10 }}>
              <label>
                Name *
                <input value={nodeName} onChange={(e) => setNodeName(e.target.value)} autoFocus />
              </label>

              <label>
                Type
                <select
                  value={nodeType}
                  onChange={(e) => setNodeType(e.target.value as AccountType)}
                  disabled={nodeModal.mode === 'edit'}
                >
                  {(nodeModal.mode === 'create'
                    ? childTypeOptions(nodeModal.target?.type || null)
                    : [nodeModal.target?.type || 'cluster']
                  ).map((row) => (
                    <option key={row} value={row}>{row}</option>
                  ))}
                </select>
              </label>

              {(nodeModal.mode === 'create' && !nodeModal.target) ||
              (nodeModal.mode === 'edit' && nodeModal.target?.type !== 'company') ? (
                <label>
                  Parent
                  <select value={nodeParentId} onChange={(e) => setNodeParentId(e.target.value)}>
                    {nodeModal.mode === 'create' && !nodeModal.target ? (
                      <option value="">Root (top-level)</option>
                    ) : null}
                    {nodeParentOptions.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} ({row.type})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="button-muted" onClick={closeNodeModal}>Cancel</button>
              <button className="button-primary" onClick={submitNodeModal} disabled={nodeSaving}>
                {nodeSaving ? 'Saving...' : nodeModal.mode === 'create' ? 'Create' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Registered entity create/edit sub-modal */}
      {entityModal ? (
        <div
          className="modal-backdrop"
          style={{ position: 'fixed' }}
          onClick={(e) => (e.target === e.currentTarget ? closeEntityModal() : null)}
        >
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <div className="page-header" style={{ alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                {entityModal.mode === 'create' ? 'Add Registered Entity' : 'Edit Registered Entity'}
              </h3>
              <button className="button-muted" onClick={closeEntityModal}>Close</button>
            </div>

            <div className="form" style={{ gap: 10 }}>
              <label>
                Legal Name *
                <input value={entityLegalName} onChange={(e) => setEntityLegalName(e.target.value)} placeholder="e.g. Pfizer Healthcare Pvt Ltd" autoFocus />
              </label>
              <label>
                GSTIN *
                <input value={entityGstin} onChange={(e) => setEntityGstin(e.target.value)} placeholder="e.g. 24AAHCP8352J1Z4" />
              </label>
              <label>
                State *
                <input value={entityState} onChange={(e) => setEntityState(e.target.value)} placeholder="e.g. Gujarat" />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row' }}>
                <input type="checkbox" checked={entityIsDefault} onChange={(e) => setEntityIsDefault(e.target.checked)} />
                Use as default for new invoices
              </label>
            </div>

            <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="button-muted" onClick={closeEntityModal}>Cancel</button>
              <button className="button-primary" onClick={submitEntityModal} disabled={entitySaving}>
                {entitySaving ? 'Saving...' : entityModal.mode === 'create' ? 'Create' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// AccountGroup — minimizable group of company cards
// ---------------------------------------------------------------------------
function AccountCompanyCard({ company, stats, onSelect }: { company: Account; stats: Stats | undefined; onSelect: (c: Account) => void }) {
  const msaDays = daysUntil(company.msaExpiry)
  const msaWarning = msaDays !== null && msaDays <= 120
  return (
    <div
      className="card"
      onClick={() => onSelect(company)}
      style={{
        cursor: 'pointer',
        border: msaWarning ? '1.5px solid #fca5a5' : '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 0,
        overflow: 'hidden',
        position: 'relative',
        transition: 'box-shadow 0.15s ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.35)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
    >
      {/* Card header */}
      <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 5 }} title={company.name}>
          {company.name}
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {company.vendorRegistered && company.vendorCode ? (
            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999, background: 'rgba(34,217,138,0.12)', color: 'var(--green)', border: '1px solid rgba(34,217,138,0.30)', fontWeight: 700 }}>
              {company.vendorCode}
            </span>
          ) : null}
          {msaWarning ? (
            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999, background: 'rgba(255,95,95,0.15)', color: 'var(--red)', fontWeight: 700, border: '1px solid rgba(255,95,95,0.35)' }}>
              MSA exp. {msaDays}d
            </span>
          ) : company.msaExpiry ? (
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>MSA {new Date(company.msaExpiry).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
          ) : null}
        </div>
      </div>
      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        <div style={{ padding: '8px 14px', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 2 }}>Open Opps</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--primary)' }}>{stats?.openOpportunityCount || 0}</div>
          {stats?.openOpportunityValue ? <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>{fmtINRCompact(stats.openOpportunityValue)}</div> : null}
        </div>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 2 }}>Active Projects</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--green)' }}>{stats?.activeProjects || 0}</div>
          {stats?.activeProjectValue ? <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>{fmtINRCompact(stats.activeProjectValue)}</div> : null}
        </div>
        <div style={{ padding: '8px 14px', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 2 }}>FY Invoiced</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--amber)' }}>{fmtINRCompact(stats?.totalInvoicedFY || 0)}</div>
        </div>
        <div style={{ padding: '8px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 2 }}>Receivables</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: (stats?.receivables || 0) > 0 ? 'var(--red)' : 'var(--text-faint)' }}>{fmtINRCompact(stats?.receivables || 0)}</div>
        </div>
      </div>
    </div>
  )
}

function AccountGroup({
  label, companies, statsByCompany, onSelect, solid,
}: {
  label: string
  companies: Account[]
  statsByCompany: Record<string, Stats>
  onSelect: (c: Account) => void
  solid: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', marginBottom: collapsed ? 0 : 10 }}
        onClick={() => setCollapsed((v) => !v)}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: solid ? 'var(--green)' : 'var(--text-muted)' }}>
          {collapsed ? '▶' : '▼'}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
          {label} ({companies.length})
        </span>
      </div>
      {!collapsed ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {companies.map((company) => (
            <AccountCompanyCard
              key={company.id}
              company={company}
              stats={statsByCompany[company.id]}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// Main component
// ---------------------------------------------------------------------------
export default function AccountsClient() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [tree, setTree] = useState<Account[]>([])
  const [statsByCompany, setStatsByCompany] = useState<Record<string, Stats>>({})

  // The company whose detail modal is open
  const [detailCompany, setDetailCompany] = useState<Account | null>(null)

  // Top-level node create modal (for "+ Add Company")
  const [topModal, setTopModal] = useState(false)
  const [topName, setTopName] = useState('')
  const [topSaving, setTopSaving] = useState(false)

  const childrenByParent = useMemo(() => buildChildrenByParent(accounts), [accounts])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/accounts?tree=true')
      if (!res.ok) throw new Error('Failed to load account hierarchy')
      const data = (await res.json()) as AccountsPayload
      setAccounts(data.accounts)
      setTree(data.tree || [])
      setStatsByCompany(data.statsByCompany || {})
    } catch (err: any) {
      setError(err.message || 'Failed to load account hierarchy')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function createCompany() {
    if (!topName.trim()) { setError('Name is required'); return }
    setTopSaving(true)
    setError('')
    try {
      const res = await apiFetch('/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: topName.trim(), type: 'company', parentId: null }),
      })
      if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(formatApiError(p, 'Failed to create company')) }
      toast('Company created!', 'success')
      setTopModal(false)
      setTopName('')
      await load()
    } catch (err: any) {
      toast(err.message || 'Failed to create company', 'error')
      setError(err.message || 'Failed to create company')
    } finally {
      setTopSaving(false)
    }
  }

  // When the detail modal reloads, keep it open but refresh the company reference
  async function reloadAndSync() {
    await load()
    // After load, detailCompany will have stale data; we update it via the effect below
  }

  // Sync detailCompany with the freshest tree data after reload
  useEffect(() => {
    if (!detailCompany) return
    const fresh = tree.find((c) => c.id === detailCompany.id)
    if (fresh) setDetailCompany(fresh)
  }, [tree]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Accounts</h1>
        <button className="button-primary" onClick={() => { setTopModal(true); setTopName('') }}>
          + Add Company
        </button>
      </div>

      {error ? <div className="error" style={{ marginBottom: 10 }}>{error}</div> : null}
      {loading ? <div className="card">Loading hierarchy...</div> : null}

      {!loading ? (
        <>
          {tree.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
              No companies yet. Click &quot;+ Add Company&quot; to get started.
            </div>
          ) : (
            <>
              <AccountGroup
                label="Vendor Registered"
                companies={tree.filter((c) => c.vendorRegistered)}
                statsByCompany={statsByCompany}
                onSelect={setDetailCompany}
                solid={true}
              />
              <AccountGroup
                label="Vendor Not Registered"
                companies={tree.filter((c) => !c.vendorRegistered)}
                statsByCompany={statsByCompany}
                onSelect={setDetailCompany}
                solid={false}
              />
            </>
          )}
        </>
      ) : null}

      {/* Account Detail Modal */}
      {detailCompany ? (
        <AccountDetailModal
          company={detailCompany}
          accounts={accounts}
          childrenByParent={childrenByParent}
          onClose={() => setDetailCompany(null)}
          onReload={reloadAndSync}
        />
      ) : null}

      {/* Top-level "+ Add Company" modal */}
      {topModal ? (
        <div
          className="modal-backdrop"
          onClick={(e) => (e.target === e.currentTarget ? setTopModal(false) : null)}
        >
          <div className="modal-card" style={{ maxWidth: 440 }}>
            <div className="page-header" style={{ alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>Add Company</h3>
              <button className="button-muted" onClick={() => setTopModal(false)}>Close</button>
            </div>
            <div className="form" style={{ gap: 10 }}>
              <label>
                Company Name *
                <input
                  value={topName}
                  onChange={(e) => setTopName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') createCompany() }}
                />
              </label>
            </div>
            <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="button-muted" onClick={() => setTopModal(false)}>Cancel</button>
              <button className="button-primary" onClick={createCompany} disabled={topSaving}>
                {topSaving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
