/**
 * One-time import script for MedOS Invoicing Data_Historical.xlsx (first sheet)
 *
 * Column layout (0-indexed, no Credit Days column):
 *  0  Invoice #
 *  1  Entity (PMD / Mx → Medflix)
 *  2  Doc Type (Regular → INV)
 *  3  Client (display name → clientName)
 *  4  Registered Entity (official company → company)
 *  5  GST ID
 *  6  State
 *  7  Date
 *  8  FY
 *  9  Project Category
 * 10  Project Type
 * 11  SAC Code
 * 12  Description
 * 13  Currency
 * 14  FX Rate
 * 15  Gross Amount (INR)
 * 16  Discount
 * 17  GST Rate (%)
 * 18  Due Date
 * 19  Status
 * 20  TDS %
 * 21  Comments
 * 22  Amount Received
 * 23  GST Withheld (Yes/No)
 *
 * Run: npx ts-node --project tsconfig.json -e "$(cat scripts/import-historical-invoices.ts)"
 * Or:  npx tsx scripts/import-historical-invoices.ts
 */

import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
import * as path from 'path'

const prisma = new PrismaClient()

const FILE_PATH = path.resolve('/Users/chirag/Downloads/MedOS Invoicing Data_Historical.xlsx')
const SHEET_INDEX = 0   // "Invoice Template" = first sheet

// ── helpers ────────────────────────────────────────────────────────────────

function s(v: unknown): string { return v == null ? '' : String(v).trim() }

function parseAmount(raw: string): number {
  if (!raw || raw === '-') return 0
  const n = parseFloat(raw.replace(/[₹,\s]/g, ''))
  return isNaN(n) ? 0 : n
}

function parseGstRate(raw: string): number {
  if (!raw) return 18
  const n = parseFloat(raw.replace('%', ''))
  return isNaN(n) ? 18 : n
}

function parseDate(raw: string): Date | null {
  if (!raw || raw === '-') return null
  const d = new Date(raw.trim())
  return isNaN(d.getTime()) ? null : d
}

function parseNullableFloat(raw: string): number | null {
  if (!raw || raw === '-' || raw.includes('#')) return null
  const n = parseFloat(raw.replace(/[₹,%\s]/g, ''))
  return isNaN(n) ? null : n
}

function mapEntity(raw: string): 'PMD' | 'Medflix' | 'Metflix' {
  const v = raw.toLowerCase()
  if (v === 'mx' || v === 'medflix') return 'Medflix'
  if (v === 'metflix') return 'Metflix'
  return 'PMD'
}

function mapDocType(invNo: string): 'INV' | 'PI' | 'QUOTE' | 'CN' {
  const n = (invNo || '').toUpperCase()
  if (n.includes('CN/') || n.startsWith('PMDCN') || n.startsWith('MXCN')) return 'CN'
  if (n.includes('PI/') || n.startsWith('PMDPI') || n.startsWith('MXPI')) return 'PI'
  return 'INV'
}

function mapStatus(raw: string): 'draft' | 'sent' | 'overdue' | 'partial' | 'paid' | 'cancelled' | 'credit_note' {
  const v = raw.toLowerCase()
  if (v === 'received' || v === 'recd') return 'paid'
  if (v === 'receivables' || v === 'not recd') return 'sent'
  if (v === 'partial') return 'partial'
  if (v === 'overdue') return 'overdue'
  if (v === 'cancelled' || v === 'returns') return 'cancelled'
  if (v === 'credit note') return 'credit_note'
  return 'sent'
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Reading:', FILE_PATH)
  const wb = XLSX.readFile(FILE_PATH)
  const sheetName = wb.SheetNames[SHEET_INDEX]
  console.log('Using sheet:', sheetName)

  const ws = wb.Sheets[sheetName]
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, raw: false, dateNF: 'yyyy-mm-dd',
  })

  const dataRows = rawRows.slice(1).filter(r => s(r[0]) || s(r[7]))
  console.log(`Found ${dataRows.length} data rows`)

  // Load existing invNos to deduplicate
  const existing = await prisma.invoice.findMany({
    select: { invNo: true, entity: true },
    where: { invNo: { not: null } },
  })
  const existingKeys = new Set(existing.map(r => `${r.entity}::${r.invNo}`))
  console.log(`${existingKeys.size} invoices already in DB`)

  let imported = 0, skipped = 0, errored = 0
  const errors: string[] = []

  for (const row of dataRows) {
    const invNo    = s(row[0]) || null
    const entity   = mapEntity(s(row[1]))
    const docType  = mapDocType(invNo || '')
    const clientName = s(row[3]) || null
    const company  = s(row[4]) || null
    const gstId    = s(row[5]) || null
    const state    = s(row[6]) || null
    const dateRaw  = parseDate(s(row[7]))
    if (!dateRaw) { skipped++; continue }

    const fy       = s(row[8]) || ''
    const projectCategory = s(row[9]) || null
    const offeringName    = s(row[10]) || null
    const sac      = s(row[11]) || null
    const desc     = s(row[12]) || null
    const currency = s(row[13]) || 'INR'
    const fxRate   = parseNullableFloat(s(row[14])) ?? 1
    const gross    = parseAmount(s(row[15]))
    const disc     = parseAmount(s(row[16]))
    const gstRate  = parseGstRate(s(row[17]))
    const dueDate  = parseDate(s(row[18]))
    const status   = mapStatus(s(row[19]))
    const tdsPercent = parseNullableFloat(s(row[20]))
    const comments = s(row[21]) || null
    const rawReceived = parseAmount(s(row[22]))
    const gstWithheld = s(row[23]).toLowerCase() === 'yes'

    const net = gross - disc
    const gst = Math.round(net * gstRate) / 100
    const amt = net + gst
    const tdsAmount = tdsPercent ? Math.round(net * tdsPercent) / 100 : null
    const amountReceived = (status === 'paid' && rawReceived === 0)
      ? (tdsPercent ? Math.round(gross * (1 - tdsPercent / 100) * 100) / 100 : amt)
      : rawReceived

    // Skip duplicates
    const key = invNo ? `${entity}::${invNo}` : null
    if (key && existingKeys.has(key)) { skipped++; continue }

    try {
      await prisma.invoice.create({
        data: {
          entity, docType, invNo,
          date: dateRaw,
          fy,
          clientName, company, gstId, state,
          creditDays: 45,
          projectCategory, offeringName, sac, desc,
          currency, fxRate,
          gross, disc, net, gstRate, gst, amt,
          dueDate, status,
          tdsPercent, tdsAmount,
          comments, amountReceived, gstWithheld,
        },
      })
      if (key) existingKeys.add(key)
      imported++
    } catch (e) {
      errored++
      const msg = `Row ${invNo}: ${String(e).slice(0, 120)}`
      errors.push(msg)
      if (errors.length <= 5) console.error(msg)
    }
  }

  console.log(`\nDone — imported: ${imported}, skipped: ${skipped}, errors: ${errored}`)
  if (errors.length > 0) {
    console.log('First errors:', errors.slice(0, 5))
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
