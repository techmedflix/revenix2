export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { LeadStage, LeadType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthorizedUser } from '@/lib/rbac'
import { CALL_ACTIVITY_TYPES } from '@/lib/constants'
import { addBusinessDays } from '@/lib/utils'

const createSchema = z.object({
  opportunityId: z.string().cuid(),
  activityType: z.enum([
    'call_attempted',
    'call_connected',
    'meeting_scheduled',
    'meeting_done',
    'proposal_sent',
    'proposal_revised',
    'po_received',
  ]),
  outcome: z.enum(['positive', 'neutral', 'budget_issue', 'no_response', 'escalated']),
  notes: z.string().max(1000).optional().nullable(),
  nextCallDate: z.string().datetime().optional().nullable(),
  firstOffer: z.number().nonnegative().optional().nullable(),
  finalOffer: z.number().nonnegative().optional().nullable(),
  stageOverride: z.nativeEnum(LeadStage).optional().nullable(),
  leadTypeOverride: z.nativeEnum(LeadType).optional().nullable(),
  closedValue: z.number().nonnegative().optional().nullable(),
  estimatedCost: z.number().nonnegative().optional().nullable(),
  closeRemark: z.string().max(500).optional().nullable(),
})

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const opportunityId = searchParams.get('opportunityId')

  const activities = await prisma.activity.findMany({
    where: { opportunityId: opportunityId || undefined },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      opportunity: {
        select: { id: true, projectType: true, leadStage: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(activities)
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedUser()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const input = parsed.data

  const result = await prisma.$transaction(async (tx) => {
    const opportunity = await tx.opportunity.findUnique({ where: { id: input.opportunityId } })
    if (!opportunity) {
      throw new Error('Opportunity not found')
    }

    // Determine target leadType from override or activity type
    let targetLeadType = opportunity.leadType
    if (input.leadTypeOverride !== undefined) {
      targetLeadType = input.leadTypeOverride
    } else if (input.activityType === 'po_received') {
      targetLeadType = 'won'
    } else if (input.activityType === 'meeting_done' && !targetLeadType) {
      targetLeadType = 'warm'
    }

    // Determine target leadStage from override or activity type
    let targetLeadStage = opportunity.leadStage
    if (input.stageOverride) {
      targetLeadStage = input.stageOverride
    } else if (input.activityType === 'proposal_sent' || input.activityType === 'proposal_revised') {
      targetLeadStage = 'proposal'
    } else if (input.activityType === 'po_received') {
      targetLeadStage = 'commissioned'
    }

    const targetEstimatedCost = input.estimatedCost ?? opportunity.estimatedCost
    const targetClosedValue =
      targetLeadType === 'won' ? input.closedValue ?? opportunity.closedValue : opportunity.closedValue
    // Once won, the closed value IS the deal's value — keep estimatedValue in sync so the Order
    // Book and every pipeline calculation reflect what was actually signed, not the original ask.
    const targetEstimatedValue =
      targetLeadType === 'won' && targetClosedValue ? targetClosedValue : opportunity.estimatedValue

    const nextCallDate =
      input.nextCallDate
        ? new Date(input.nextCallDate)
        : CALL_ACTIVITY_TYPES.includes(input.activityType)
          ? addBusinessDays(new Date(), 3)
          : opportunity.nextCallDate

    const normalizedRemark = input.closeRemark?.trim() || null
    const closeRemark =
      targetLeadType === 'won' || targetLeadType === 'lost'
        ? normalizedRemark || opportunity.closeRemark || null
        : opportunity.closeRemark

    const activity = await tx.activity.create({
      data: {
        opportunityId: input.opportunityId,
        activityType: input.activityType,
        outcome: input.outcome,
        notes: input.notes || null,
        nextCallDate,
        firstOffer: input.firstOffer ?? null,
        finalOffer: input.finalOffer ?? null,
        stageOverride: targetLeadStage || null,
        createdById: auth.user.id,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    })

    const updatedOpportunity = await tx.opportunity.update({
      where: { id: input.opportunityId },
      data: {
        leadType: targetLeadType,
        leadStage: targetLeadStage,
        nextCallDate,
        firstOffer: input.firstOffer ?? opportunity.firstOffer,
        finalOffer: input.finalOffer ?? opportunity.finalOffer,
        estimatedCost: targetEstimatedCost,
        estimatedValue: targetEstimatedValue,
        closedValue: targetClosedValue,
        closeRemark,
      },
    })

    return { activity, opportunity: updatedOpportunity }
  })

  return NextResponse.json(result, { status: 201 })
}
