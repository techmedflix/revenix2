export const preferredRegion = 'sin1'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readUploadedSheet } from '@/lib/sheet-upload'
import { parseBulkFieldSheet, applyBulkFields } from '@/lib/invoice-bulk-fields'

// Bulk-set invoice fields (SAC/HSN, Client GSTIN, IRN, Project Category, Project
// Type, Registered Name) from an uploaded Excel/CSV or a published Google Sheet,
// matched by Invoice Number. Only columns present in the sheet are touched; a
// blank cell in a present column clears that field.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sheet = await readUploadedSheet(req)
    if ('error' in sheet) return NextResponse.json({ error: sheet.error }, { status: sheet.status })

    const { updates, columns, errors: parseErrors } = parseBulkFieldSheet(sheet.rows)
    if (updates.length === 0 && parseErrors.length) {
      return NextResponse.json({ error: parseErrors[0] }, { status: 400 })
    }

    const { updated, skipped, errors } = await applyBulkFields(updates)
    return NextResponse.json({
      imported: updated,
      skipped,
      errors: [
        columns.length ? `Columns updated: ${columns.join(', ')}` : '',
        ...parseErrors,
        ...errors,
      ].filter(Boolean).slice(0, 100),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
