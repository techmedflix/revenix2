/**
 * One-time backfill for Opportunity.probability / probabilityManual.
 *
 * Rules:
 *  - A row that already has a probability set was entered by hand before this
 *    feature existed → keep the value, mark probabilityManual = true so it's
 *    never silently overwritten.
 *  - A row with no probability → set it to the lead-type default
 *    (Commissioned/Won 95, Hot 50, Warm 20, Cold 5, Lost 0; no lead type → 0)
 *    and leave probabilityManual = false so it keeps tracking the default when
 *    the lead type changes.
 *
 * Idempotent: re-running only touches rows still on the default track
 * (probabilityManual = false) and rows still missing a value.
 *
 * Run: npx tsx scripts/backfill-probability.ts
 */

import { PrismaClient } from '@prisma/client'
import { LEAD_TYPE_DEFAULT_PROBABILITY } from '../src/lib/opportunityStages'

const prisma = new PrismaClient()

async function main() {
  const opps = await prisma.opportunity.findMany({
    select: { id: true, leadType: true, probability: true, probabilityManual: true },
  })
  console.log(`Scanning ${opps.length} opportunities.`)

  let markedManual = 0
  let setDefault = 0

  for (const o of opps) {
    const def = o.leadType ? LEAD_TYPE_DEFAULT_PROBABILITY[o.leadType] : 0

    if (o.probability != null && !o.probabilityManual) {
      // Pre-existing hand-entered value — lock it.
      await prisma.opportunity.update({
        where: { id: o.id },
        data: { probabilityManual: true },
      })
      markedManual++
      continue
    }

    if (o.probability == null && !o.probabilityManual) {
      await prisma.opportunity.update({
        where: { id: o.id },
        data: { probability: def, probabilityManual: false },
      })
      setDefault++
    }
  }

  console.log(`Done. Locked ${markedManual} manual rows, set default on ${setDefault} rows.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
