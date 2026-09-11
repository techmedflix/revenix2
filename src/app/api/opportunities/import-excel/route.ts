export const preferredRegion = 'sin1'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { defaultProbabilityFor } from '@/lib/opportunityStages'
import * as XLSX from 'xlsx'

/**
 * Columns must match downloadOrderBookTemplate() in OrderBookClient.tsx exactly:
 * 0  Company Name        (required — matched by name, created if missing)
 * 1  Division / Cluster  (optional — matched by name under the company, created if missing)
 * 2  Client POC          (optional — matched by name under the company, created if missing)
 * 3  Medical (Yes/No)
 * 4  Project Category
 * 5  Project Type        (required)
 * 6  Description
 * 7  Revenue (INR)
 * 8  Cost (INR)
 * 9  Lead Type           (won/hot/warm/cold/lost)
 * 10 Lead Stage          (proposal/commissioned)
 * 11 Expected Kick-off Date (YYYY-MM-DD)
 * 12 Owner Email         (optional — falls back to the importing user)
 */

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function num(v: unknown): number {
  const n = parseFloat(str(v).replace(/[₹,\s]/g, ''))
  return isNaN(n) ? 0 : n
}

function mapLeadType(raw: string): 'won' | 'hot' | 'warm' | 'cold' | 'lost' | null {
  const s = raw.toLowerCase().trim()
  if (s === 'won')  return 'won'
  if (s === 'hot')  return 'hot'
  if (s === 'warm') return 'warm'
  if (s === 'cold') return 'cold'
  if (s === 'lost') return 'lost'
  return null
}

function mapLeadStage(raw: string): 'proposal' | 'pilot' | 'commissioned' {
  const s = raw.toLowerCase().replace(/[\s\-\/]/g, '')
  if (s === 'commissioned') return 'commissioned'
  if (s === 'pilot') return 'pilot'
  return 'proposal'
}

function parseDate(raw: string): Date | null {
  if (!raw || raw === '-') return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return NextResponse.json({ error: 'Empty workbook' }, { status: 400 })

    const sheet = workbook.Sheets[sheetName]
    const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' })

    const dataRows = rawRows.slice(1).filter(r => str(r[0]) || str(r[5]))

    // Get the current user (fallback owner when no Owner Email is given / matched)
    const dbUser = await prisma.user.findUnique({ where: { email: session.user?.email! } })
    if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 400 })
    const fallbackOwnerId = dbUser.id

    // Cache accounts, POCs and users to avoid repeated DB hits
    const accountCache = new Map<string, string>()
    const pocCache = new Map<string, string>()
    const userCache = new Map<string, string>()

    async function getOrCreateCompany(name: string): Promise<string> {
      const normalized = name.trim()
      const key = `company:${normalized.toLowerCase()}`
      if (accountCache.has(key)) return accountCache.get(key)!
      const existing = await prisma.account.findFirst({ where: { name: { equals: normalized, mode: 'insensitive' }, type: 'company' } })
      if (existing) {
        accountCache.set(key, existing.id)
        return existing.id
      }
      const created = await prisma.account.create({ data: { name: normalized, type: 'company' } })
      accountCache.set(key, created.id)
      return created.id
    }

    async function getOrCreateDivision(name: string, companyId: string): Promise<string> {
      const normalized = name.trim()
      const key = `division:${companyId}:${normalized.toLowerCase()}`
      if (accountCache.has(key)) return accountCache.get(key)!
      const existing = await prisma.account.findFirst({
        where: { name: { equals: normalized, mode: 'insensitive' }, type: 'division', parentId: companyId },
      })
      if (existing) {
        accountCache.set(key, existing.id)
        return existing.id
      }
      const created = await prisma.account.create({ data: { name: normalized, type: 'division', parentId: companyId } })
      accountCache.set(key, created.id)
      return created.id
    }

    async function getOrCreatePoc(name: string, companyId: string): Promise<string | null> {
      const normalized = name.trim()
      if (!normalized) return null
      const key = `poc:${companyId}:${normalized.toLowerCase()}`
      if (pocCache.has(key)) return pocCache.get(key)!
      const existing = await prisma.poc.findFirst({
        where: { name: { equals: normalized, mode: 'insensitive' }, accountId: companyId },
      })
      if (existing) {
        pocCache.set(key, existing.id)
        return existing.id
      }
      const created = await prisma.poc.create({ data: { name: normalized, accountId: companyId } })
      pocCache.set(key, created.id)
      return created.id
    }

    async function resolveOwnerId(email: string): Promise<string> {
      const normalized = email.trim().toLowerCase()
      if (!normalized) return fallbackOwnerId
      if (userCache.has(normalized)) return userCache.get(normalized)!
      const user = await prisma.user.findUnique({ where: { email: normalized } })
      const id = user?.id || fallbackOwnerId
      userCache.set(normalized, id)
      return id
    }

    let imported = 0, skipped = 0
    const errors: string[] = []

    for (const row of dataRows) {
      try {
        const companyName = str(row[0])
        const projectType = str(row[5])
        if (!companyName || !projectType) { skipped++; continue }

        const companyId = await getOrCreateCompany(companyName)
        const divisionName = str(row[1])
        const accountId = divisionName ? await getOrCreateDivision(divisionName, companyId) : companyId
        const clientPocId = await getOrCreatePoc(str(row[2]), companyId)

        const ownerId = await resolveOwnerId(str(row[12]))
        const expectedKickoff = parseDate(str(row[11]))
        const leadType = mapLeadType(str(row[9]))

        await prisma.opportunity.create({
          data: {
            accountId,
            ownerId,
            projectType,
            projectCategory: str(row[4]) || '',
            clientType: 'new',
            leadType,
            probability: defaultProbabilityFor(leadType),
            leadStage: mapLeadStage(str(row[10])),
            estimatedValue: num(row[7]),
            estimatedCost: num(row[8]),
            expectedKickoff: expectedKickoff ? expectedKickoff.toISOString() : null,
            description: str(row[6]) || null,
            clientPocId,
            medical: str(row[3]).toLowerCase() === 'yes',
          },
        })
        imported++
      } catch (e) {
        skipped++
        if (errors.length < 10) errors.push(String(e))
      }
    }

    return NextResponse.json({ imported, skipped, errors })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
