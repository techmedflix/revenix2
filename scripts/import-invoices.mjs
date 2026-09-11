/**
 * Import PMD invoices from Google Sheet directly into DB.
 * Run: node scripts/import-invoices.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/102XpFlGrSGbhdJwgr58-bduOm2wfctE-wXyIVlqLkXE/export?format=csv&gid=401418141'

function parseAmount(raw) {
  if (!raw || raw.trim() === '' || raw === '-') return 0
  const clean = raw.replace(/[₹,\s]/g, '').trim()
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

function parseGstRate(raw) {
  if (!raw || raw.trim() === '') return 18
  const n = parseFloat(raw.replace('%', '').trim())
  return isNaN(n) ? 18 : n
}

function parseDate(raw) {
  if (!raw || raw.trim() === '' || raw === '-') return null
  const d = new Date(raw.trim())
  return isNaN(d.getTime()) ? null : d
}

function parseNullableFloat(raw) {
  if (!raw || raw.trim() === '' || raw === '-' || raw.includes('#')) return null
  const n = parseFloat(raw.replace(/[₹%,\s]/g, ''))
  return isNaN(n) ? null : n
}

function parseStr(raw) {
  if (!raw || raw.trim() === '' || raw.trim() === '-' || raw.includes('#REF')) return null
  return raw.trim()
}

function mapEntity(raw) {
  const v = (raw || '').trim()
  if (v === 'Medflix') return 'Medflix'
  if (v === 'Metflix') return 'Metflix'
  return 'PMD'
}

function mapDocType(docTypeCol, invNo) {
  const d = (docTypeCol || '').trim().toLowerCase()
  if (d === 'credit note') return 'CN'
  if (d === 'proforma invoice' || d === 'pi') return 'PI'
  if (d === 'quotation' || d === 'quote') return 'QUOTE'
  const n = (invNo || '').toUpperCase()
  if (n.includes('CN/') || n.startsWith('PMDCN') || n.startsWith('MXCN')) return 'CN'
  if (n.includes('PI/') || n.startsWith('PMDPI') || n.startsWith('MXPI')) return 'PI'
  return 'INV'
}

function mapStatus(raw) {
  const s = (raw || '').trim().toLowerCase()
  if (s === 'recd' || s === 'received') return 'paid'
  if (s === 'credit note') return 'credit_note'
  if (s === 'cancelled' || s === 'returns') return 'cancelled'
  if (s === 'not recd' || s === 'receivables') return 'sent'
  if (s === 'partial') return 'partial'
  if (s === 'sent') return 'sent'
  if (s === 'overdue') return 'overdue'
  // anything else (blank, unknown) = sent/outstanding
  return 'sent'
}

// Proper full-text CSV parser — handles embedded newlines in quoted fields
function parseCSV(text) {
  const rows = []
  let row = [], cur = '', inQuote = false
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

function parseCSVLine(line) {
  const result = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"' && !inQuote) { inQuote = true; continue }
    if (ch === '"' && inQuote && line[i + 1] === '"') { cur += '"'; i++; continue }
    if (ch === '"' && inQuote) { inQuote = false; continue }
    if (ch === ',' && !inQuote) { result.push(cur); cur = ''; continue }
    cur += ch
  }
  result.push(cur)
  return result
}

async function main() {
  console.log('Fetching sheet...')
  const res = await fetch(SHEET_URL, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()

  const allRows = parseCSV(text)
  const rows = allRows.slice(1).filter(r => r.length > 5 && r[8]?.trim())

  console.log(`Found ${rows.length} data rows. Wiping existing invoices...`)
  await prisma.receipt.deleteMany()
  await prisma.invoice.deleteMany()
  console.log('Existing invoices cleared.')

  let imported = 0
  let skipped = 0
  const errors = []

  for (const row of rows) {
    try {
      const dateRaw = parseDate(row[8])
      if (!dateRaw) { skipped++; continue }

      const gross    = parseAmount(row[16])
      const disc     = parseAmount(row[17])
      const gstRate  = parseGstRate(row[18])
      const net      = gross - disc
      const gst      = Math.round(net * gstRate) / 100
      const amt      = net + gst
      const tdsPercent = parseNullableFloat(row[21])
      const tdsAmount  = tdsPercent ? Math.round(net * tdsPercent) / 100 : null
      const status     = mapStatus(row[20])
      const rawReceived = parseAmount(row[23])
      // amt recd = gross * (1 + GST% - TDS%) = amt - tdsAmount
      // If paid and nothing recorded, derive from formula
      const amountReceived = (status === 'paid' && rawReceived === 0)
        ? (tdsPercent ? Math.round((amt - (tdsAmount ?? 0)) * 100) / 100 : amt)
        : rawReceived

      await prisma.invoice.create({
        data: {
          entity:          mapEntity(row[1]),
          docType:         mapDocType(row[2], row[0] || ''),
          invNo:           parseStr(row[0]),
          date:            dateRaw,
          fy:              parseStr(row[9]) || '',
          company:         parseStr(row[3]),
          clientName:      parseStr(row[4]),
          gstId:           parseStr(row[5]),
          state:           parseStr(row[6]),
          creditDays:      parseInt(row[7]) || 45,
          projectCategory: parseStr(row[10]),
          offeringName:    parseStr(row[11]),
          sac:             parseStr(row[12]),
          desc:            parseStr(row[13]),
          currency:        parseStr(row[14]) || 'INR',
          fxRate:          parseNullableFloat(row[15]) ?? 1,
          gross, disc, net, gstRate, gst, amt,
          dueDate:         parseDate(row[19]),
          status,
          tdsPercent,
          tdsAmount,
          comments:        parseStr(row[22]),
          amountReceived:  parseAmount(row[23]),
          gstWithheld:     (row[24] || '').trim().toLowerCase() === 'yes',
        },
      })
      imported++
      if (imported % 100 === 0) console.log(`  ${imported} imported...`)
    } catch (e) {
      skipped++
      if (errors.length < 5) errors.push(`Row ${imported + skipped}: ${e.message}`)
    }
  }

  console.log(`\n✓ Done! ${imported} imported, ${skipped} skipped.`)
  if (errors.length) console.log('Sample errors:', errors)
}

main().catch(console.error).finally(() => prisma.$disconnect())
