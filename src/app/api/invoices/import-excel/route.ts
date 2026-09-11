export const preferredRegion = 'sin1'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import * as XLSX from 'xlsx'
import { parseInvoiceCSVRow, insertInvoiceRows, ParsedInvoiceRow } from '@/lib/invoice-import'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })

    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return NextResponse.json({ error: 'Empty workbook' }, { status: 400 })

    // Convert to array of arrays (same format as CSV parser output)
    const sheet = workbook.Sheets[sheetName]
    const rawRows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' })

    // Skip header row, filter rows with a date in column 9 (index 8)
    const dataRows = rawRows.slice(1).filter(r => r.length > 5 && r[8]?.toString().trim())

    // Parse rows
    const parsed: ParsedInvoiceRow[] = []
    let parseSkipped = 0
    for (const row of dataRows) {
      const strRow = row.map(cell => (cell == null ? '' : String(cell)))
      const p = parseInvoiceCSVRow(strRow)
      if (p) parsed.push(p)
      else parseSkipped++
    }

    // Insert new rows (skipping duplicates)
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
