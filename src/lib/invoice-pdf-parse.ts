// Deterministic parser for the Tax Invoice PDFs produced by our billing system
// (Zoho Books — PMD / Medflix templates). Input is the raw text layer of the PDF
// (see unpdf extractText); output is a partial invoice draft the user reviews
// before saving. Nothing here writes to the DB.
//
// The parser is tuned to a known layout, so it favours being loud (warnings)
// over being clever: if a number doesn't reconcile, we still return what we read
// and flag it for the human.

export type PdfInvoiceDraft = {
  entity: 'PMD' | 'Medflix'
  docType: 'INV' | 'PI' | 'QUOTE' | 'CN'
  invNo: string | null
  /** buyer PO number, if the invoice prints one */
  po: string | null
  /** referenced proforma-invoice number, if any */
  pi: string | null
  /** yyyy-mm-dd */
  date: string | null
  /** yyyy-mm-dd — the printed due date if the PDF states one, else null */
  dueDate: string | null
  clientName: string | null
  company: string | null
  /** buyer GSTIN */
  gstId: string | null
  /** place-of-supply state, e.g. "Maharashtra" */
  state: string | null
  creditDays: number | null
  sac: string | null
  desc: string | null
  qty: number | null
  unitRevenue: number | null
  currency: string
  /** taxable value that flows into the invoice's Gross field */
  gross: number | null
  gstRate: number | null
  // ---- read straight off the PDF, used for the reconciliation check + display
  printedTaxable: number | null
  printedTax: number | null
  printedTotal: number | null
  sellerGstin: string | null
  irn: string | null
  ackNo: string | null
  /** ISO string of the e-invoice acknowledgement date */
  ackDate: string | null
}

export type PdfInvoiceParseResult = {
  draft: PdfInvoiceDraft
  /** plain-English notes for the reviewer — mismatched totals, missing fields, etc. */
  warnings: string[]
  /** false when the text doesn't look like one of our invoice templates at all */
  recognised: boolean
}

// Seller GSTIN → which of our billing entities issued the invoice.
const SELLER_GSTIN_ENTITY: Record<string, 'PMD' | 'Medflix'> = {
  '24AAHCP8352J1Z4': 'PMD', // Plexus Professionals Network Private Limited
}

const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b/g

function parseIndianNumber(raw: string | null | undefined): number | null {
  if (!raw) return null
  const clean = raw.replace(/[₹,\s]/g, '').trim()
  if (!clean || !/[0-9]/.test(clean)) return null
  const n = Number(clean)
  return Number.isFinite(n) ? n : null
}

/** "01 Sep 2026" / "1 September 2026" / "01-09-2026" / "2026-09-01" → yyyy-mm-dd */
function parseInvoiceDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`

  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`

  const parsed = new Date(s)
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear()
    const mo = String(parsed.getMonth() + 1).padStart(2, '0')
    const d = String(parsed.getDate()).padStart(2, '0')
    return `${y}-${mo}-${d}`
  }
  return null
}

function creditDaysFromTerms(terms: string | null): number | null {
  if (!terms) return null
  const t = terms.toLowerCase()
  if (/due on receipt|payable on receipt|immediate/.test(t)) return 0
  const net = t.match(/net\s*(\d{1,3})/)
  if (net) return Number(net[1])
  const within = t.match(/within\s*(\d{1,3})\s*days/)
  if (within) return Number(within[1])
  const days = t.match(/(\d{1,3})\s*days/)
  if (days) return Number(days[1])
  return null
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re)
  return m ? m[1].trim() : null
}

/**
 * Read a line item whose description wraps across several lines and whose numeric
 * columns (HSN/SAC, Qty, Rate, …) land on their own line — the Medflix / Zoho
 * e-invoice layout, e.g.:
 *
 *   # Description HSN/SAC Qty Rate IGST Amount
 *   1 ECG Summit 2.0 (Episode 3: ECG Lead
 *   Placements: When are the alternate
 *   leads helpful?)
 *   998433 1.00 50,000.00 9,000.00
 *
 * The strict single-line regex can't see this, so we take every line between the
 * table header and the first "SAC-then-number" line as the description and join
 * them with spaces (not "; ").
 */
