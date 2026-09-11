export const preferredRegion = 'sin1'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getAuthorizedUser } from '@/lib/rbac'
import { parseInvoicePdfPages, type PdfInvoiceParseResult } from '@/lib/invoice-pdf-parse'

const MAX_FILES = 25
const MAX_BYTES = 12 * 1024 * 1024 // 12 MB per file
const MAX_INVOICES_PER_FILE = 40

type FileResult =
  | ({ filename: string; ok: true } & PdfInvoiceParseResult)
  | { filename: string; ok: false; error: string }

export async function POST(req: Request) {
  const auth = await getAuthorizedUser(['admin', 'leadership', 'partnerships'])
  if ('error' in auth) return auth.error

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload' }, { status: 400 })
  }

  const files = [...form.getAll('files'), ...form.getAll('file')].filter(
    (f): f is File => f instanceof File,
  )
  if (files.length === 0) {
    return NextResponse.json({ error: 'No PDF files provided' }, { status: 400 })
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Too many files — upload at most ${MAX_FILES} at a time` },
      { status: 400 },
    )
  }

  // unpdf bundles a serverless build of pdf.js — safe to import in a route handler.
  const { extractText, getDocumentProxy } = await import('unpdf')

  const results: FileResult[] = []
  for (const file of files) {
    const filename = file.name || 'invoice.pdf'
    try {
      const isPdf =
        file.type === 'application/pdf' || /\.pdf$/i.test(filename)
      if (!isPdf) {
        results.push({ filename, ok: false, error: 'Not a PDF file' })
        continue
      }
      if (file.size > MAX_BYTES) {
        results.push({ filename, ok: false, error: 'File is larger than 12 MB' })
        continue
      }

      const bytes = new Uint8Array(await file.arrayBuffer())
      const pdf = await getDocumentProxy(bytes)
      // Per-page text so we can split a file that holds several invoices back-to-back.
      const { text } = await extractText(pdf, { mergePages: false })
      const pages: string[] = Array.isArray(text) ? text : [String(text || '')]

      if (pages.join('').trim().length < 20) {
        results.push({
          filename,
          ok: false,
          error: 'No readable text in this PDF (it may be a scan or an image).',
        })
        continue
      }

      const parsedList = parseInvoicePdfPages(pages).slice(0, MAX_INVOICES_PER_FILE)
      const total = parsedList.length
      parsedList.forEach((parsed, idx) => {
        results.push({
          filename: total > 1 ? `${filename} · #${idx + 1} of ${total}` : filename,
          ok: true,
          ...parsed,
        })
      })
    } catch (e) {
      results.push({
        filename,
        ok: false,
        error: e instanceof Error ? e.message : 'Could not read this PDF',
      })
    }
  }

  return NextResponse.json({ results })
}
