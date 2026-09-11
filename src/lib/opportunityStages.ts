/** Mirrors Prisma enums — defined here so client components can import safely (no @prisma/client in browser). */

export type ClientType = 'new' | 'existing'
export type LeadType   = 'won' | 'hot' | 'warm' | 'cold' | 'lost'
export type LeadStage  = 'proposal' | 'pilot' | 'commissioned' | 'partial_invoiced' | 'invoiced'

export const CLIENT_TYPES: ClientType[] = ['new', 'existing']
export const CLIENT_TYPE_LABEL: Record<ClientType, string> = {
  new:      'New',
  existing: 'Existing',
}

export const LEAD_TYPES: LeadType[] = ['won', 'hot', 'warm', 'cold', 'lost']
export const LEAD_TYPE_LABEL: Record<LeadType, string> = {
  won:  'Won',
  hot:  'Hot',
  warm: 'Warm',
  cold: 'Cold',
  lost: 'Lost',
}

// Default win-probability (%) per lead type. Used for every weighted pipeline
// calculation when a row has no manually-entered probability. A hand-typed
// probability (probabilityManual) always overrides these.
export const LEAD_TYPE_DEFAULT_PROBABILITY: Record<LeadType, number> = {
  won:  95,
  hot:  50,
  warm: 20,
  cold: 5,
  lost: 0,
}

export function defaultProbabilityFor(leadType: LeadType | null | undefined): number {
  return leadType ? LEAD_TYPE_DEFAULT_PROBABILITY[leadType] : 0
}

// The probability actually used in pipeline math. Once backfilled + kept in sync
// on lead-type changes, `probability` always holds either the manual value or the
// lead-type default; the null fallback is just belt-and-braces for stray rows.
export function effectiveProbability(o: {
  probability: number | null
  leadType: LeadType | null
}): number {
  return o.probability != null ? o.probability : defaultProbabilityFor(o.leadType)
}

// ── Canonical pipeline-value maths ──────────────────────────────────────────
// Single source of truth shared by the Order Book pills/strip and the Dashboard
// KPIs, so "Won / Commissioned" means the exact same number on both screens.

type PipelineRow = {
  estimatedValue: number
  estimatedCost?: number
  invoicedAmount?: number | null
  leadStage: LeadStage | null
  probability: number | null
  leadType: LeadType | null
}

/** Contract value still to be realised: nil once fully invoiced, else value minus what's already invoiced. */
export function remainingContractValue(o: PipelineRow): number {
  if (o.leadStage === 'invoiced') return 0
  return Math.max(0, o.estimatedValue - (o.invoicedAmount ?? 0))
}

/** Fraction of the deal still un-invoiced (0 when fully invoiced, 1 when nothing's billed yet). */
export function remainingFraction(o: PipelineRow): number {
  if (o.estimatedValue > 0) return remainingContractValue(o) / o.estimatedValue
  return o.leadStage === 'invoiced' ? 0 : 1
}

/**
 * Contribution (margin) still to be earned. Invoicing a slice of the revenue is treated as
 * delivering that same slice of the work, so BOTH revenue and cost shrink proportionally:
 * revenue 10L / cost 2L, 5L invoiced → 5L revenue, 1L cost, 4L contribution left.
 */
export function remainingContractContribution(o: PipelineRow): number {
  return (o.estimatedValue - (o.estimatedCost ?? 0)) * remainingFraction(o)
}

/** Cost still to be incurred — the un-invoiced proportion of the project's cost. */
export function remainingContractCost(o: PipelineRow): number {
  return (o.estimatedCost ?? 0) * remainingFraction(o)
}

/** Remaining contract value, probability-weighted — the number shown as pipeline. */
export function weightedPipelineValue(o: PipelineRow): number {
  return remainingContractValue(o) * (effectiveProbability(o) / 100)
}

/** Remaining contribution, probability-weighted. */
export function weightedPipelineContribution(o: PipelineRow): number {
  return remainingContractContribution(o) * (effectiveProbability(o) / 100)
}

export const LEAD_STAGES: LeadStage[] = ['proposal', 'pilot', 'commissioned', 'partial_invoiced', 'invoiced']
export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  proposal:         'Proposal',
  pilot:            'Pilot',
  commissioned:     'Commissioned',
  partial_invoiced: 'Partially Invoiced',
  invoiced:         'Invoiced',
}

// Invoiced/Partially Invoiced are only ever set via the dedicated "Update Invoicing Status" action
// (which also captures the linked invoices) — never as a plain stage picker option.
export const MANUAL_LEAD_STAGES: LeadStage[] = LEAD_STAGES.filter(
  (s) => s !== 'invoiced' && s !== 'partial_invoiced',
)
