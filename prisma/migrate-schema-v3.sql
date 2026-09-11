-- ============================================================
-- Schema Migration v3: Lead taxonomy + POC CRM (commit 1ff1dc8)
-- Run BEFORE `yarn db:push` when upgrading from pre-1ff1dc8 schema.
--
-- Maps:  meeting/quote_pi -> proposal, renewal -> cold
-- Creates Poc table and migrates Opportunity.clientPoc (text) -> clientPocId
-- Preserves expectedFY as expectedKickoff (April 1 of FY start)
-- Safe: additive first, data migrated, old columns dropped by db push last
-- ============================================================

-- STEP 1: Remap enum values still stored in rows (old taxonomy -> new)
UPDATE "Opportunity"
SET "leadStage" = 'proposal'::"LeadStage"
WHERE "leadStage"::text IN ('meeting', 'quote_pi');

UPDATE "Activity"
SET "stageOverride" = 'proposal'::"LeadStage"
WHERE "stageOverride"::text IN ('meeting', 'quote_pi');

-- Add 'cold' if missing (renewal -> cold); ignore error if value already exists
DO $$ BEGIN
  ALTER TYPE "LeadType" ADD VALUE 'cold';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE "Opportunity"
SET "leadType" = 'cold'::"LeadType"
WHERE "leadType"::text = 'renewal';

-- STEP 2: Create Poc table (must exist before migrating clientPoc text)
CREATE TABLE IF NOT EXISTS "Poc" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "accountId"   TEXT NOT NULL,
  "email"       TEXT,
  "phone"       TEXT,
  "designation" TEXT,
  "division"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Poc_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Poc_accountId_idx" ON "Poc"("accountId");

DO $$ BEGIN
  ALTER TABLE "Poc"
    ADD CONSTRAINT "Poc_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- STEP 3: Add new Opportunity columns (db push expects these; safe if already present)
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "clientPocId"     TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "probability"     INTEGER;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "expectedKickoff" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Opportunity_clientPocId_idx" ON "Opportunity"("clientPocId");

-- STEP 4: Migrate free-text clientPoc -> Poc rows + clientPocId
-- (skip if clientPoc text column was already dropped)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Opportunity'
      AND column_name = 'clientPoc'
  ) THEN
    INSERT INTO "Poc" ("id", "name", "accountId", "createdAt", "updatedAt")
    SELECT
      'poc_' || substr(md5(d."accountId" || '|' || d.poc_name), 1, 22),
      d.poc_name,
      d."accountId",
      NOW(),
      NOW()
    FROM (
      SELECT DISTINCT TRIM("clientPoc") AS poc_name, "accountId"
      FROM "Opportunity"
      WHERE "clientPoc" IS NOT NULL AND TRIM("clientPoc") <> ''
    ) d
    WHERE NOT EXISTS (
      SELECT 1 FROM "Poc" p
      WHERE p."accountId" = d."accountId" AND p."name" = d.poc_name
    );

    UPDATE "Opportunity" o
    SET "clientPocId" = p."id"
    FROM "Poc" p
    WHERE TRIM(o."clientPoc") = p."name"
      AND o."accountId" = p."accountId"
      AND o."clientPoc" IS NOT NULL
      AND o."clientPocId" IS NULL;
  END IF;
END $$;

-- STEP 5: Preserve expectedFY as expectedKickoff (FY 25-26 -> 2025-04-01)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Opportunity'
      AND column_name = 'expectedFY'
  ) THEN
    UPDATE "Opportunity"
    SET "expectedKickoff" = MAKE_DATE(
      2000 + SUBSTRING("expectedFY" FROM 4 FOR 2)::int,
      4,
      1
    )
    WHERE "expectedKickoff" IS NULL
      AND "expectedFY" ~ '^FY [0-9]{2}-[0-9]{2}$';
  END IF;
END $$;

-- STEP 6: Invoice.opportunityId (additive; db push will wire FK if missing)
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;
CREATE INDEX IF NOT EXISTS "Invoice_opportunityId_idx" ON "Invoice"("opportunityId");

-- Verify:
-- SELECT "leadStage", COUNT(*) FROM "Opportunity" GROUP BY 1 ORDER BY 1;
-- SELECT "leadType", COUNT(*) FROM "Opportunity" GROUP BY 1 ORDER BY 1;
-- SELECT COUNT(*) AS unmigrated_pocs FROM "Opportunity" o
--   WHERE o."clientPocId" IS NULL
--     AND EXISTS (SELECT 1 FROM information_schema.columns
--       WHERE table_name='Opportunity' AND column_name='clientPoc')
--     AND o."clientPoc" IS NOT NULL AND TRIM(o."clientPoc") <> '';
