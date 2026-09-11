/**
 * 1. Merge duplicate accounts (BI→Boehringer, Lilly→Eli Lilly, Intas dup→Intas)
 * 2. Auto-map invoice company names to account IDs
 * Run: node scripts/merge-and-map-accounts.mjs
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// ─── Step 1: Merge duplicate accounts ────────────────────────────────────────
async function mergeAccounts(keepId, deleteId, label) {
  console.log(`\n── Merging: ${label}`)
  console.log(`   Keep: ${keepId}  |  Delete: ${deleteId}`)

  const [opps, projects, invoices, children] = await Promise.all([
    prisma.opportunity.count({ where: { accountId: deleteId } }),
    prisma.project.count({ where: { accountId: deleteId } }),
    prisma.invoice.count({ where: { accountId: deleteId } }),
    prisma.account.count({ where: { parentId: deleteId } }),
  ])
  console.log(`   Moving: ${opps} opps, ${projects} projects, ${invoices} invoices, ${children} child accounts`)

  await Promise.all([
    prisma.opportunity.updateMany({ where: { accountId: deleteId }, data: { accountId: keepId } }),
    prisma.project.updateMany({ where: { accountId: deleteId }, data: { accountId: keepId } }),
    prisma.invoice.updateMany({ where: { accountId: deleteId }, data: { accountId: keepId } }),
    prisma.account.updateMany({ where: { parentId: deleteId }, data: { parentId: keepId } }),
  ])

  await prisma.account.delete({ where: { id: deleteId } })
  console.log(`   ✓ Done`)
}

// ─── Step 2: Build invoice company → account ID mapping ──────────────────────
async function mapInvoiceCompanies() {
  console.log('\n── Loading accounts...')
  const accounts = await prisma.account.findMany({
    where: { type: 'company' },
    select: { id: true, name: true },
  })

  // Build case-insensitive lookup
  const byName = new Map(accounts.map(a => [a.name.toLowerCase().trim(), a.id]))

  // Manual overrides: invoice company name → account name (for inexact matches)
  const overrides = {
    'astrazeneca':              'astrazeneca',
    'bajaj finance':            'bajaj',
    'torrent pharma':           'torrent',
    'boehringer ingelheim':     'boehringer ingelheim',
    'intas':                    'intas',
    'sun pharma':               'sun pharma',
    'cipla':                    'cipla',
    'pfizer':                   'pfizer',
    'alkem':                    'alkem',
    'sanofi':                   'sanofi',
    'galderma':                 'galderma',
    'takeda':                   'takeda',
    'usv':                      'usv',
    'qmed':                     'qmed',
    'coveryou':                 'coveryou',
    'turtle finance':           'turtle finance',
    'cadila':                   'cadila',
    'aristo':                   'aristo',
    'alcon':                    'alcon',
    'lupin':                    'lupin',
    'emcure':                   'emcure',
    'gsk':                      'gsk',
    'bayer':                    'bayer',
    'drl':                      'drl',
    'himalaya wellness':        'himalaya wellness',
    'alembic':                  'alembic',
    'wockhardt':                'wockhardt',  // will be skipped if no account
    'novo nordisk':             'novo nordisk',
    'roche':                    'roche',
    'ge healthcare':            'ge healthcare',
    'mankind':                  'mankind',
    'viatris':                  'viatris',
    'appasamy':                 'appasamy',
    'microlabs':                'microlabs',
    'meghmani':                 'meghmani',
    'corona remedies':          'corona remedies',
    'cytiva':                   'cytiva',
    'bajaj':                    'bajaj',
    'kenvue':                   'kenvue',
    'hbc life':                 'hbc life',
    'medflix':                  null, // internal entity - skip
  }

  // Get all invoices without accountId
  const invoices = await prisma.invoice.findMany({
    where: { accountId: null },
    select: { id: true, company: true, clientName: true },
  })
  console.log(`\n── Mapping ${invoices.length} unlinked invoices to accounts...`)

  let mapped = 0, skipped = 0
  const unmapped = new Set()

  for (const inv of invoices) {
    const rawName = (inv.company || inv.clientName || '').trim().toLowerCase()
    if (!rawName) { skipped++; continue }

    // Try direct name match first
    let accountId = byName.get(rawName)

    // Try override map
    if (!accountId) {
      const override = overrides[rawName]
      if (override === null) { skipped++; continue } // intentionally skipped
      if (override) accountId = byName.get(override)
    }

    if (accountId) {
      await prisma.invoice.update({ where: { id: inv.id }, data: { accountId } })
      mapped++
    } else {
      unmapped.add(inv.company || inv.clientName || '')
      skipped++
    }
  }

  console.log(`   ✓ Mapped: ${mapped}  |  Skipped (no match): ${skipped}`)
  if (unmapped.size > 0) {
    console.log('\n── Unmapped company names (no account exists):')
    Array.from(unmapped).sort().forEach(n => console.log(`   • ${n}`))
    console.log('\n   TIP: Create accounts for these or they will stay unlinked.')
  }
}

async function main() {
  // ── Merge: BI → Boehringer Ingelheim
  await mergeAccounts(
    'cmmltyai8002zxwwlprcliyjr',  // keep: Boehringer Ingelheim
    'cmmavp66l001dj2k2alk6585w',  // delete: BI
    'BI → Boehringer Ingelheim'
  )

  // ── Merge: Lilly → Eli Lilly
  await mergeAccounts(
    'cmmltyajp00a5xwwlpkngjp76',  // keep: Eli Lilly
    'cmmltyal500gvxwwlrq9elywa',  // delete: Lilly
    'Lilly → Eli Lilly'
  )

  // ── Merge: empty Intas → active Intas
  await mergeAccounts(
    'cmmltyajd008fxwwljvxn0ose',  // keep: Intas (18 opps)
    'cmmn0vsuu000990n7uh532whd',  // delete: Intas (0 opps)
    'Intas duplicate'
  )

  // ── Map invoice companies to accounts
  await mapInvoiceCompanies()

  // ── Final summary
  const [total, linked] = await Promise.all([
    prisma.invoice.count(),
    prisma.invoice.count({ where: { accountId: { not: null } } }),
  ])
  console.log(`\n✓ Final: ${linked}/${total} invoices linked to accounts (${Math.round(linked/total*100)}%)`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
