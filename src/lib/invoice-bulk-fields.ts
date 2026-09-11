import { prisma } from '@/lib/prisma'

// Invoice fields that can be bulk-set from a sheet, keyed by the invoice column
// name. Each entry lists the header spellings that map to it.
const FIELD_HEADERS: { field: 'sac' | 'gstId' | 'irn' | 'projectCategory' | 'offeringName' | 'company'; match: RegExp; max: number }[] = [
  { field: 'sac', match: /^(sac|hsn)(\s*[/&]\s*(hsn|sac))?(\s*code)?$/i, max: 40 },
  { field: 'gstId', match: /^(client\s*)?gst(in|\s*id|\s*no\.?)?$/i, max: 20 },
  { field: 'irn', match: /^irn(\s*(number|no\.?))?$/i, max: 80 },
  { field: 'projectCategory', match: /^(project\s*)?category$/i, max: 120 },
  { field: 'offeringName', match: /^(project\s*type|offering(\s*name)?|type)$/i, max: 200 },
  { field: 'company', match: /^(registered\s*name(\s*of\s*client)?|legal\s*name|company(\s*name)?)$/i, max: 200 },
]

const INV_HEADER = /^inv(oice)?\s*(number|no\.?|#)?$/i

export type BulkFieldUpdate = { invNo: string; fields: Record<string, string | null> }

/**
 * Read (Invoice Number, …fields) from a sheet given as rows (row 0 = header).
 * Only columns whose header is recognised are touched. A blank cell in a
 * recognised column clears that field ("per-column header flag" semantics).
 */
export function parseBulkFieldSheet(rows: string[][]): {
  updates: BulkFieldUpdate[]
  columns: string[]
  errors: string[]
} {
  const errors: string[] = []
  if (rows.length < 2) return { updates: [], columns: [], errors: ['Sheet has no data rows'] }

  const header = rows[0].map((h) => (h ?? '').toString().trim())
  const invIdx = header.findIndex((h) => INV_HEADER.test(h) || h.toLowerCase() === 'inv #')
  if (invIdx === -1) {
    return { updates: [], columns: [], errors: ['No "Invoice Number" column found in the sheet header'] }
  }

  // Map each recognised data column to an invoice field.
  const colMap: { idx: number; field: string; max: number }[] = []
  header.forEach((h, idx) => {
    if (idx === invIdx || !h) return
    const hit = FIELD_HEADERS.find((f) => f.match.test(h))
    if (hit) colMap.push({ idx, field: hit.field, max: hit.max })
  })
  const columns = colMap.map((c) => c.field)
  if (colMap.length === 0) {
    return { updates: [], columns, errors: ['None of the columns matched a bulk-updatable field (SAC/HSN, Client GSTIN, IRN, Project Category, Project Type, Registered Name)'] }
  }

  const updates: BulkFieldUpdate[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || []
    const invNo = (row[invIdx] ?? '').toString().trim()
    if (!invNo) {
      if (row.some((c) => (c ?? '').toString().trim())) errors.push(`Row ${i + 1}: missing invoice number`)
      continue
    }
    const fields: Record<string, string | null> = {}
    for (const c of colMap) {
      const raw = (row[c.idx] ?? '').toString().trim()
      fields[c.field] = raw ? raw.slice(0, c.max) : null
    }
    updates.push({ invNo, fields })
  }
  return { updates, columns, errors }
}

export async function applyBulkFields(
  updates: BulkFieldUpdate[],
): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const errors: string[] = []
  let updated = 0
  let skipped = 0

  for (const { invNo, fields } of updates) {
    const matches = await prisma.invoice.findMany({ where: { invNo }, select: { id: true } })
    if (matches.length === 0) {
      skipped++
      errors.push(`${invNo}: not found`)
      continue
    }
    for (const inv of matches) {
      await prisma.invoice.update({ where: { id: inv.id }, data: fields })
      updated++
    }
  }
  return { updated, skipped, errors }
}
