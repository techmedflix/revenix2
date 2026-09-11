export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ClientType, LeadType, LeadStage, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'
import { contributionPercent, discountPercent } from '@/lib/finance'
import { defaultProbabilityFor } from '@/lib/opportunityStages'

// Mandatory: Company (accountId), Description, Revenue (estimatedValue), Project Category,
// Project Type, Lead Type. Everything else is optional.
const createSchema = z.object({
  accountId: z.string().cuid({ message: 'Company is required' }),
  ownerId: z.string().cuid({ message: 'Owner is invalid — try re-selecting it' }).optional(),
  projectCategory: z.string().min(1, 'Project category is required').max(80),
  projectType: z.string().min(1, 'Project type is required').max(120),
  estimatedValue: z.number({ invalid_type_error: 'Revenue is required' }).nonnegative('Revenue can\'t be negative'),
  estimatedCost: z.number().nonnegative('Cost can\'t be negative').optional().default(0),
  clientType: z.nativeEnum(ClientType).nullable().optional(),
  leadType: z.nativeEnum(LeadType, { errorMap: () => ({ message: 'Lead type is required' }) }),
  probability: z.number().int('Probability must be a whole number').min(0, 'Probability can\'t be below 0%').max(100, 'Probability can\'t be above 100%').nullable().optional(),
  leadStage: z.nativeEnum(LeadStage).nullable().optional(),
  closedValue: z.number().nonnegative('Closed value can\'t be negative').nullable().optional(),
  closeRemark: z.string().nullable().optional(),
  expectedKickoff: z.string().datetime({ message: 'Expected kick-off date is invalid' }).nullable().optional(),
  nextCallDate: z.string().datetime({ message: 'Next call date is invalid' }).nullable().optional(),
  negotiationReason: z.string().max(400).nullable().optional(),
  // Plain string ID, not .cuid() — POCs backfilled from the pre-CRM free-text migration got
  // deterministic hash-based IDs (e.g. "poc_<hash>"), not Prisma's standard cuid shape.
  clientPocId: z.string().min(1).max(64).nullable().optional(),
  description: z.string().min(1, 'Description is required').max(1000),
  medical: z.boolean().optional(),
  totalQty: z.number().int().nonnegative().nullable().optional(),
  unitRevenue: z.number().nonnegative().nullable().optional(),
  unitCost: z.number().nonnegative().nullable().optional(),
})

// Order Book number: OB + YY + MM + 2-digit sequence, resetting each calendar month (e.g. OB260701).
// Uses max(sequence)+1 rather than count()+1 so a deletion mid-month doesn't cause a number to be reused.
async function generateOppNo(tx: Prisma.TransactionClient, createdAt: Date): Promise<string> {
  const yy = String(createdAt.getFullYear()).slice(-2)
  const mm = String(createdAt.getMonth() + 1).padStart(2, '0')
  const prefix = `OB${yy}${mm}`
  const rows = await tx.opportunity.findMany({
    where: { oppNo: { startsWith: prefix } },
    select: { oppNo: true },
  })
  let maxSeq = 0
  for (const { oppNo } of rows) {
    const seq = Number.parseInt(oppNo?.slice(prefix.length) ?? '', 10)
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq
  }
  return `${prefix}${String(maxSeq + 1).padStart(2, '0')}`
}

// True when `err` is a unique-constraint (P2002) violation on the oppNo column.
// Prisma reports `meta.target` as an array of field names on some connectors and as
// the index name (a string) on PostgreSQL — accept either shape.
function isOppNoConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false
  const target = err.meta?.target
  if (Array.isArray(target)) return target.includes('oppNo')
  if (typeof target === 'string') return target.includes('oppNo')
  return false
}

// Maps a create-time exception to a specific, plain-English message + HTTP status,
// so the client never has to fall back to a bare "Failed to create opportunity".
function describeCreateError(err: unknown): { status: number; message: string } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // A linked row (company / owner / contact) was deleted between page load and submit.
    if (err.code === 'P2003' || err.code === 'P2025') {
      const field = String(err.meta?.field_name ?? '').toLowerCase()
      if (field.includes('account')) return { status: 400, message: 'That company no longer exists. Close this form, refresh the page, and pick the company again.' }
      if (field.includes('owner')) return { status: 400, message: 'The selected owner no longer exists. Re-select the owner and try again.' }
      if (field.includes('poc') || field.includes('clientpoc')) return { status: 400, message: 'The selected contact (POC) no longer exists. Clear it or pick a different contact and try again.' }
      return { status: 400, message: 'A linked record (company, owner, or contact) no longer exists. Refresh the page and re-select it.' }
    }
    if (err.code === 'P2002') return { status: 409, message: 'Could not assign a unique Order Book number — another opportunity may be being created at the same time. Please try again.' }
    if (err.code === 'P2000') return { status: 400, message: 'One of the values is too long for its field. Shorten the text and try again.' }
    if (err.code === 'P2028' || err.code === 'P2024') return { status: 503, message: 'The database was busy and the request timed out before the opportunity was saved. Please try again in a moment.' }
  }

  // Writing an enum option the database doesn't have yet — a pending schema change
  // (npm run db:push) has not been applied to this environment.
  const raw = err instanceof Error ? err.message : String(err)
  if (/invalid input value for enum/i.test(raw)) {
    const bad = raw.match(/enum [^:]+: "([^"]+)"/i)?.[1]
    return {
      status: 500,
      message: bad
        ? `This environment's database doesn't recognise the "${bad}" option yet. A pending database update needs to be applied before this can be saved.`
        : 'This environment\'s database is missing an option this form now offers. A pending database update needs to be applied before this can be saved.',
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, message: 'The opportunity details didn\'t match what the database expects. Re-check each field and try again.' }
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return { status: 503, message: 'Could not reach the database. Please try again shortly.' }
  }
  return { status: 500, message: `The opportunity could not be saved: ${raw}` }
}

