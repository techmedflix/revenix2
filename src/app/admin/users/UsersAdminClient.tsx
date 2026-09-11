'use client'

import { useEffect, useMemo, useState } from 'react'
import { fmtDate, formatApiError } from '@/lib/utils'

type UserRow = {
  id: string
  name: string | null
  email: string
  role: 'admin' | 'leadership' | 'partnerships'
  status: 'pending' | 'approved' | 'revoked'
  createdAt: string
  approvedAt: string | null
  approvedByUser: { id: string; name: string | null; email: string } | null
}

const ROLE_OPTIONS: Array<{ value: UserRow['role']; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'partnerships', label: 'Partnerships' },
]

const STATUS_STYLE: Record<UserRow['status'], { bg: string; color: string }> = {
  pending: { bg: '#fff7ed', color: '#c2410c' },
  approved: { bg: '#f0fdf4', color: '#15803d' },
  revoked: { bg: '#fef2f2', color: '#b91c1c' },
}

export default function UsersAdminClient() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState('')
  const [users, setUsers] = useState<UserRow[]>([])

  // Add user modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addName, setAddName] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState<UserRow['role']>('partnerships')
  const [addStatus, setAddStatus] = useState<UserRow['status']>('approved')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/users')
      if (!res.ok) throw new Error('Admin access required.')
      const data = (await res.json()) as UserRow[]
      setUsers(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const sorted = useMemo(() => {
    const rank: Record<UserRow['status'], number> = { pending: 0, approved: 1, revoked: 2 }
    return [...users].sort((a, b) => {
      const byStatus = rank[a.status] - rank[b.status]
      if (byStatus !== 0) return byStatus
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [users])

  async function patchUser(id: string, patch: Partial<Pick<UserRow, 'role' | 'status' | 'name'>>) {
    setSavingId(id)
    setError('')
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const p = await res.json().catch(() => ({}))
        throw new Error(formatApiError(p, 'Failed to update user'))
      }
      await load()
    } catch (err: any) {
      setError(err.message || 'Failed to update user')
    } finally {
      setSavingId('')
    }
  }

  // Auto-save role on change
  async function handleRoleChange(id: string, role: UserRow['role']) {
    // Optimistic update
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)))
    await patchUser(id, { role })
  }

  async function addUser() {
    setAddError('')
    if (!addEmail.trim()) { setAddError('Email is required'); return }
    setAddSaving(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: addName.trim() || undefined,
          email: addEmail.trim().toLowerCase(),
          role: addRole,
          status: addStatus,
        }),
      })
      if (!res.ok) {
        const p = await res.json().catch(() => ({}))
        throw new Error(formatApiError(p, 'Failed to create user'))
      }
      setShowAddModal(false)
      setAddName(''); setAddEmail(''); setAddRole('partnerships'); setAddStatus('approved')
      await load()
    } catch (err: any) {
      setAddError(err.message || 'Failed to create user')
    } finally {
      setAddSaving(false)
    }
  }

  async function deleteUser(id: string, email: string) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return
    setDeletingId(id)
    setError('')
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const p = await res.json().catch(() => ({}))
        throw new Error(formatApiError(p, 'Failed to delete user'))
      }
      await load()
    } catch (err: any) {
      setError(err.message || 'Failed to delete user')
    } finally {
      setDeletingId('')
    }
  }

  async function saveName(id: string) {
    const name = editingNameValue.trim()
    setEditingNameId(null)
    if (!name) return
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, name } : u)))
    await patchUser(id, { name } as any)
  }

  const pendingCount = users.filter((u) => u.status === 'pending').length

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Admin Access</h1>
          {pendingCount > 0 ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                background: '#fff7ed',
                color: '#c2410c',
                padding: '2px 10px',
                borderRadius: 99,
                fontWeight: 600,
                marginTop: 4,
              }}
            >
              {pendingCount} pending approval
            </span>
          ) : null}
        </div>
        <button className="button-primary" onClick={() => setShowAddModal(true)}>+ Add User</button>
      </div>

      {loading ? <div className="card">Loading users...</div> : null}
      {error ? <div className="error" style={{ marginBottom: 10 }}>{error}</div> : null}

      {!loading ? (
        <div className="table-wrap">
          <table style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>User</th>
                <th style={{ width: 180 }}>Role</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 90 }}>Joined</th>
                <th style={{ width: 110 }}>Approved By</th>
                <th style={{ width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#6b7280' }}>
                    No users found.
                  </td>
                </tr>
              ) : null}
              {sorted.map((user) => {
                const isPending = user.status === 'pending'
                const st = STATUS_STYLE[user.status]
                return (
                  <tr key={user.id} style={{ background: isPending ? 'rgba(251,191,36,0.08)' : undefined }}>
                    <td>
                      {editingNameId === user.id ? (
                        <input
                          autoFocus
                          value={editingNameValue}
                          onChange={(e) => setEditingNameValue(e.target.value)}
                          onBlur={() => saveName(user.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveName(user.id); if (e.key === 'Escape') setEditingNameId(null) }}
                          style={{ fontSize: 13, fontWeight: 600, padding: '2px 6px', width: '100%', marginBottom: 2 }}
                        />
                      ) : (
                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                          {user.name || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>No name</span>}
                        </span>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{user.email}</div>
                    </td>
                    <td>
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value as UserRow['role'])}
                        disabled={savingId === user.id}
                        style={{
                          fontSize: 12,
                          padding: '4px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-strong)',
                          background: 'var(--surface-2)',
                          color: 'var(--text)',
                          cursor: 'pointer',
                          width: '100%',
                        }}
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 99,
                          background: st.bg,
                          color: st.color,
                        }}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>{fmtDate(user.createdAt)}</td>
                    <td style={{ fontSize: 12, color: '#6b7280' }}>
                      {user.approvedByUser?.name || user.approvedByUser?.email || '—'}
                    </td>
                    <td>
                      <div className="stack" style={{ gap: 6 }}>
                        {user.status !== 'approved' ? (
                          <button
                            className="button-primary"
                            style={{ fontSize: 12, padding: '4px 12px' }}
                            disabled={savingId === user.id}
                            onClick={() => patchUser(user.id, { status: 'approved', role: user.role })}
                          >
                            {savingId === user.id ? '...' : 'Approve'}
                          </button>
                        ) : null}
                        {user.status !== 'revoked' ? (
                          <button
                            className="button-muted"
                            style={{ fontSize: 12, padding: '4px 12px' }}
                            disabled={savingId === user.id}
                            onClick={() => patchUser(user.id, { status: 'revoked' })}
                          >
                            Revoke
                          </button>
                        ) : (
                          <button
                            className="button-muted"
                            style={{ fontSize: 12, padding: '4px 12px' }}
                            disabled={savingId === user.id}
                            onClick={() => patchUser(user.id, { status: 'approved', role: user.role })}
                          >
                            Re-approve
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          title="Edit name"
                          onClick={() => { setEditingNameId(user.id); setEditingNameValue(user.name || '') }}
                          style={{ padding: '4px 7px', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center' }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          className="button-muted"
                          style={{ fontSize: 12, padding: '4px 12px', color: '#dc2626', borderColor: '#fecaca' }}
                          disabled={deletingId === user.id || savingId === user.id}
                          onClick={() => deleteUser(user.id, user.email)}
                          title="Delete user permanently"
                        >
                          {deletingId === user.id ? '...' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Add User Modal */}
      {showAddModal ? (
        <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? setShowAddModal(false) : null)}>
          <div className="modal-card" style={{ maxWidth: 480 }}>
            <div className="page-header" style={{ alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>Add User</h3>
              <button className="button-muted" onClick={() => setShowAddModal(false)}>Close</button>
            </div>

            <div className="form" style={{ gap: 10 }}>
              <label>
                Name
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="Full name"
                  autoFocus
                />
              </label>

              <label>
                Email *
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="user@company.com"
                />
              </label>

              <label>
                Role
                <select value={addRole} onChange={(e) => setAddRole(e.target.value as UserRow['role'])}>
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>

              <label>
                Initial Status
                <select value={addStatus} onChange={(e) => setAddStatus(e.target.value as UserRow['status'])}>
                  <option value="approved">Approved (can log in immediately)</option>
                  <option value="pending">Pending (requires approval)</option>
                </select>
              </label>
            </div>

            {addError ? <div className="error" style={{ marginTop: 8 }}>{addError}</div> : null}

            <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="button-muted" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="button-primary" onClick={addUser} disabled={addSaving}>
                {addSaving ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
