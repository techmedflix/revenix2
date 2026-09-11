'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '@/lib/ToastContext'
import { formatApiError } from '@/lib/utils'
import { apiFetch } from '@/lib/api-fetch'

type ProjectTypeOption = {
  id: string
  category: string
  projectType: string
  sortOrder: number
}

type ApiResponse = {
  categories: Record<string, string[]>
  options: ProjectTypeOption[]
}

// Preferred display order — unlisted categories follow alphabetically; 'custom' always last
const CATEGORY_ORDER = ['virtual_events', 'managed_events', 'medflix_productions', 'research', 'content_design']

const CATEGORY_LABELS: Record<string, string> = {
  virtual_events:       'Virtual Events',
  managed_events:       'Managed Events',
  medflix_productions:  'Medflix Productions',
  research:             'Research',
  content_design:       'Content & Design',
  custom:               'Custom',
}

function categoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const CATEGORY_ACCENT: Record<string, string> = {
  virtual_events:      '#1d4ed8',
  managed_events:      '#0f766e',
  medflix_productions: '#7c3aed',
  research:            '#b45309',
  content_design:      '#c2410c',
  custom:              '#64748b',
}

function accentColor(cat: string) {
  return CATEGORY_ACCENT[cat] ?? '#64748b'
}

// ---------------------------------------------------------------------------
// EditIcon / DeleteIcon — same SVGs used in the invoicing table
// ---------------------------------------------------------------------------
function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// CategoryTable — one category section with its offerings in a table
// ---------------------------------------------------------------------------
function CategoryTable({
  category,
  items,
  editingId,
  editValue,
  editError,
  saving,
  deleteConfirmId,
  deleting,
  renamingCat,
  renameCatValue,
  renameCatSaving,
  renameCatError,
  deleteCatConfirm,
  deletingCat,
  onStartEdit,
  onEditChange,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onDeleteConfirm,
  onCancelDelete,
  onAdd,
  onStartRename,
  onRenameCatChange,
  onSaveRename,
  onCancelRename,
  onDeleteCatConfirm,
  onDeleteCat,
  onCancelDeleteCat,
}: {
  category: string
  items: ProjectTypeOption[]
  editingId: string | null
  editValue: string
  editError: string
  saving: boolean
  deleteConfirmId: string | null
  deleting: boolean
  renamingCat: string | null
  renameCatValue: string
  renameCatSaving: boolean
  renameCatError: string
  deleteCatConfirm: string | null
  deletingCat: boolean
  onStartEdit: (opt: ProjectTypeOption) => void
  onEditChange: (v: string) => void
  onSaveEdit: (id: string) => void
  onCancelEdit: () => void
  onDelete: (id: string) => void
  onDeleteConfirm: (id: string) => void
  onCancelDelete: () => void
  onAdd: (cat: string) => void
  onStartRename: (cat: string) => void
  onRenameCatChange: (v: string) => void
  onSaveRename: (cat: string) => void
  onCancelRename: () => void
  onDeleteCatConfirm: (cat: string) => void
  onDeleteCat: (cat: string) => void
  onCancelDeleteCat: () => void
}) {
  const accent = accentColor(category)
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderTop: `3px solid ${accent}` }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid var(--border)', gap: 8,
      }}>
        {renamingCat === category ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <input
              autoFocus
              value={renameCatValue}
              onChange={e => onRenameCatChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSaveRename(category); if (e.key === 'Escape') onCancelRename() }}
              style={{ fontSize: 13, fontWeight: 700, flex: 1 }}
              placeholder="Category name"
            />
            {renameCatError ? <span style={{ fontSize: 11, color: '#dc2626' }}>{renameCatError}</span> : null}
            <button className="button-primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => onSaveRename(category)} disabled={renameCatSaving}>
              {renameCatSaving ? '…' : 'Save'}
            </button>
            <button className="button-muted" style={{ fontSize: 11, padding: '3px 8px' }} onClick={onCancelRename}>Cancel</button>
          </div>
        ) : deleteCatConfirm === category ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#dc2626' }}>
              Delete &ldquo;{categoryLabel(category)}&rdquo; and all {sorted.length} offering{sorted.length !== 1 ? 's' : ''}?
            </span>
            <button onClick={() => onDeleteCat(category)} disabled={deletingCat} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              {deletingCat ? '…' : 'Yes, Delete'}
            </button>
            <button className="button-muted" style={{ fontSize: 11, padding: '3px 8px' }} onClick={onCancelDeleteCat}>Cancel</button>
          </div>
        ) : (
          <>
            <span style={{ fontWeight: 700, fontSize: 13, color: accent }}>
              {categoryLabel(category)}
              <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                {sorted.length} offering{sorted.length !== 1 ? 's' : ''}
              </span>
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => onStartRename(category)}
                title="Rename category"
                style={{ cursor: 'pointer', padding: '3px 7px', color: 'var(--text-muted)', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--surface-2)' }}
              >
                <EditIcon />
              </button>
              <button
                onClick={() => onDeleteCatConfirm(category)}
                title="Delete category"
                style={{ cursor: 'pointer', padding: '3px 7px', color: 'var(--red)', borderRadius: 6, border: '1px solid rgba(255,95,95,0.35)', background: 'rgba(255,95,95,0.10)' }}
              >
                <DeleteIcon />
              </button>
              <button
                onClick={() => onAdd(category)}
                style={{
                  fontSize: 11, padding: '3px 12px', borderRadius: 6,
                  border: `1px solid ${accent}`, background: 'transparent',
                  color: accent, fontWeight: 700, cursor: 'pointer',
                }}
              >
                + Add
              </button>
            </div>
          </>
        )}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          No offerings yet — click + Add
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)' }}>
              <th style={{ padding: '6px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', width: 32 }}>#</th>
              <th style={{ padding: '6px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Offering Name</th>
              <th style={{ padding: '6px 16px', width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((opt, i) => (
              <tr key={opt.id} style={{ borderTop: '1px solid var(--border)' }}>
                {editingId === opt.id ? (
                  <>
                    <td style={{ padding: '6px 16px', color: 'var(--text-muted)', fontSize: 12 }}>{i + 1}</td>
                    <td style={{ padding: '6px 16px' }}>
                      <input
                        autoFocus
                        value={editValue}
                        onChange={e => onEditChange(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(opt.id); if (e.key === 'Escape') onCancelEdit() }}
                        style={{ width: '100%', maxWidth: 320 }}
                      />
                      {editError ? <div className="error" style={{ fontSize: 11, marginTop: 3 }}>{editError}</div> : null}
                    </td>
                    <td style={{ padding: '6px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button
                        className="button-primary"
                        style={{ fontSize: 11, padding: '3px 10px', marginRight: 4 }}
                        onClick={() => onSaveEdit(opt.id)}
                        disabled={saving}
                      >
                        {saving ? '…' : 'Save'}
                      </button>
                      <button
                        className="button-muted"
                        style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={onCancelEdit}
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: '9px 16px', color: 'var(--text-muted)', fontSize: 12 }}>{i + 1}</td>
                    <td
                      style={{ padding: '9px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: 'var(--text)' }}
                      onClick={() => onStartEdit(opt)}
                      title="Click to edit"
                    >
                      {opt.projectType}
                    </td>
                    <td style={{ padding: '6px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {deleteConfirmId === opt.id ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,95,95,0.10)', border: '1px solid rgba(255,95,95,0.35)', borderRadius: 6, padding: '3px 8px' }}>
                          <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>Delete?</span>
                          <button
                            onClick={() => onDelete(opt.id)}
                            disabled={deleting}
                            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                          >{deleting ? '…' : 'Yes'}</button>
                          <button
                            onClick={onCancelDelete}
                            style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-strong)', background: 'var(--surface-2)', color: 'var(--text-muted)', cursor: 'pointer' }}
                          >No</button>
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => onStartEdit(opt)}
                            title="Edit"
                            style={{ cursor: 'pointer', padding: '4px 7px', color: 'var(--text-muted)', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--surface-2)', marginRight: 4 }}
                          >
                            <EditIcon />
                          </button>
                          <button
                            onClick={() => onDeleteConfirm(opt.id)}
                            title="Delete"
                            style={{ border: '1px solid rgba(255,95,95,0.35)', cursor: 'pointer', padding: '4px 7px', color: 'var(--red)', borderRadius: 6, background: 'rgba(255,95,95,0.10)' }}
                          >
                            <DeleteIcon />
                          </button>
                        </>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ProjectTypesAdminClient() {
  const { toast } = useToast()
  const [options, setOptions] = useState<ProjectTypeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Inline delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Category rename
  const [renamingCat, setRenamingCat] = useState<string | null>(null)
  const [renameCatValue, setRenameCatValue] = useState('')
  const [renameCatSaving, setRenameCatSaving] = useState(false)
  const [renameCatError, setRenameCatError] = useState('')

  // Category delete confirmation
  const [deleteCatConfirm, setDeleteCatConfirm] = useState<string | null>(null)
  const [deletingCat, setDeletingCat] = useState(false)

  // Add-to-category modal
  const [addModal, setAddModal] = useState<string | null>(null)   // category key
  const [addValue, setAddValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  // New category modal
  const [newCatModal, setNewCatModal] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatType, setNewCatType] = useState('')
  const [newCatAdding, setNewCatAdding] = useState(false)
  const [newCatError, setNewCatError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/project-types')
      if (!res.ok) throw new Error('Failed to load offerings')
      const data: ApiResponse = await res.json()
      setOptions(data.options)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Build sorted category list
  const { grouped, sortedCats } = useMemo(() => {
    const g: Record<string, ProjectTypeOption[]> = {}
    for (const opt of options) {
      ;(g[opt.category] ??= []).push(opt)
    }
    const allCats = Object.keys(g)
    const cats = [
      ...CATEGORY_ORDER.filter(c => allCats.includes(c)),
      ...allCats.filter(c => !CATEGORY_ORDER.includes(c) && c !== 'custom').sort(),
      ...allCats.filter(c => c === 'custom'),
    ]
    return { grouped: g, sortedCats: cats }
  }, [options])

  // ── Inline edit ──────────────────────────────────────────────────────────
  function startEdit(opt: ProjectTypeOption) {
    setEditingId(opt.id)
    setEditValue(opt.projectType)
    setEditCategory(opt.category)
    setEditError('')
  }

  function cancelEdit() { setEditingId(null); setEditError('') }

  async function saveEdit(id: string) {
    if (!editValue.trim()) { setEditError('Name is required'); return }
    setSaving(true); setEditError('')
    try {
      const res = await apiFetch(`/api/project-types/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: editCategory, projectType: editValue.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setEditError(formatApiError(d, 'Failed')); return
      }
      const d = await res.json().catch(() => ({}))
      toast(
        d?.cascaded ? `Offering renamed — ${d.cascaded} existing record${d.cascaded === 1 ? '' : 's'} updated` : 'Offering updated!',
        'success',
      )
      setEditingId(null)
      await load()
    } finally { setSaving(false) }
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/project-types/${id}`, { method: 'DELETE' })
      if (!res.ok) { toast('Failed to delete offering', 'error'); setError('Failed to delete offering'); return }
      toast('Offering deleted', 'success')
      setDeleteConfirmId(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  // ── Category rename ───────────────────────────────────────────────────────
  async function handleRenameCategory(oldCat: string) {
    const newKey = renameCatValue.trim().toLowerCase().replace(/\s+/g, '_')
    if (!newKey) { setRenameCatError('Name is required'); return }
    if (newKey === oldCat) { setRenamingCat(null); return }
    setRenameCatSaving(true); setRenameCatError('')
    try {
      const items = grouped[oldCat] || []
      await Promise.all(items.map(opt =>
        apiFetch(`/api/project-types/${opt.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: newKey, projectType: opt.projectType }),
        })
      ))
      setRenamingCat(null)
      await load()
    } catch {
      setRenameCatError('Failed to rename')
    } finally {
      setRenameCatSaving(false)
    }
  }

  // ── Category delete ───────────────────────────────────────────────────────
  async function handleDeleteCategory(cat: string) {
    setDeletingCat(true)
    try {
      const items = grouped[cat] || []
      await Promise.all(items.map(opt =>
        apiFetch(`/api/project-types/${opt.id}`, { method: 'DELETE' })
      ))
      setDeleteCatConfirm(null)
      await load()
    } finally {
      setDeletingCat(false)
    }
  }

  // ── Add to existing category ─────────────────────────────────────────────
  async function handleAdd() {
    if (!addModal) return
    if (!addValue.trim()) { setAddError('Name is required'); return }
    setAdding(true); setAddError('')
    try {
      const res = await apiFetch('/api/project-types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: addModal, projectType: addValue.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setAddError(formatApiError(d, 'Failed')); return
      }
      toast('Offering added!', 'success')
      setAddModal(null); setAddValue('')
      await load()
    } finally { setAdding(false) }
  }

  // ── New category ─────────────────────────────────────────────────────────
  async function handleNewCategory() {
    if (!newCatName.trim()) { setNewCatError('Category name is required'); return }
    if (!newCatType.trim()) { setNewCatError('At least one offering is required'); return }
    setNewCatAdding(true); setNewCatError('')
    try {
      const res = await apiFetch('/api/project-types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category: newCatName.trim().toLowerCase().replace(/\s+/g, '_'),
          projectType: newCatType.trim(),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setNewCatError(formatApiError(d, 'Failed')); return
      }
      toast('Category created!', 'success')
      setNewCatModal(false); setNewCatName(''); setNewCatType('')
      await load()
    } finally { setNewCatAdding(false) }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Offerings</h1>
        <button className="button-primary" onClick={() => { setNewCatModal(true); setNewCatName(''); setNewCatType(''); setNewCatError('') }}>
          + New Category
        </button>
      </div>

      {error ? <div className="error" style={{ marginBottom: 16 }}>{error}</div> : null}

      {loading ? (
        <div className="card">Loading offerings…</div>
      ) : sortedCats.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          No offerings yet. Click &quot;+ New Category&quot; to get started.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {sortedCats.map(cat => (
            <CategoryTable
              key={cat}
              category={cat}
              items={grouped[cat] || []}
              editingId={editingId}
              editValue={editValue}
              editError={editError}
              saving={saving}
              deleteConfirmId={deleteConfirmId}
              deleting={deleting}
              renamingCat={renamingCat}
              renameCatValue={renameCatValue}
              renameCatSaving={renameCatSaving}
              renameCatError={renameCatError}
              deleteCatConfirm={deleteCatConfirm}
              deletingCat={deletingCat}
              onStartEdit={startEdit}
              onEditChange={setEditValue}
              onSaveEdit={saveEdit}
              onCancelEdit={cancelEdit}
              onDelete={handleDelete}
              onDeleteConfirm={(id) => setDeleteConfirmId(id)}
              onCancelDelete={() => setDeleteConfirmId(null)}
              onAdd={(c) => { setAddModal(c); setAddValue(''); setAddError('') }}
              onStartRename={(c) => { setRenamingCat(c); setRenameCatValue(categoryLabel(c)); setRenameCatError('') }}
              onRenameCatChange={setRenameCatValue}
              onSaveRename={handleRenameCategory}
              onCancelRename={() => setRenamingCat(null)}
              onDeleteCatConfirm={(c) => setDeleteCatConfirm(c)}
              onDeleteCat={handleDeleteCategory}
              onCancelDeleteCat={() => setDeleteCatConfirm(null)}
            />
          ))}
        </div>
      )}

      {/* Add offering modal */}
      {addModal ? (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setAddModal(null)}>
          <div className="modal-card" style={{ maxWidth: 400 }}>
            <div className="page-header" style={{ alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17 }}>Add Offering</h3>
                <p className="page-subtitle" style={{ margin: 0 }}>Category: <strong>{categoryLabel(addModal)}</strong></p>
              </div>
              <button className="button-muted" onClick={() => setAddModal(null)}>Close</button>
            </div>
            <label>
              Offering Name
              <input
                autoFocus
                value={addValue}
                onChange={e => setAddValue(e.target.value)}
                placeholder="e.g. Podcast Series"
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </label>
            {addError ? <div className="error" style={{ marginTop: 6 }}>{addError}</div> : null}
            <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="button-muted" onClick={() => setAddModal(null)}>Cancel</button>
              <button className="button-primary" onClick={handleAdd} disabled={adding}>
                {adding ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* New category modal */}
      {newCatModal ? (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setNewCatModal(false)}>
          <div className="modal-card" style={{ maxWidth: 420 }}>
            <div className="page-header" style={{ alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>New Category</h3>
              <button className="button-muted" onClick={() => setNewCatModal(false)}>Close</button>
            </div>
            <div className="form-grid">
              <label>
                Category Name
                <input
                  autoFocus
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder="e.g. Digital Events"
                />
              </label>
              <label>
                First Offering
                <input
                  value={newCatType}
                  onChange={e => setNewCatType(e.target.value)}
                  placeholder="e.g. Live Stream"
                  onKeyDown={e => e.key === 'Enter' && handleNewCategory()}
                />
              </label>
            </div>
            {newCatError ? <div className="error" style={{ marginTop: 6 }}>{newCatError}</div> : null}
            <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="button-muted" onClick={() => setNewCatModal(false)}>Cancel</button>
              <button className="button-primary" onClick={handleNewCategory} disabled={newCatAdding}>
                {newCatAdding ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