function parseWrappedLineItem(
  text: string,
): { desc: string; sac: string | null; qty: number | null; rate: number | null } | null {
  const headerRe = /(?:^|\n)[^\n]*\bDescription\b[^\n]*\b(?:HSN\s*\/?\s*SAC|SAC\s*\/?\s*HSN|HSN|SAC)\b[^\n]*(?:\n|$)/i
  const hm = text.match(headerRe)
  if (!hm || hm.index == null) return null

  const rest = text.slice(hm.index + hm[0].length).split('\n')
  // A line that opens the numeric columns: "998433 1.00 50,000.00 …"
  const numRe = /^\s*(\d{4,8})\s+(\d+(?:\.\d+)?)\s+([\d,]+\.\d{2})/
  const stopRe = /^(?:Total|Sub\s*Total|Amount\s*Chargeable|Amount\s*In\s*Words|Total\s*In\s*Words|Place\s*Of\s*Supply|Notes?\b|Terms?\b|Payment\s*Details)/i

  const descParts: string[] = []
  let sac: string | null = null
  let qty: number | null = null
  let rate: number | null = null

  for (const raw of rest) {
    const line = raw.trim()
    if (!line) {
      if (descParts.length) break
      continue
    }
    const nm = line.match(numRe)
    if (nm) {
      sac = nm[1]
      qty = Number.isFinite(Number(nm[2])) ? Number(nm[2]) : null
      rate = parseIndianNumber(nm[3])
      break
    }
    if (stopRe.test(line)) break
    descParts.push(line)
    if (descParts.length > 12) break // runaway guard
  }

  if (!descParts.length) return null
  let desc = descParts.join(' ').replace(/^\s*\d{1,3}\s+/, '').replace(/\s{2,}/g, ' ').trim()
  // SAC / qty / rate sometimes trail the last wrapped description chunk instead of
  // sitting on their own line.
  if (!sac) {
    const inline = desc.match(/^(.*?\S)\s+(\d{4,8})\s+\d+(?:\.\d+)?\s+[\d,]+\.\d{2}\b/)
    if (inline) {
      desc = inline[1].trim()
      sac = inline[2]
    }
  }
  if (desc.length < 2) return null
  return { desc, sac, qty, rate }
}

/**
 * A single PDF can hold many invoices back-to-back (e.g. a month's billing exported as
 * one file). Group the per-page text into one block per invoice: a page that carries the
 * full invoice header (Invoice Number + Invoice Date + Bill To / Place Of Supply) starts a
 * new block; trailing pages (line-item overflow, the IRN / e-invoice page) attach to it.
 */
