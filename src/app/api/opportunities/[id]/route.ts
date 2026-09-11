export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ClientType, LeadType, LeadStage } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'
import { contributionPercent, discountPercent } from '@/lib/finance'
import { defaultProbabilityFor } from '@/lib/opportunityStages'

const patchSchema = z.object({
  accountId: z.string().cuid({ message: 'Company is invalid — try re-selecting it' }).optional(),
  ownerId: z.string().cuid({ message: 'Owner is invalid — try re-selecting it' }).optional(),
  projectCategory: z.string().min(1, 'Project category is required').max(80).optional(),
  projectType: z.string().min(1, 'Project type is required').max(120).optional(),
  estimatedValue: z.number().nonnegative('Revenue can\'t be negative').optional(),
  estimatedCost: z.number().nonnegative('Cost can\'t be negative').optional(),
  clientType: z.nativeEnum(ClientType).nullable().optional(),
  leadType: z.nativeEnum(LeadType).nullable().optional(),
  probability: z.number().int('Probability must be a whole number').min(0, 'Probability can\'t be below 0%').max(100, 'Probability can\'t be above 100%').nullable().optional(),
  leadStage: z.nativeEnum(LeadStage).nullable().optional(),
  expectedKickoff: z.string().datetime({ message: 'Expected kick-off date is invalid' }).nullable().optional(),
  nextCallDate: z.string().datetime({ message: 'Next call date is invalid' }).nullable().optional(),
  firstOffer: z.number().nonnegative('First offer can\'t be negative').nullable().optional(),
  finalOffer: z.number().nonnegative('Final offer can\'t be negative').nullable().optional(),
  closedValue: z.number().nonnegative('Closed value can\'t be negative').nullable().optional(),
  closeRemark: z.string().nullable().optional(),
  negotiationReason: z.string().max(400).nullable().optional(),
  // Plain string ID, not .cuid() — POCs backfilled from the pre-CRM free-text migration got
  // deterministic hash-based IDs (e.g. "poc_<hash>"), not Prisma's standard cuid shape.
  clientPocId: z.string().min(1).max(64).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  medical: z.boolean().optional(),
  totalQty: z.number().int().nonnegative().nullable().optional(),
  unitRevenue: z.number().nonnegative().nullable().optional(),
  unitCost: z.number().nonnegative().nullable().optional(),
  invoiceIds: z.array(z.string().cuid()).optional(),
  contributionValue: z.number().nullable().optional(),
})

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