function withDerived<T extends {
  estimatedValue: number
  estimatedCost: number
  firstOffer?: number | null
  finalOffer?: number | null
  invoicedAmount?: number | null
}>(o: T) {
  return {
    ...o,
    contributionPercent: contributionPercent(o.estimatedValue, o.estimatedCost),
    contributionValue: o.estimatedValue - o.estimatedCost,
    discountPercent: discountPercent(o.firstOffer, o.finalOffer),
    invoicedAmount: o.invoicedAmount ?? 0,
  }
}

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const leadStageFilter = searchParams.get('leadStage')
  const leadTypeFilter = searchParams.get('leadType')
  const ownerId = searchParams.get('ownerId')
  const accountId = searchParams.get('accountId')
  const nextCallDate = searchParams.get('nextCallDate')

  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  const data = await prisma.opportunity.findMany({
    where: {
      leadStage: leadStageFilter ? { in: leadStageFilter.split(',') as any } : undefined,
      leadType: leadTypeFilter ? { in: leadTypeFilter.split(',') as any } : undefined,
      ownerId: ownerId || undefined,
      accountId: accountId || undefined,
      nextCallDate:
        nextCallDate === 'today'
          ? { gte: start, lt: end }
          : undefined,
    },
    include: {
      account: true,
      owner: { select: { id: true, name: true, email: true } },
      clientPoc: { select: { id: true, name: true, designation: true, phone: true, email: true } },
      invoices: { select: { id: true, invNo: true, net: true, amt: true, status: true } },
      _count: { select: { activities: true } },
      activities: {
        select: { activityType: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(data.map((x) => withDerived(x)))
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'The request body was not valid JSON.' }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const o = parsed.data
  const isWon = o.leadType === 'won'
  // A hand-entered probability is stored and locked (probabilityManual); otherwise
  // it tracks the lead-type default (Commissioned 95 / Hot 50 / Warm 20 / Cold 5 / Lost 0).
  const probabilityManual = o.probability != null
  const probability = probabilityManual ? o.probability! : defaultProbabilityFor(o.leadType)
  // Once won, the closed value IS the deal's value — keep estimatedValue in sync so the Order
  // Book and every pipeline calculation reflect what was actually signed, not the original ask.
  const estimatedValue = isWon && o.closedValue ? o.closedValue : o.estimatedValue

  const data = {
    accountId: o.accountId,
    ownerId: o.ownerId || auth.user.id,
    projectCategory: o.projectCategory,
    projectType: o.projectType,
    estimatedValue,
    estimatedCost: o.estimatedCost,
    clientType: o.clientType ?? 'new',
    leadType: o.leadType ?? null,
    probability,
    probabilityManual,
    leadStage: (isWon ? 'commissioned' : o.leadStage ?? 'proposal') as LeadStage,
    closedValue: isWon ? o.closedValue : undefined,
    closeRemark: isWon ? o.closeRemark?.trim() : undefined,
    expectedKickoff: o.expectedKickoff ? new Date(o.expectedKickoff) : null,
    nextCallDate: o.nextCallDate ? new Date(o.nextCallDate) : null,
    negotiationReason: o.negotiationReason || null,
    clientPocId: o.clientPocId || null,
    description: o.description || null,
    medical: o.medical ?? false,
    totalQty: o.totalQty ?? null,
    unitRevenue: o.unitRevenue ?? null,
    unitCost: o.unitCost ?? null,
  }
  const include = {
    account: true,
    owner: { select: { id: true, name: true, email: true } },
    clientPoc: { select: { id: true, name: true, designation: true, phone: true, email: true } },
  } as const

  // The Order Book number is max(existing)+1, which isn't collision-proof under
  // concurrent creates. Retry a few times on a unique-number clash, regenerating the
  // number each attempt; map every other failure to a specific, readable message.
  const MAX_ATTEMPTS = 5
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const oppNo = await generateOppNo(tx, new Date())
        return tx.opportunity.create({ data: { ...data, oppNo }, include })
      })
      return NextResponse.json(withDerived(created), { status: 201 })
    } catch (err) {
      if (isOppNoConflict(err) && attempt < MAX_ATTEMPTS) continue
      const { status, message } = describeCreateError(err)
      console.error('[POST /api/opportunities] create failed:', err)
      return NextResponse.json({ error: message }, { status })
    }
  }

  // Unreachable — the loop always returns — but TS needs a terminal statement.
  return NextResponse.json(
    { error: 'Could not assign a unique Order Book number after several attempts. Please try again.' },
    { status: 409 },
  )
}
