/**
 * One-time backfill for Opportunity.oppNo (Order Book number).
 *
 * Assigns numbers in the format OB{YY}{MM}{seq}, e.g. OB260701 for the
 * first opportunity created in July 2026 — mirrors the format used going
 * forward by generateOppNo() in src/app/api/opportunities/route.ts.
 *
 * Only touches rows where oppNo is currently null. Existing rows are
 * numbered in createdAt order, grouped by calendar month, so the sequence
 * matches the order entries actually appeared in.
 *
 * Run: npx tsx scripts/backfill-opp-no.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const opportunities = await prisma.opportunity.findMany({
    where: { oppNo: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true },
  })

  console.log(`Found ${opportunities.length} opportunities without an oppNo.`)

  const seqByMonth = new Map<string, number>()
  let updated = 0

  for (const opp of opportunities) {
    const yy = String(opp.createdAt.getFullYear()).slice(-2)
    const mm = String(opp.createdAt.getMonth() + 1).padStart(2, '0')
    const prefix = `OB${yy}${mm}`

    const next = (seqByMonth.get(prefix) ?? 0) + 1
    seqByMonth.set(prefix, next)

    const oppNo = `${prefix}${String(next).padStart(2, '0')}`

    await prisma.opportunity.update({ where: { id: opp.id }, data: { oppNo } })
    updated++
    console.log(`  ${opp.id} -> ${oppNo}`)
  }

  console.log(`Done. Backfilled ${updated} opportunities.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
