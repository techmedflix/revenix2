import * as XLSX from 'xlsx'

/**
 * Read an uploaded sheet from a POST request — either a JSON body `{ url }`
 * pointing at a published Google Sheet (CSV export), or multipart form-data with
 * a `file` field (xlsx/xls/csv). Returns the first sheet as an array of rows.
 */
export async function readUploadedSheet(
  req: Request,
): Promise<{ rows: string[][] } | { error: string; status: number }> {
  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const { url } = await req.json().catch(() => ({}))
    if (!url || typeof url !== 'string') return { error: 'No sheet URL provided', status: 400 }
    let resp: Response
    try {
      resp = await fetch(url)
    } catch {
      return { error: 'Could not reach that sheet URL', status: 400 }
    }
    if (!resp.ok) return { error: `Could not fetch the sheet (HTTP ${resp.status})`, status: 400 }
    const csv = await resp.text()
    const wb = XLSX.read(csv, { type: 'string', raw: false })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) return { error: 'The sheet is empty', status: 400 }
    return { rows: XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' }) }
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided', status: 400 }
  const buffer = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return { error: 'Empty workbook', status: 400 }
  return { rows: XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' }) }
}