const includeShape = {
  account: true,
  owner: { select: { id: true, name: true, email: true } },
  clientPoc: { select: { id: true, name: true, designation: true, phone: true, email: true } },
  invoices: { select: { id: true, invNo: true, net: true, amt: true, status: true } },
} as const

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: params.id },
    include: {
      ...includeShape,
      activities: {
        include: { createdBy: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!opportunity) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(withDerived(opportunity))
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  const current = await prisma.opportunity.findUnique({ where: { id: params.id } })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data
  const targetLeadType = d.leadType !== undefined ? d.leadType : current.leadType

  // Probability: an explicit number in the payload is stored and locked as manual;
  // an explicit null reverts to auto; otherwise a lead-type change re-derives the
  // default as long as the row isn't already manually overridden. `undefined` on both
  // fields leaves the stored values untouched.
  let probability: number | undefined
  let probabilityManual: boolean | undefined
  if (d.probability !== undefined) {
    if (d.probability === null) {
      probabilityManual = false
      probability = defaultProbabilityFor(targetLeadType)
    } else {
      probabilityManual = true
      probability = d.probability
    }
  } else if (d.leadType !== undefined && d.leadType !== current.leadType && !current.probabilityManual) {
    probability = defaultProbabilityFor(targetLeadType)
    probabilityManual = false
  }
  // Value ⇄ closed-value sync — but ONLY driven by fields sent in *this* request, never by
  // the stale stored closedValue (that made every later edit of a won deal snap the value
  // back to the original signed figure and silently discard the user's change):
  //   • WonModal sends closedValue  ⇒ that becomes the deal's estimatedValue.
  //   • Editing the value of an already-won deal (no closedValue in the payload) ⇒ keep the
  //     stored closedValue in step so the two don't drift apart.
  //   • Any other edit leaves estimatedValue exactly as sent.
  const estimatedValue =
    d.closedValue != null && targetLeadType === 'won' ? d.closedValue : d.estimatedValue
  const closedValue =
    d.closedValue !== undefined
      ? d.closedValue
      : d.estimatedValue !== undefined && targetLeadType === 'won'
        ? d.estimatedValue
        : undefined

  const updated = await prisma.$transaction(async (tx) => {
    // Relink invoices to this opportunity (only takes invoices that are unlinked or already
    // linked here — never steals one linked to a different opportunity) and drop any that were
    // unchecked. invoicedAmount is then derived from whatever ends up linked, so it's never a
    // manually-typed number that can drift from the real invoices.
    let invoicedAmount: number | undefined
    if (d.invoiceIds !== undefined) {
      await tx.invoice.updateMany({
        where: { opportunityId: params.id, id: { notIn: d.invoiceIds } },
        data: { opportunityId: null },
      })
      if (d.invoiceIds.length > 0) {
        await tx.invoice.updateMany({
          where: { id: { in: d.invoiceIds }, OR: [{ opportunityId: null }, { opportunityId: params.id }] },
          data: { opportunityId: params.id },
        })
      }
      const linked = await tx.invoice.findMany({
        where: { opportunityId: params.id },
        select: { net: true },
      })
      invoicedAmount = linked.reduce((sum, inv) => sum + inv.net, 0)
    }

    const updatedOpportunity = await tx.opportunity.update({
      where: { id: params.id },
      data: {
        accountId: d.accountId,
        ownerId: d.ownerId,
        projectCategory: d.projectCategory,
        projectType: d.projectType,
        estimatedValue,
        estimatedCost: d.estimatedCost,
        clientType: d.clientType,
        leadType: d.leadType,
        probability,
        probabilityManual,
        leadStage: d.leadStage,
        expectedKickoff:
          d.expectedKickoff === undefined ? undefined : d.expectedKickoff ? new Date(d.expectedKickoff) : null,
        nextCallDate:
          d.nextCallDate === undefined ? undefined : d.nextCallDate ? new Date(d.nextCallDate) : null,
        firstOffer: d.firstOffer,
        finalOffer: d.finalOffer,
        closedValue,
        closeRemark: d.closeRemark,
        negotiationReason: d.negotiationReason,
        clientPocId: d.clientPocId,
        description: d.description,
        medical: d.medical,
        totalQty: d.totalQty,
        unitRevenue: d.unitRevenue,
        unitCost: d.unitCost,
        invoicedAmount,
      },
      include: includeShape,
    })

    // Auto-log Activity on leadStage changes
    if (d.leadStage && d.leadStage !== current.leadStage) {
      const stageActivityMap: Partial<Record<LeadStage, 'proposal_sent' | 'po_received'>> = {
        proposal:     'proposal_sent',
        commissioned: 'po_received',
      }
      const autoType = stageActivityMap[d.leadStage]
      if (autoType) {
        try {
          await tx.activity.create({
            data: {
              opportunityId: updatedOpportunity.id,
              activityType: autoType,
              outcome: 'positive',
              notes: `Stage updated: ${current.leadStage} → ${d.leadStage}`,
              stageOverride: d.leadStage,
              createdById: auth.user.id,
            },
          })
        } catch {
          // swallow — activity logging must never block updates
        }
      }
    }

    return tx.opportunity.findUnique({
      where: { id: updatedOpportunity.id },
      include: includeShape,
    })
  })
  return NextResponse.json(updated ? withDerived(updated) : updated)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  await prisma.opportunity.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
