import { prisma } from '@/lib/prisma'

// ── helpers ────────────────────────────────────────────────────────────────

function parseAmount(raw: string): number {
  if (!raw || raw.trim() === '' || raw === '-') return 0
  const clean = raw.replace(/[₹,\s]/g, '').trim()
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

function parseGstRate(raw: string): number {
  if (!raw || raw.trim() === '') return 18
  const clean = raw.replace('%', '').trim()
  const n = parseFloat(clean)
  return isNaN(n) ? 18 : n
}

function parseDate(raw: string): Date | null {
  if (!raw || raw.trim() === '' || raw === '-') return null
  const d = new Date(raw.trim())
  return isNaN(d.getTime()) ? null : d
}

function parseNullableFloat(raw: string): number | null {
  if (!raw || raw.trim() === '' || raw === '-' || raw.includes('#REF') || raw.includes('#')) return null
  const n = parseFloat(raw.replace(/[₹,%,\s]/g, ''))
  return isNaN(n) ? null : n
}

function parseStr(raw: string): string | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-' || raw.includes('#REF')) return null
  return raw.trim()
}

function mapEntity(raw: string): 'PMD' | 'Medflix' | 'Metflix' {
  const v = raw.trim()
  if (v === 'Medflix') return 'Medflix'
  if (v === 'Metflix') return 'Metflix'
  return 'PMD'
}

function mapDocType(docTypeCol: string, invNo: string): 'INV' | 'PI' | 'QUOTE' | 'CN' {
  const d = (docTypeCol || '').trim().toLowerCase()
  if (d === 'credit note') return 'CN'
  if (d === 'proforma invoice' || d === 'pi') return 'PI'
  if (d === 'quotation' || d === 'quote') return 'QUOTE'
  const n = (invNo || '').toUpperCase()
  if (n.includes('CN/') || n.startsWith('PMDCN') || n.startsWith('MXCN')) return 'CN'
  if (n.includes('PI/') || n.startsWith('PMDPI') || n.startsWith('MXPI')) return 'PI'
  return 'INV'
}

function mapStatus(raw: string): 'draft' | 'sent' | 'overdue' | 'partial' | 'paid' | 'cancelled' | 'credit_note' {
  const s = (raw || '').trim().toLowerCase()
  if (s === 'recd' || s === 'received') return 'paid'
  if (s === 'credit note') return 'credit_note'
  if (s === 'cancelled' || s === 'returns') return 'cancelled'
  if (s === 'not recd' || s === 'receivables') return 'sent'
  if (s === 'partial') return 'partial'
  if (s === 'sent') return 'sent'
  if (s === 'overdue') return 'overdue'
  return 'sent'
}

export type ParsedInvoiceRow = {
  invNo: string | null
  entity: 'PMD' | 'Medflix' | 'Metflix'
  docType: 'INV' | 'PI' | 'QUOTE' | 'CN'
  company: string | null
  clientName: string | null
  gstId: string | null
  state: string | null
  creditDays: number
  date: Date
  fy: string
  projectCategory: string | null
  offeringName: string | null
  sac: string | null
  desc: string | null
  currency: string
  fxRate: number
  gross: number
  disc: number
  gstRate: number
  dueDate: Date | null
  status: 'draft' | 'sent' | 'overdue' | 'partial' | 'paid' | 'cancelled' | 'credit_note'
  tdsPercent: number | null
  tdsAmount: number | null
  comments: string | null
  amountReceived: number
  gstWithheld: boolean
}

/** Parse one CSV row (array of strings) into a typed row or null if invalid */
export function parseInvoiceCSVRow(row: string[]): ParsedInvoiceRow | null {
  const invNo     = parseStr(row[0])
  const entity    = mapEntity(row[1] || '')
  const docType   = mapDocType(row[2] || '', row[0] || '')
  const company   = parseStr(row[3])
  const clientName = parseStr(row[4])
  const gstId     = parseStr(row[5])
  const state     = parseStr(row[6])
  const creditDays = parseInt(row[7]) || 45
  const dateRaw   = parseDate(row[8])
  if (!dateRaw) return null
  const fy        = parseStr(row[9]) || ''
  const projectCategory = parseStr(row[10])
  const offeringName    = parseStr(row[11])
  const sac       = parseStr(row[12])
  const desc      = parseStr(row[13])
  const currency  = parseStr(row[14]) || 'INR'
  const fxRate    = parseNullableFloat(row[15]) ?? 1
  const gross     = parseAmount(row[16])
  const disc      = parseAmount(row[17])
  const gstRate   = parseGstRate(row[18])
  const dueDate   = parseDate(row[19])
  const status    = mapStatus(row[20])
  const net       = gross - disc
  const gst       = Math.round(net * gstRate) / 100
  const amt       = net + gst
  const tdsPercent = parseNullableFloat(row[21])
  const tdsAmount  = tdsPercent ? Math.round(net * tdsPercent) / 100 : null
  const comments   = parseStr(row[22])
  const rawReceived = parseAmount(row[23])
  const amountReceived = (status === 'paid' && rawReceived === 0)
    ? (tdsPercent ? Math.round(gross * (1 - tdsPercent / 100) * 100) / 100 : amt)
    : rawReceived
  const gstWithheld = (row[24] || '').trim().toLowerCase() === 'yes'

  return {
    invNo, entity, docType, company, clientName, gstId, state, creditDays,
    date: dateRaw, fy, projectCategory, offeringName, sac, desc, currency, fxRate,
    gross, disc, gstRate, dueDate, status, tdsPercent, tdsAmount, comments,
    amountReceived, gstWithheld,
  }
}

/** Insert parsed rows, skipping any whose invNo+entity already exists in DB */
export async function insertInvoiceRows(rows: ParsedInvoiceRow[]): Promise<{
  imported: number; skipped: number; errors: string[]
}> {
  const existing = await prisma.invoice.findMany({
    select: { invNo: true, entity: true },
    where: { invNo: { not: null } },
  })
  const existingKeys = new Set(existing.map(r => `${r.entity}::${r.invNo}`))

  let imported = 0, skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    try {
      const key = row.invNo ? `${row.entity}::${row.invNo}` : null
      if (key && existingKeys.has(key)) { skipped++; continue }

      const net = row.gross - row.disc
      const gst = Math.round(net * row.gstRate) / 100
      const amt = net + gst

      await prisma.invoice.create({
        data: {
          entity: row.entity,
          docType: row.docType,
          invNo: row.invNo,
          date: row.date,
          fy: row.fy,
          company: row.company,
          clientName: row.clientName,
          gstId: row.gstId,
          state: row.state,
          creditDays: row.creditDays,
          projectCategory: row.projectCategory,
          offeringName: row.offeringName,
          sac: row.sac,
          desc: row.desc,
          currency: row.currency,
          fxRate: row.fxRate,
          gross: row.gross,
          disc: row.disc,
          net,
          gstRate: row.gstRate,
          gst,
          amt,
          dueDate: row.dueDate,
          status: row.status,
          tdsPercent: row.tdsPercent,
          tdsAmount: row.tdsAmount,
          comments: row.comments,
          amountReceived: row.amountReceived,
          gstWithheld: row.gstWithheld,
        },
      })
      if (key) existingKeys.add(key)
      imported++
    } catch (e) {
      skipped++
      if (errors.length < 10) errors.push(String(e))
    }
  }

  return { imported, skipped, errors }
}
