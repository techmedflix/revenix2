export function addBusinessDays(date: Date, days: number): Date {
  let count = 0
  const result = new Date(date)
  while (count < days) {
    result.setDate(result.getDate() + 1)
    const day = result.getDay()
    if (day !== 0 && day !== 6) count += 1
  }
  return result
}

export function getFY(date: Date | string): string {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = d.getMonth()
  const fy = m >= 3 ? y : y - 1
  return `FY ${String(fy).slice(2)}-${String(fy + 1).slice(2)}`
}

export function fmtINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount || 0)
}

export function fmtINRCompact(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`
  return `₹${amount.toFixed(0)}`
}

export function fmtDate(input?: Date | string | null): string {
  if (!input) return '—'
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
}

export function dateOnlyISO(input: Date): string {
  return new Date(input.getTime() - input.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function safeNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function maskPhone(phone?: string | null): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return '•'.repeat(digits.length)
  const visible = digits.slice(-4)
  return `${'•'.repeat(digits.length - 4)}${visible}`
}

function fieldLabel(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  // Common acronyms read oddly title-cased word-by-word ("Client Poc Id") — fix the ones we have.
  return spaced.replace(/\bPoc\b/g, 'POC').replace(/\bId\b/g, 'ID')
}

/**
 * Rewrite zod's raw default validation strings ("Invalid cuid", "Expected string, received
 * null", ...) into something a non-technical user can act on. A message we already wrote
 * ourselves via a schema's `{ message: '...' }` — e.g. "Description is required" — won't match
 * any of these patterns, so it passes through untouched rather than getting double-labeled.
 */
function humanizeFieldMessage(label: string, raw: string): string {
  const m = raw.trim()

  if (/^required$/i.test(m)) return `${label} is required.`
  if (/^invalid cuid$/i.test(m) || /^invalid uuid$/i.test(m)) {
    return `${label} doesn't match a valid record — try clearing it and selecting it again.`
  }
  if (/^invalid email$/i.test(m)) return `${label} isn't a valid email address.`
  if (/^invalid date(time)?$/i.test(m)) return `${label} isn't a valid date.`
  if (/^expected .+, received (null|undefined)$/i.test(m)) return `${label} is required.`
  if (/^expected .+, received .+$/i.test(m)) return `${label} isn't the right kind of value.`
  if (/^invalid enum value\.?/i.test(m)) {
    const options = m.match(/expected (.+), received/i)?.[1]?.replace(/\|/g, ',').replace(/'/g, '').trim()
    return options ? `${label} must be one of: ${options}.` : `${label} isn't a valid choice.`
  }
  const minLen = m.match(/^string must contain at least (\d+) character/i)
  if (minLen) return `${label} is too short (needs at least ${minLen[1]} characters).`
  const maxLen = m.match(/^string must contain at most (\d+) character/i)
  if (maxLen) return `${label} is too long (max ${maxLen[1]} characters).`
  const minNum = m.match(/^number must be greater than or equal to (-?\d+(\.\d+)?)/i)
  if (minNum) return `${label} must be at least ${minNum[1]}.`
  const maxNum = m.match(/^number must be less than or equal to (-?\d+(\.\d+)?)/i)
  if (maxNum) return `${label} must be at most ${maxNum[1]}.`

  // Not a recognized raw pattern — treat it as an already-human message (our own custom
  // zod `message`, or a plain string the API returned directly) and leave it as-is.
  return raw
}

/**
 * Turn a failed-fetch error payload into a readable message. Handles both plain
 * `{ error: "some string" }` responses and zod's `flatten()` shape
 * `{ error: { formErrors: string[], fieldErrors: Record<string, string[]> } }` — most API
 * validation failures land in fieldErrors (per-field), not formErrors (whole-object), so a
 * naive `error?.formErrors?.[0]` check silently misses them and falls back to a generic message.
 * Raw validation jargon is rewritten into plain English via humanizeFieldMessage — a user should
 * never see a validator name (cuid, uuid, enum) or a "received undefined" type-mismatch string.
 */
export function formatApiError(payload: unknown, fallback: string): string {
  const err = (payload as { error?: unknown } | null)?.error
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const shaped = err as { formErrors?: string[]; fieldErrors?: Record<string, string[]> }
    const fieldKey = shaped.fieldErrors && Object.keys(shaped.fieldErrors).find((k) => shaped.fieldErrors![k]?.length)
    if (fieldKey) return humanizeFieldMessage(fieldLabel(fieldKey), shaped.fieldErrors![fieldKey][0])
    if (shaped.formErrors?.length) return shaped.formErrors[0]
  }
  return fallback
}
