import { LEAD_TYPE_WEIGHTS, LEAD_STAGE_WEIGHTS } from './constants'
import type { LeadType, LeadStage } from './opportunityStages'

export function contributionPercent(value: number, cost: number) {
  if (!value) return 0
  return ((value - cost) / value) * 100
}

export function discountPercent(firstOffer?: number | null, finalOffer?: number | null) {
  if (!firstOffer || !finalOffer || firstOffer <= 0) return 0
  return ((firstOffer - finalOffer) / firstOffer) * 100
}

// Remaining, uncollected pipeline value for a bucket that's already commissioned/won:
// what's still outstanding once amounts already invoiced (fully or partially) are netted out.
export function remainingPipelineValue(estimatedValue: number, invoicedAmount: number) {
  return Math.max(0, estimatedValue - invoicedAmount)
}

export function leadTypeWeight(leadType: LeadType | null | undefined) {
  if (!leadType) return 0
  return LEAD_TYPE_WEIGHTS[leadType] ?? 0
}

export function leadStageWeight(leadStage: LeadStage | null | undefined) {
  if (!leadStage) return 0
  return LEAD_STAGE_WEIGHTS[leadStage] ?? 0
}

export type CashflowRow = {
  monthKey: string
  monthLabel: string
  expectedInflows: number
  vendorOutflows: number
  opex: number
  netCash: number
  closingBalance: number
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function key(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function label(date: Date) {
  return date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

function shiftDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function buildCashflowProjection(input: {
  openingBalance: number
  monthlyOpex: number
  delayDays: number
  months: number
  inflows: Array<{ amount: number; date: Date }>
  outflows: Array<{ amount: number; date: Date }>
}) {
  const start = monthStart(new Date())
  const months = Array.from({ length: input.months }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth() + i, 1),
  )
  const rows = months.map((m) => ({
    monthKey: key(m),
    monthLabel: label(m),
    expectedInflows: 0,
    vendorOutflows: 0,
    opex: input.monthlyOpex,
    netCash: 0,
    closingBalance: 0,
  }))

  const rowByKey = new Map(rows.map((r) => [r.monthKey, r]))

  for (const x of input.inflows) {
    const d = monthStart(shiftDays(x.date, input.delayDays))
    const row = rowByKey.get(key(d))
    if (row) row.expectedInflows += x.amount
  }

  for (const x of input.outflows) {
    const d = monthStart(x.date)
    const row = rowByKey.get(key(d))
    if (row) row.vendorOutflows += x.amount
  }

  let closing = input.openingBalance
  for (const row of rows) {
    row.netCash = row.expectedInflows - row.vendorOutflows - row.opex
    closing += row.netCash
    row.closingBalance = closing
  }

  return rows
}
