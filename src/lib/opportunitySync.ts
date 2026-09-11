import type { prisma as globalPrisma } from './prisma'

// Accepts either the top-level prisma client or a $transaction callback's tx client — both
// expose the same shape we need here.
type PrismaLike = {
  invoice: { aggregate: (typeof globalPrisma)['invoice']['aggregate'] }
  opportunity: {
    findUnique: (typeof globalPrisma)['opportunity']['findUnique']
    update: (typeof globalPrisma)['opportunity']['update']
  }
}

/**
 * Recompute Opportunity.invoicedAmount from the real sum of its linked invoices' net amount,
 * and move leadStage to match: linking/unlinking invoices from the Invoicing tab now nudges the
 * Order Book stage the same way the "Update Invoicing Status" action would, so the two stay in
 * step — e.g. a second invoice that finishes off a Partially Invoiced deal flips it to Invoiced,
 * and unlinking every invoice from an Invoiced/Partial deal drops it back to Commissioned.
 *
 * Stage is only ever nudged *within* the won family (Commissioned ⇄ Partially Invoiced ⇄
 * Invoiced). A Proposal/Hot/etc. deal is never auto-promoted just because an invoice got linked,
 * and an explicit stage set through the opportunity API is still respected there (that path
 * doesn't call this helper).
 */
export async function syncOpportunityInvoicedAmount(db: PrismaLike, opportunityId: string) {
  const agg = await db.invoice.aggregate({
    where: { opportunityId },
    _sum: { net: true },
  })
  const invoicedAmount = agg._sum.net ?? 0

  const opp = await db.opportunity.findUnique({
    where: { id: opportunityId },
    select: { estimatedValue: true, leadStage: true, leadType: true },
  })
  if (!opp) return

  const inWonFamily =
    opp.leadType === 'won' ||
    opp.leadStage === 'commissioned' ||
    opp.leadStage === 'partial_invoiced' ||
    opp.leadStage === 'invoiced'

  let leadStage = opp.leadStage
  if (inWonFamily) {
    if (invoicedAmount > 0.5) {
      // Any real invoiced amount ⇒ Partially Invoiced, or Invoiced once it covers the deal value.
      leadStage = invoicedAmount >= opp.estimatedValue * 0.999 ? 'invoiced' : 'partial_invoiced'
    } else {
      // Everything unlinked ⇒ fall back to Commissioned.
      leadStage = 'commissioned'
    }
  }

  await db.opportunity.update({
    where: { id: opportunityId },
    data: { invoicedAmount, leadStage },
  })
}
