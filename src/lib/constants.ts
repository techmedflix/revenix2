import type { ActivityType } from '@prisma/client'
import type { LeadType, LeadStage } from './opportunityStages'
import { LEAD_TYPE_DEFAULT_PROBABILITY } from './opportunityStages'

export const FX_RATES: Record<string, number> = {
  INR: 1,
  USD: 92,
  EUR: 108,
  GBP: 122,
  AED: 25,
}

// Weight (0-1) used for weighted pipeline value calculations — the lead-type
// default win-probability expressed as a fraction. A row's own manually-entered
// probability overrides this (see effectiveProbability()).
export const LEAD_TYPE_WEIGHTS: Record<LeadType, number> = {
  won:  LEAD_TYPE_DEFAULT_PROBABILITY.won  / 100,
  hot:  LEAD_TYPE_DEFAULT_PROBABILITY.hot  / 100,
  warm: LEAD_TYPE_DEFAULT_PROBABILITY.warm / 100,
  cold: LEAD_TYPE_DEFAULT_PROBABILITY.cold / 100,
  lost: LEAD_TYPE_DEFAULT_PROBABILITY.lost / 100,
}

export const LEAD_STAGE_WEIGHTS: Record<LeadStage, number> = {
  invoiced:         1,
  partial_invoiced: 0.95,
  commissioned:     0.95,
  pilot:            0.5,
  proposal:         0.35,
}

export const PROJECT_TYPE_MAP: Record<string, string[]> = {
  virtual_events: ['Webinars', 'ISP', 'Wizards', 'Shows', 'RCP', 'MasterClass'],
  managed_events: ['Physical', 'Virtual', 'Programs'],
  medflix_productions: ['AICP', 'AISM', 'SMCP'],
  research: ['Surveys', 'Ad-boards', 'FGDs', 'Need Assessments', 'PRISM'],
  content_design: ['Infographics', 'Conference Coverage', 'Abstract Summary', 'Journal Summary', 'Guideline Summary', 'LBL Flyers', 'Design', 'Slide Decks', 'Video Recording', 'Podcast'],
}

// Friendly display labels for project category slugs — falls back to a title-cased
// version of the slug for any category not listed here (e.g. custom/legacy ones).
export const PROJECT_CATEGORY_LABELS: Record<string, string> = {
  virtual_events:      'Virtual Events',
  managed_events:      'Managed Events',
  medflix_productions: 'Medflix Productions',
  research:            'Research',
  content_design:      'Content & Design',
}

export function projectCategoryLabel(category: string): string {
  return PROJECT_CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export const FY_OPTIONS = ['FY 25-26', 'FY 26-27', 'FY 24-25', 'FY 23-24']

export const CALL_ACTIVITY_TYPES: ActivityType[] = ['call_attempted', 'call_connected']
