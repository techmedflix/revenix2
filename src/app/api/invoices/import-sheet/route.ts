export const preferredRegion = 'sin1'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { parseInvoiceCSVRow, insertInvoiceRows, ParsedInvoiceRow } from '@/lib/invoice-import'

const DEFAULT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/102XpFlGrSGbhdJwgr58-bduOm2wfctE-wXyIVlqLkXE/export?format=csv&gid=401418141'

// ── CSV parser ─────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1]
    if (inQuote) {
      if (ch === '"' && next === '"') { cur += '"'; i++ }
      else if (ch === '"') { inQuote = false }
      else { cur += ch }
    } else {
      if (ch === '"') { inQuote = true }
      else if (ch === ',') { row.push(cur); cur = '' }
      else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = [] }
      else if (ch === '\r') { /* skip */ }
      else { cur += ch }
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

// ── route ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const sheetUrl: string = body.url || DEFAULT_SHEET_URL

    // 1. Fetch CSV from Google Sheet (or any CSV URL)
    const res = await fetch(sheetUrl, { redirect: 'follow' })
    if (!res.ok) throw new Error(`Failed to fetch sheet: ${res.status}`)
    const text = await res.text()

    // 2. Parse CSV — skip header row, filter empty rows
    const rawRows = parseCSV(text).slice(1).filter(r => r.length > 5 && r[8]?.trim())

    // 3. Parse each row
    const parsed: ParsedInvoiceRow[] = []
    let parseSkipped = 0
    for (const row of rawRows) {
      const p = parseInvoiceCSVRow(row)
      if (p) parsed.push(p)
      else parseSkipped++
    }

    // 4. Insert new rows (skipping duplicates)
    const result = await insertInvoiceRows(parsed)

    return NextResponse.json({
      imported: result.imported,
      skipped: result.skipped + parseSkipped,
      errors: result.errors,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
