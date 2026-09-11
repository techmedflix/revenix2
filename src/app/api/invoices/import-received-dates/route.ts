export const preferredRegion = 'sin1'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readUploadedSheet } from '@/lib/sheet-upload'
import { parseReceivedDateSheet, applyReceivedDates } from '@/lib/invoice-received-dates'

// Bulk-correct the received date on already-received invoices from an uploaded
// Excel/CSV file or a published Google Sheet. Expected columns: Invoice Number,
// Received Date. Invoices that aren't marked Received are reported, not changed.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sheet = await readUploadedSheet(req)
    if ('error' in sheet) return NextResponse.json({ error: sheet.error }, { status: sheet.status })

    const { parsed, errors: parseErrors } = parseReceivedDateSheet(sheet.rows)
    const { updated, skipped, errors } = await applyReceivedDates(parsed)

    return NextResponse.json({
      imported: updated,
      skipped,
      errors: [...parseErrors, ...errors].slice(0, 100),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