export function splitInvoicePages(pages: string[]): string[] {
  const norm = pages.map((p) => (p || '').replace(/\r/g, ''))
  const startsInvoice = (t: string) =>
    /invoice\s*(?:number|no\.?|#)/i.test(t) &&
    /invoice\s*date/i.test(t) &&
    /(bill\s*to|place\s*of\s*supply)/i.test(t)

  const segments: string[] = []
  let current: string[] = []
  for (const page of norm) {
    if (startsInvoice(page) && current.length > 0) {
      segments.push(current.join('\n'))
      current = [page]
    } else {
      current.push(page)
    }
  }
  if (current.length) segments.push(current.join('\n'))

  const nonEmpty = segments.filter((s) => s.trim().length >= 20)
  return nonEmpty.length ? nonEmpty : [norm.join('\n')]
}

/** Parse every invoice found in a multi-page PDF's per-page text. */
export function parseInvoicePdfPages(pages: string[]): PdfInvoiceParseResult[] {
  return splitInvoicePages(pages).map((seg) => parseInvoicePdfText(seg))
}

export function parseInvoicePdfText(rawText: string): PdfInvoiceParseResult {
  // Normalise whitespace but keep line breaks — the layout is line-oriented.
  const text = rawText.replace(/\r/g, '').replace(/[ \t]+/g, ' ')
  const warnings: string[] = []

  // ---- identity -----------------------------------------------------------
  const invNo = firstMatch(text, /Invoice\s*(?:Number|No\.?|#)\s*[:#-]?\s*([A-Za-z0-9/\\_.-]+)/i)
  // Buyer PO ("PO Number : 6600086022", "P.O. No: ...") and any referenced proforma.
  const po = firstMatch(text, /\bP\.?\s*O\.?\s*(?:Number|No\.?|#)?\s*[:.#-]?\s*([A-Za-z0-9][A-Za-z0-9/_-]{2,})/i)
  const pi = firstMatch(text, /\b(?:Proforma|PI)\s*(?:Invoice)?\s*(?:Number|No\.?|Ref\.?|#)?\s*[:.#-]?\s*([A-Za-z0-9][A-Za-z0-9/_-]{2,})/i)
  const DATE_TOKEN = String.raw`\d{1,2}[-/ ][A-Za-z]{3,9}[-/ ]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}`
  const dateRaw = firstMatch(text, new RegExp(String.raw`Invoice\s*Date\s*[:.-]?\s*(${DATE_TOKEN})`, 'i'))
  const date = parseInvoiceDate(dateRaw)

  // Printed due date, if present (Zoho prints "Due Date : 01 Oct 2026"). Falls back to
  // null so the form derives it from credit days.
  const dueRaw = firstMatch(text, new RegExp(String.raw`Due\s*Date\s*[:.-]?\s*(${DATE_TOKEN})`, 'i'))
  let dueDate = parseInvoiceDate(dueRaw)
  if (dueDate && date && dueDate === date) dueDate = null // a due date equal to the invoice date is almost always a mis-read

  const isCreditNote = /\bCredit\s*Note\b/i.test(text) || /\bCN[/-]/i.test(invNo || '')
  const isProforma = /\bProforma\b/i.test(text)
  const isQuote = /\bQuotation\b|\bQuote\b/i.test(text)
  const docType: PdfInvoiceDraft['docType'] = isCreditNote
    ? 'CN'
    : isProforma
    ? 'PI'
    : isQuote
    ? 'QUOTE'
    : 'INV'

  // ---- parties ----------------------------------------------------------
  const allGstins = [...text.matchAll(GSTIN_RE)].map((m) => m[1])

  // buyer GSTIN: the one sitting in the "Bill To" block, just before Place Of Supply
  let gstId =
    firstMatch(text, /Bill\s*To[\s\S]{0,800}?GSTIN\s*[:.]?\s*(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])/i) ||
    firstMatch(text, /GSTIN\s*[:.]?\s*(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])[\s\S]{0,120}?Place\s*Of\s*Supply/i)

  // seller GSTIN: near the PAN/CIN header block, or simply "the other one"
  let sellerGstin =
    firstMatch(text, /GSTIN\s*[:.]?\s*(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])[\s\S]{0,80}?PAN\s*[:.]/i) ||
    allGstins.find((g) => g !== gstId) ||
    null

  if (!gstId && allGstins.length) {
    gstId = allGstins.find((g) => g !== sellerGstin) || null
  }

  // entity: map the seller GSTIN first; else read the seller's name from the
  // block just above the seller GSTIN (the footer's "billing@medflix.app"
  // appears on every invoice, so we can't scan the whole document for "medflix").
  let entity: 'PMD' | 'Medflix' = 'PMD'
  if (sellerGstin && SELLER_GSTIN_ENTITY[sellerGstin]) {
    entity = SELLER_GSTIN_ENTITY[sellerGstin]
  } else {
    const sellerIdx = sellerGstin ? text.indexOf(sellerGstin) : -1
    const sellerBlock = sellerIdx >= 0 ? text.slice(Math.max(0, sellerIdx - 300), sellerIdx) : text.slice(0, 400)
    if (/me[dt]flix/i.test(sellerBlock)) entity = 'Medflix'
    else if (/plexus/i.test(sellerBlock)) entity = 'PMD'
    else warnings.push('Could not confirm which entity issued this invoice — defaulted to PMD. Set the Entity manually.')
  }

  // client name: first line under "Bill To"
  const clientName = firstMatch(text, /Bill\s*To\s*\n\s*([^\n]+)/i)

  // place of supply → state
  const state = firstMatch(text, /Place\s*Of\s*Supply\s*[:.]?\s*([A-Za-z][A-Za-z .()]*?)\s*\(?\d{1,2}\)?\s*(?:\n|$)/i)
    ?.replace(/\s*\(.*$/, '')
    .trim()
    || firstMatch(text, /Place\s*Of\s*Supply\s*[:.]?\s*([A-Za-z][A-Za-z ]+)/i)

  // Default to our standard 45-day terms when the PDF doesn't state any (0 = due on
  // receipt is kept as-is).
  const parsedCreditDays = creditDaysFromTerms(firstMatch(text, /Payment\s*Terms\s*[:.]?\s*([^\n]+)/i))
  const creditDays = parsedCreditDays ?? 45

  // ---- line items -----------------------------------------------------
  // "1 Masterclass Haemophilia 998596 1.00 6,43,000.00 6,43,000.00"
  const lineRe =
    /^\s*(\d{1,3})\s+(.+?)\s+(\d{4,8})\s+(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)\s*$/gm
  const items: { desc: string; sac: string; qty: number; rate: number; amount: number }[] = []
  for (const m of text.matchAll(lineRe)) {
    items.push({
      desc: m[2].trim(),
      sac: m[3],
      qty: Number(m[4]),
      rate: parseIndianNumber(m[5]) ?? 0,
      amount: parseIndianNumber(m[6]) ?? 0,
    })
  }

  let sac: string | null = null
  let desc: string | null = null
  let qty: number | null = null
  let unitRevenue: number | null = null
  let lineTotal: number | null = null

  if (items.length === 1) {
    const it = items[0]
    sac = it.sac
    desc = it.desc
    qty = Number.isFinite(it.qty) ? it.qty : null
    unitRevenue = it.rate || null
    lineTotal = it.amount
  } else if (items.length > 1) {
    sac = items[0].sac
    desc = items.map((i) => i.desc).join('; ')
    qty = null
    unitRevenue = null
    lineTotal = items.reduce((s, i) => s + i.amount, 0)
    warnings.push(
      `${items.length} line items found — descriptions were combined and Gross is their sum; Quantity/Unit Revenue left blank.`,
    )
  }

  // Wrapped layout (Medflix / Zoho e-invoice): description over several lines, the
  // numeric columns on their own line. Try this before the generic text scrub.
  if (!desc) {
    const wrapped = parseWrappedLineItem(text)
    if (wrapped) {
      desc = wrapped.desc
      if (!sac && wrapped.sac) sac = wrapped.sac
      if (qty == null && wrapped.qty != null) qty = wrapped.qty
      if (unitRevenue == null && wrapped.rate != null) unitRevenue = wrapped.rate
      if (lineTotal == null && wrapped.qty != null && wrapped.rate != null) {
        lineTotal = wrapped.qty * wrapped.rate
      }
    }
  }

  // Fallback: the strict line-item regex didn't match (columns wrapped, odd SAC, etc.).
  // Grab the free text between the item-table header and the totals block, scrub the
  // column noise (SAC codes, money, "Qty"/"Rate"/"Amount"/"HSN/SAC" headers) and join
  // the wrapped lines with spaces so the description reads as one phrase.
  if (!desc) {
    const block = text.match(
      /(?:Item\s*&?\s*Description|Description|Particulars)\b([\s\S]*?)(?:Sub\s*Total|Total\s*Taxable|Taxable\s*(?:Amount|Value)|Total\s*In\s*Words|Amount\s*Chargeable|Total\s*Amount|Payment\s*Details)/i,
    )
    if (block) {
      const cleaned = block[1]
        .replace(/\bHSN\s*\/?\s*SAC\b|\bSAC\s*\/?\s*HSN\b/gi, ' ')
        .replace(/\b(?:SAC|HSN|Qty|Quantity|Rate|Amount|Discount|CGST|SGST|IGST|UTGST|Taxable(?:\s*Value)?)\b/gi, ' ')
        .replace(/\b\d{4,8}\b/g, ' ')            // SAC / HSN codes
        .replace(/[₹]?\s*[\d,]+\.\d{2}\b/g, ' ') // money
        .replace(/\b\d{1,2}(?:\.\d+)?\s*%/g, ' ') // "18%"
        .replace(/^\s*\d{1,3}[.)]?\s+/gm, '')    // leading serial numbers ("1 " / "1. ")
        .split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
        .replace(/\s*[/|]\s*/g, ' ')             // stray column separators
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s;/|,-]+|[\s;/|,-]+$/g, '')
        .trim()
      if (cleaned.length >= 3) {
        desc = cleaned
        warnings.push('Description was recovered from the item block — check it reads right.')
      }
    }
  }

  // Zoho line items are sometimes authored as `Client: "Acme" - <real description>` —
  // strip that lead-in so the form shows the actual particulars.
  if (desc) {
    const stripped = desc
      .replace(/^\s*client\s*[:\-]\s*(?:"[^"]*"|'[^']*'|[^-–—;:\n]+?)\s*(?:[-–—;:]\s*|(?=\n))/i, '')
      .trim()
    if (stripped && stripped.length >= 3) desc = stripped
  }

  // ---- printed totals -------------------------------------------------
  const printedTaxable = parseIndianNumber(
    firstMatch(text, /Total\s*Taxable\s*(?:Amount|Value)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
      firstMatch(text, /Sub\s*Total\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i),
  )

  // A GST line looks like "IGST18 (18%) 1,15,740.00" or "CGST9 (9%) 27,000.00"
  // or "IGST (18%) 1,15,740.00" — tolerate the leading rate, the parenthesised
  // rate, or either alone.
  function taxLine(label: string): { rate: number | null; amount: number } | null {
    const re = new RegExp(
      label +
        String.raw`\s*(\d{1,2}(?:\.\d+)?)?\s*(?:\(\s*(\d{1,2}(?:\.\d+)?)\s*%\s*\))?\s*[:=-]?\s*([\d,]+\.\d{2})`,
      'i',
    )
    const m = text.match(re)
    if (!m) return null
    const rateStr = m[2] ?? m[1]
    const amount = parseIndianNumber(m[3])
    if (amount == null) return null
    return { rate: rateStr != null ? Number(rateStr) : null, amount }
  }

  // IGST (inter-state) or CGST + SGST/UTGST (intra-state)
  let gstRate: number | null = null
  let printedTax: number | null = null
  const igst = taxLine(String.raw`\bIGST`)
  if (igst) {
    gstRate = igst.rate
    printedTax = igst.amount
  } else {
    const cgst = taxLine(String.raw`\bCGST`)
    const sgst = taxLine(String.raw`\b(?:S|UT)GST`)
    if (cgst && sgst) {
      gstRate = cgst.rate != null && sgst.rate != null ? cgst.rate + sgst.rate : null
      printedTax = cgst.amount + sgst.amount
    }
  }

  const printedTotal = parseIndianNumber(
    firstMatch(text, /Total\s*(?:Rs\.?|INR|₹|Amount)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
      firstMatch(text, /(?:Grand\s*Total|Invoice\s*Total|Balance\s*Due)\s*:?\s*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i),
  )

  // Gross that flows into the form = taxable value.
  const gross = printedTaxable ?? lineTotal ?? null

  // rate fallback from the numbers themselves
  if (gstRate == null && gross && printedTax) {
    gstRate = Math.round((printedTax / gross) * 100)
  }
  // Still nothing? Fall back to our standard 18% (editable on the form).
  if (gstRate == null) {
    gstRate = 18
    warnings.push('GST rate not found — defaulted to 18%. Change it on the form if the invoice differs.')
  }

  // e-invoice extras (page 2)
  const irn = firstMatch(text, /IRN\s*[:.]?\s*([0-9a-f]{32,64})/i)
  const ackNo = firstMatch(text, /Ack\s*No\.?\s*[:.]?\s*(\d{6,})/i)
  const ackDateRaw = firstMatch(
    text,
    /Ack\s*Date\s*[:.]?\s*(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?|\d{1,2}[-/][A-Za-z]{3,9}[-/]\d{4})/i,
  )
  let ackDate: string | null = null
  if (ackDateRaw) {
    const d = new Date(ackDateRaw.replace(' ', 'T'))
    ackDate = Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  // ---- reconciliation ----------------------------------------------
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.005)

  if (gross != null && lineTotal != null && printedTaxable != null && !near(lineTotal, printedTaxable)) {
    warnings.push(
      `Line-item total (₹${lineTotal.toLocaleString('en-IN')}) doesn't match the printed taxable amount (₹${printedTaxable.toLocaleString('en-IN')}).`,
    )
  }
  if (gross != null && gstRate != null && printedTax != null) {
    const computed = gross * (gstRate / 100)
    if (!near(computed, printedTax)) {
      warnings.push(
        `GST on the form (${gstRate}% of ₹${gross.toLocaleString('en-IN')} = ₹${computed.toLocaleString('en-IN', { maximumFractionDigits: 0 })}) doesn't match the printed tax (₹${printedTax.toLocaleString('en-IN')}). Check the GST rate.`,
      )
    }
  }
  if (gross != null && printedTax != null && printedTotal != null) {
    const computed = gross + printedTax
    if (!near(computed, printedTotal)) {
      warnings.push(
        `Taxable + tax (₹${computed.toLocaleString('en-IN')}) doesn't match the printed invoice total (₹${printedTotal.toLocaleString('en-IN')}).`,
      )
    }
  }

  if (!invNo) warnings.push('Invoice number not found — enter it manually.')
  if (!date) warnings.push('Invoice date not found — set it manually.')
  if (gross == null) warnings.push('Could not read an amount — enter Gross manually.')
  if (!gstId) warnings.push('Client GSTIN not found.')
  if (!desc) warnings.push('Description / particulars not found — add it manually.')

  const recognised = Boolean(invNo || printedTotal != null || items.length > 0)
  if (!recognised) {
    warnings.unshift('This file does not look like one of our invoice templates — review every field before saving.')
  }

  return {
    draft: {
      entity,
      docType,
      invNo,
      po: po || null,
      pi: pi || null,
      date,
      dueDate,
      clientName,
      company: clientName,
      gstId,
      state: state || null,
      creditDays,
      sac,
      desc,
      qty,
      unitRevenue,
      currency: 'INR',
      gross,
      gstRate,
      printedTaxable,
      printedTax,
      printedTotal,
      sellerGstin,
      irn,
      ackNo,
      ackDate,
    },
    warnings,
    recognised,
  }
}
