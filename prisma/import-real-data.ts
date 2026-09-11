import { PrismaClient, OpportunityStage, InvoiceStatus } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as fs from 'fs'

const prisma = new PrismaClient()

function getFY(date: Date): string {
  const m = date.getMonth() + 1
  const y = date.getFullYear()
  if (m >= 4) return `FY ${String(y).slice(2)}-${String(y + 1).slice(2)}`
  return `FY ${String(y - 1).slice(2)}-${String(y).slice(2)}`
}

function parseINR(v: any): number {
  if (v == null || v === '') return 0
  const n = parseFloat(String(v).replace(/[₹,\s]/g, '').trim())
  return isNaN(n) ? 0 : n
}

function parseDate(v: any): Date | null {
  if (!v) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  const s = String(v).trim()
  if (!s || s === 'NaT' || s === '#REF!' || s === 'Invalid Date') return null
  // "1-Apr-2020" format
  const months: Record<string, number> = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
  }
  const m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/)
  if (m) {
    const mo = months[m[2].toLowerCase()]
    if (mo !== undefined) return new Date(parseInt(m[3]), mo, parseInt(m[1]))
  }
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  // Reject obviously wrong dates (outside 2000-2035 range)
  const yr = d.getFullYear()
  if (yr < 2000 || yr > 2035) return null
  return d
}

function normalizeFY(raw: any): string {
  if (!raw) return ''
  const s = String(raw).trim()
  if (s === '#REF!' || s === '') return ''
  const m4 = s.match(/FY\s+20(\d{2})-20?(\d{2})/)
  if (m4) return `FY ${m4[1]}-${m4[2]}`
  if (/FY \d{2}-\d{2}/.test(s)) return s
  return ''
}

function mapEngagementToCategory(eng: string): string {
  const e = (eng || '').toLowerCase()
  if (e.includes('virtual') || e.includes('webinar')) return 'virtual_events'
  if (e.includes('hybrid')) return 'hybrid_events'
  if (e.includes('f2f') || e.includes('physical') || e.includes('face')) return 'f2f_events'
  if (e.includes('research') || e.includes('rapid review')) return 'research'
  if (e.includes('content') || e.includes('program') || e.includes('newsfeed') || e.includes('ads')) return 'content'
  return 'custom'
}

function mapLeadStatus(status: string): OpportunityStage {
  const s = (status || '').toLowerCase().trim()
  const map: Record<string, OpportunityStage> = {
    won:'commissioned', invoiced:'invoiced',
    lost:'lost',
    hot:'hot',
    warm:'warm',
    cold:'warm',
    hold:'warm',
    renewal:'renewal',
    commissioned:'commissioned',
    partial_invoiced:'partial_invoiced',
  }
  return map[s] || 'warm'
}

function mapInvoiceStatus(invoiceType: string, statusRaw: string): InvoiceStatus {
  const t = (invoiceType||'').toLowerCase().trim()
  const s = (statusRaw||'').toLowerCase().trim()
  if (t === 'cancelled') return 'cancelled'
  if (t === 'credit note') return 'credit_note'
  if (s === 'recd' || s === 'received') return 'paid'
  if (s === 'not recd' || s === 'receivables') return 'sent'
  if (s === 'cancelled') return 'cancelled'
  if (s === 'credit note') return 'credit_note'
  return 'draft'
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current); current = '' }
    else { current += ch }
  }
  result.push(current)
  return result
}

