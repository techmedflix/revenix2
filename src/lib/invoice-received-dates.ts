import { prisma } from '@/lib/prisma'

export type ReceivedDateRow = { invNo: string; receivedDate: Date }

/**
 * Parse a date cell from an uploaded sheet. Accepts:
 *  - ISO  "yyyy-mm-dd" (optionally with a time part)
 *  - day-first "dd/mm/yyyy", "dd-mm-yyyy", "dd.mm.yyyy" (2- or 4-digit year)
 *  - Excel serial numbers (e.g. "45678")
 * Returns null when nothing sensible can be read.
 */
export function parseFlexibleDate(raw: string): Date | null {
  const s = (raw || '').trim()
  if (!s) return null

  // Excel serial date (days since 1899-12-30)
  if (/^\d{4,6}$/.test(s)) {
    const serial = parseInt(s, 10)
    const d = new Date((serial - 25569) * 86400 * 1000)
    return isNaN(d.getTime()) ? null : d
  }

  // ISO yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    return isNaN(d.getTime()) ? null : d
  }

  // Day-first dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/)
  if (m) {
    const dd = +m[1]
    const mm = +m[2]
    let year = +m[3]
    if (year < 100) year += 2000
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null
    const d = new Date(Date.UTC(year, mm - 1, dd))
    // Reject impossible calendar dates (e.g. 31/02) instead of letting them roll over.
    if (isNaN(d.getTime()) || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null
    return d
  }

  const fallback = new Date(s)
  return isNaN(fallback.getTime()) ? null : fallback
}

/**
 * Read (Invoice Number, Received Date) pairs from a sheet given as an array of
 * rows (row 0 = header). Columns are matched by header name, falling back to
 * column A = invoice number and column B = received date.
 */
export function parseReceivedDateSheet(rows: string[][]): { parsed: ReceivedDateRow[]; errors: string[] } {
  const errors: string[] = []
  const parsed: ReceivedDateRow[] = []
  if (rows.length < 2) return { parsed, errors: ['Sheet has no data rows'] }

  const header = rows[0].map((h) => (h ?? '').toString().trim().toLowerCase())
  let invIdx = header.findIndex((h) => /^inv(oice)?\s*(number|no\.?|#)?$/.test(h) || h === 'inv #')
  let dateIdx = header.findIndex((h) => /(received|receipt|payment|recd)\s*date/.test(h))
  if (invIdx === -1) invIdx = 0
  if (dateIdx === -1) dateIdx = 1

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || []
    const invNo = (row[invIdx] ?? '').toString().trim()
    const dateRaw = (row[dateIdx] ?? '').toString().trim()
    if (!invNo && !dateRaw) continue
    if (!invNo) { errors.push(`Row ${i + 1}: missing invoice number`); continue }
    if (!dateRaw) { errors.push(`Row ${i + 1} (${invNo}): missing received date`); continue }
    const d = parseFlexibleDate(dateRaw)
    if (!d) { errors.push(`Row ${i + 1} (${invNo}): couldn't read the date "${dateRaw}"`); continue }
    parsed.push({ invNo, receivedDate: d })
  }
  return { parsed, errors }
}

/**
 * Correct the received date on invoices already marked Received. Invoices that
 * aren't received yet (or aren't found) are left untouched and reported. Any
 * receipt entries on a touched invoice have their dates shifted to match; their
 * amounts, TDS and the invoice status are not changed.
 */
export async function applyReceivedDates(
  rows: ReceivedDateRow[],
): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const errors: string[] = []
  let updated = 0
  let skipped = 0

  for (const { invNo, receivedDate } of rows) {
    const matches = await prisma.invoice.findMany({ where: { invNo } })
    if (matches.length === 0) {
      skipped++
      errors.push(`${invNo}: not found`)
      continue
    }
    for (const inv of matches) {
      if (inv.status !== 'paid') {
        skipped++
        errors.push(`${invNo}: not marked Received (currently ${inv.status})`)
        continue
      }
      await prisma.invoice.update({ where: { id: inv.id }, data: { receivedDate } })
      await prisma.receipt.updateMany({ where: { invoiceId: inv.id }, data: { receivedDate } })
      updated++
    }
  }
  return { updated, skipped, errors }
}
