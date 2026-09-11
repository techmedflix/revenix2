'use client'

import { useRef, useState } from 'react'

type Mode = 'sheet' | 'excel'

type Props = {
  open: boolean
  title: string
  /** API endpoint for Google Sheet import (POST with JSON { url }). Omit to hide the sheet tab. */
  sheetApiPath?: string
  /** API endpoint for Excel/CSV file upload (POST with FormData { file }) */
  excelApiPath: string
  /** Default Google Sheet URL to prefill (optional) */
  defaultSheetUrl?: string
  /** Column headers shown in the Excel template info box */
  templateColumns: string[]
  /** Verb for the success line — "42 <verb>, N skipped". Defaults to "added". */
  resultVerb?: string
  /** Optional line shown under the column list (e.g. "columns matched by header name"). */
  note?: string
  onClose: () => void
  onImported: () => void
}

export default function ImportModal({
  open,
  title,
  sheetApiPath,
  excelApiPath,
  defaultSheetUrl = '',
  templateColumns,
  resultVerb = 'added',
  note,
  onClose,
  onImported,
}: Props) {
  const [mode, setMode] = useState<Mode>(sheetApiPath ? 'sheet' : 'excel')
  const [sheetUrl, setSheetUrl] = useState(defaultSheetUrl)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors?: string[] } | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  function reset() {
    setResult(null)
    setError('')
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function runImport() {
    setError('')
    setResult(null)
    setLoading(true)

    try {
      let res: Response

      if (mode === 'sheet') {
        if (!sheetApiPath) { setError('Sheet import not supported'); setLoading(false); return }
        if (!sheetUrl.trim()) { setError('Please enter a Google Sheet URL'); setLoading(false); return }
        res = await fetch(sheetApiPath, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: sheetUrl.trim() }),
        })
      } else {
        if (!file) { setError('Please select a file'); setLoading(false); return }
        const fd = new FormData()
        fd.append('file', file)
        res = await fetch(excelApiPath, { method: 'POST', body: fd })
      }

      const data = await res.json()
      if (!res.ok || data.error) { const rawErr = data.error || 'Import failed'; setError(typeof rawErr === 'string' ? rawErr : 'Import failed'); return }

      setResult({ imported: data.imported, skipped: data.skipped, errors: data.errors })
      onImported()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => (e.target === e.currentTarget ? handleClose() : null)}>
      <div className="modal-card" style={{ maxWidth: 560 }}>
        <div className="page-header" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button className="button-muted" onClick={handleClose}>Close</button>
        </div>

        {/* Mode tabs — only show if both modes are available */}
        {sheetApiPath ? (
          <div className="stack" style={{ marginTop: 12, gap: 6 }}>
            <button
              className={mode === 'sheet' ? 'button-primary' : 'button-muted'}
              style={{ flex: 1 }}
              onClick={() => { setMode('sheet'); reset() }}
            >
              Google Sheet URL
            </button>
            <button
              className={mode === 'excel' ? 'button-primary' : 'button-muted'}
              style={{ flex: 1 }}
              onClick={() => { setMode('excel'); reset() }}
            >
              Upload Excel / CSV
            </button>
          </div>
        ) : null}

        <div style={{ marginTop: 16 }}>
          {mode === 'sheet' ? (
            <label>
              Google Sheet URL
              <input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/…/export?format=csv&gid=…"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
              />
              <span style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4, display: 'block' }}>
                Share the sheet publicly, then use <strong>File → Share → Publish to web → CSV</strong> to get the URL.
              </span>
            </label>
          ) : (
            <label>
              Excel or CSV file
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
          )}
        </div>

        {/* Template column info */}
        <div className="card" style={{ marginTop: 12, padding: 10, background: 'var(--surface-2)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-faint)' }}>
            Expected columns (row 1 = header, data from row 2):
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px' }}>
            {templateColumns.map((col, i) => (
              <span key={i} style={{ fontSize: 11, padding: '2px 6px', background: 'var(--surface-3)', borderRadius: 4 }}>
                {String.fromCharCode(65 + i)}: {col}
              </span>
            ))}
          </div>
          {note ? (
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>{note}</div>
          ) : null}
        </div>

        {result ? (
          <div style={{ marginTop: 12, padding: 10, background: 'rgba(22,163,74,0.1)', borderRadius: 6, border: '1px solid rgba(22,163,74,0.3)' }}>
            <div style={{ fontWeight: 700, color: 'var(--green)' }}>
              Import complete: {result.imported} {resultVerb}, {result.skipped} skipped
            </div>
            {result.errors && result.errors.length > 0 ? (
              <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>
                Errors: {result.errors.join(' | ')}
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="error" style={{ marginTop: 10 }}>{error}</div> : null}

        <div className="stack" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="button-muted" onClick={handleClose}>Cancel</button>
          <button
            className="button-primary"
            onClick={runImport}
            disabled={loading}
            style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
          >
            {loading ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