async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║      MedOS Real Data Import              ║')
  console.log('╚══════════════════════════════════════════╝')

  // ── 1. Ensure all POC users exist ─────────────────────────────────────────
  console.log('\n[1/5] Ensuring POC users...')
  const pocUsers = [
    { name: 'Tanvi',    email: 'tanvi@medflix.app' },
    { name: 'Heily',    email: 'heily@medflix.app' },
    { name: 'Shubham',  email: 'shubham@medflix.app' },
    { name: 'Vrushali', email: 'vrushali@medflix.app' },
    { name: 'Snehal',   email: 'snehal@medflix.app' },
  ]
  for (const u of pocUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, role: 'sales', status: 'approved', approvedAt: new Date() },
    })
  }

  const allUsers = await prisma.user.findMany({ select: { id: true, name: true } })
  const chirag = allUsers.find(u => u.name === 'Chirag')
  if (!chirag) throw new Error('Chirag user not found')
  const defaultOwnerId = chirag.id

  const userByFirstName: Record<string, string> = {}
  for (const u of allUsers) {
    if (u.name) userByFirstName[u.name.toLowerCase()] = u.id
  }
  console.log(`  ✓ ${allUsers.length} users ready`)

  function resolveOwner(poc: string): string {
    const first = (poc || 'Chirag').split(/[/,&]/)[0].trim().toLowerCase()
    return userByFirstName[first] || defaultOwnerId
  }

  // ── 2. Clear dummy data ───────────────────────────────────────────────────
  console.log('\n[2/5] Clearing dummy/seed data...')
  await prisma.activity.deleteMany({})
  await prisma.receipt.deleteMany({})
  await prisma.invoice.updateMany({ data: { projectId: null } })
  await prisma.project.deleteMany({})
  await prisma.opportunity.deleteMany({})
  await prisma.invoice.deleteMany({})
  console.log('  ✓ Cleared')

  // ── 3. Account cache ──────────────────────────────────────────────────────
  const existingAccounts = await prisma.account.findMany({
    where: { type: 'company' },
    select: { id: true, name: true },
  })
  const accountCache: Record<string, string> = {}
  for (const a of existingAccounts) {
    accountCache[a.name.toLowerCase().trim()] = a.id
  }
  async function getOrCreateAccount(clientName: string): Promise<string> {
    const key = clientName.toLowerCase().trim()
    if (accountCache[key]) return accountCache[key]
    const acc = await prisma.account.create({ data: { name: clientName.trim(), type: 'company' } })
    accountCache[key] = acc.id
    return acc.id
  }

  // ── 4. Import Opportunities ───────────────────────────────────────────────
  console.log('\n[3/5] Importing leads...')
  const wb = XLSX.readFile('/Users/chirag/Downloads/Project Leads tracker.xlsx')
  const ws = wb.Sheets['Sheet2']
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as any[]

  let oppCreated = 0, oppSkipped = 0
  for (const row of rows) {
    const clientName = row['Client']
    if (!clientName || String(clientName).trim() === '') { oppSkipped++; continue }

    const engagement  = String(row['Engagement'] || 'Others').trim()
    const specifics   = row['Specifics']   ? String(row['Specifics']).trim()   : null
    const clientLead  = row['Client Lead'] ? String(row['Client Lead']).trim() : null
    const poc         = row['POC']         ? String(row['POC']).trim()         : 'Chirag'
    const leadStatus  = String(row['Lead Status'] || 'warm').trim()
    const value       = parseFloat(row['Value'])       || 0
    const cost        = parseFloat(row['Direct Cost']) || 0
    const expectedBy  = parseDate(row['Expected By'])
    const fyRaw       = row['FY']

    const accountId  = await getOrCreateAccount(String(clientName).trim())
    const ownerId    = resolveOwner(poc)
    const stage      = mapLeadStatus(leadStatus)
    const category   = mapEngagementToCategory(engagement)
    const expectedFY = normalizeFY(fyRaw) || getFY(new Date())

    await prisma.opportunity.create({
      data: {
        accountId, ownerId,
        projectCategory: category,
        projectType: engagement,
        estimatedValue: value,
        estimatedCost: cost,
        stage, expectedFY,
        nextCallDate: expectedBy,
        clientPoc: clientLead,
        description: specifics,
        medical: false,
      },
    })
    oppCreated++
  }
  console.log(`  ✓ ${oppCreated} opportunities created  (${oppSkipped} skipped — no client name)`)

  // ── 5. Import Invoices ────────────────────────────────────────────────────
  console.log('\n[4/5] Importing invoices...')
  const csvText    = fs.readFileSync('/Users/chirag/Downloads/Invoicing 2020 to 2026.csv', 'utf-8')
  const csvLines   = csvText.split('\n')
  const csvHeaders = parseCSVLine(csvLines[0]).map(h => h.trim().replace(/^"|"$/g, ''))

  let invCreated = 0, invSkipped = 0
  for (let i = 1; i < csvLines.length; i++) {
    const line = csvLines[i].trim()
    if (!line) continue

    const cols = parseCSVLine(line)
    const r: Record<string, string> = {}
    csvHeaders.forEach((h, idx) => { r[h] = (cols[idx] || '').trim().replace(/^"|"$/g, '') })

    const invNo = r['Inv #']
    if (!invNo) { invSkipped++; continue }

    const invDate = parseDate(r['Inv Date'])
    if (!invDate) { invSkipped++; continue }

    const invoiceType = r['Invoice type'] || 'Regular'
    const status      = mapInvoiceStatus(invoiceType, r['Status?'] || '')
    const docType     = invoiceType === 'Credit Note' ? 'CN' : 'INV'
    const entity      = invNo.startsWith('MX') ? 'Medflix' : 'PMD'

    const gross = parseINR(r['Gross Revenue'])
    const disc  = parseINR(r['Discount'])
    const net   = parseINR(r['Net Revenue']) || Math.max(0, gross - disc)
    const gst   = parseINR(r['S. Tax/GST'])
    const amt   = parseINR(r['Invoice amount']) || (net + gst)
    const gstRate = net > 0 ? Math.round((gst / net) * 100) : 18

    let creditDays = 45
    const cdRaw = (r['Credit Days'] || '').trim()
    if (/^\d+$/.test(cdRaw)) creditDays = parseInt(cdRaw, 10)

    const expectedDate = parseDate(r['Expected Date'])
    const fallbackDue  = new Date(invDate)
    fallbackDue.setDate(fallbackDue.getDate() + creditDays)
    const dueDate = expectedDate || fallbackDue

    const gstId  = r['GST ID'] && r['GST ID'] !== 'Not Available' ? r['GST ID'] : null
    const sacRaw = r['SAC/ HSN'] || ''
    const sac    = sacRaw ? sacRaw.split(/[&,]/)[0].trim() || null : null
    const fy     = getFY(invDate)
    const amountReceived = (status === 'paid' || status === 'credit_note') ? amt : 0

    await prisma.invoice.create({
      data: {
        entity: entity as any,
        docType: docType as any,
        invNo,
        date: invDate,
        fy,
        clientName: r['Client name'] || null,
        company: r['Company Name'] || null,
        gstId,
        state: r['State Place of Supply'] || null,
        creditDays,
        offeringName: r['Offering'] || null,
        sac,
        desc: r['Particulars'] || null,
        currency: 'INR',
        fxRate: 1,
        gross, disc, net, gstRate, gst, amt,
        dueDate,
        status: status as any,
        comments: r['Comments'] || null,
        amountReceived,
      },
    })
    invCreated++
  }
  console.log(`  ✓ ${invCreated} invoices created  (${invSkipped} skipped)`)

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n[5/5] Final counts:')
  console.log(`  Opportunities : ${await prisma.opportunity.count()}`)
  console.log(`  Invoices      : ${await prisma.invoice.count()}`)
  console.log(`  Accounts      : ${await prisma.account.count()}`)
  console.log(`  Users         : ${await prisma.user.count()}`)
  console.log('\n✅ Import complete!')
}

main()
  .catch(e => { console.error('❌', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
