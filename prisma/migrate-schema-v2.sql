-- ============================================================
-- Schema Migration v2: Opportunity field restructure
-- Replaces: stage (OpportunityStage), leadType (String), invoiceStage (InvoiceStage)
-- Adds:     clientType (ClientType), leadType (LeadType), leadStage (LeadStage)
-- Safe: additive first, data migrated, old columns dropped last
-- ============================================================

-- STEP 1: Create new enum types
CREATE TYPE "ClientType" AS ENUM ('new', 'existing');
CREATE TYPE "LeadType"   AS ENUM ('won', 'hot', 'warm', 'renewal', 'lost');
CREATE TYPE "LeadStage"  AS ENUM ('meeting', 'proposal', 'quote_pi', 'commissioned');

-- STEP 2: Add new columns (nullable, no conflict yet)
ALTER TABLE "Opportunity" ADD COLUMN "clientType"   "ClientType";
ALTER TABLE "Opportunity" ADD COLUMN "leadType_new" "LeadType";
ALTER TABLE "Opportunity" ADD COLUMN "leadStage"    "LeadStage";

-- STEP 3: Migrate clientType from old string leadType column
UPDATE "Opportunity"
SET "clientType" = CASE
  WHEN "leadType" = 'existing' THEN 'existing'::"ClientType"
  ELSE 'new'::"ClientType"
END;

-- STEP 4: Migrate new leadType (outcome/temperature) from old stage column
UPDATE "Opportunity"
SET "leadType_new" = CASE
  WHEN "stage"::text = 'won'              THEN 'won'::"LeadType"
  WHEN "stage"::text = 'lost'             THEN 'lost'::"LeadType"
  WHEN "stage"::text = 'hot'              THEN 'hot'::"LeadType"
  WHEN "stage"::text = 'warm'             THEN 'warm'::"LeadType"
  WHEN "stage"::text = 'renewal'          THEN 'renewal'::"LeadType"
  WHEN "stage"::text = 'commissioned'     THEN 'won'::"LeadType"
  WHEN "stage"::text = 'partial_invoiced' THEN 'won'::"LeadType"
  WHEN "stage"::text = 'invoiced'         THEN 'won'::"LeadType"
  ELSE NULL
END;

-- STEP 5: Migrate leadStage from old stage column
UPDATE "Opportunity"
SET "leadStage" = CASE
  WHEN "stage"::text = 'ideation'         THEN 'meeting'::"LeadStage"
  WHEN "stage"::text = 'warm'             THEN 'meeting'::"LeadStage"
  WHEN "stage"::text = 'hot'              THEN 'meeting'::"LeadStage"
  WHEN "stage"::text = 'proposal'         THEN 'proposal'::"LeadStage"
  WHEN "stage"::text = 'quote'            THEN 'quote_pi'::"LeadStage"
  WHEN "stage"::text = 'pi'              THEN 'quote_pi'::"LeadStage"
  WHEN "stage"::text = 'renewal'          THEN 'proposal'::"LeadStage"
  WHEN "stage"::text = 'won'              THEN 'commissioned'::"LeadStage"
  WHEN "stage"::text = 'lost'             THEN NULL
  WHEN "stage"::text = 'commissioned'     THEN 'commissioned'::"LeadStage"
  WHEN "stage"::text = 'partial_invoiced' THEN 'commissioned'::"LeadStage"
  WHEN "stage"::text = 'invoiced'         THEN 'commissioned'::"LeadStage"
  ELSE 'meeting'::"LeadStage"
END;

-- STEP 6: Migrate Activity.stageOverride (OpportunityStage -> LeadStage)
ALTER TABLE "Activity" ADD COLUMN "stageOverride_new" "LeadStage";

UPDATE "Activity"
SET "stageOverride_new" = CASE
  WHEN "stageOverride"::text = 'ideation'         THEN 'meeting'::"LeadStage"
  WHEN "stageOverride"::text = 'warm'             THEN 'meeting'::"LeadStage"
  WHEN "stageOverride"::text = 'hot'              THEN 'meeting'::"LeadStage"
  WHEN "stageOverride"::text = 'proposal'         THEN 'proposal'::"LeadStage"
  WHEN "stageOverride"::text = 'quote'            THEN 'quote_pi'::"LeadStage"
  WHEN "stageOverride"::text = 'pi'              THEN 'quote_pi'::"LeadStage"
  WHEN "stageOverride"::text = 'renewal'          THEN 'proposal'::"LeadStage"
  WHEN "stageOverride"::text = 'won'              THEN 'commissioned'::"LeadStage"
  WHEN "stageOverride"::text = 'lost'             THEN NULL
  WHEN "stageOverride"::text = 'commissioned'     THEN 'commissioned'::"LeadStage"
  WHEN "stageOverride"::text = 'partial_invoiced' THEN 'commissioned'::"LeadStage"
  WHEN "stageOverride"::text = 'invoiced'         THEN 'commissioned'::"LeadStage"
  ELSE NULL
END
WHERE "stageOverride" IS NOT NULL;

ALTER TABLE "Activity" DROP COLUMN "stageOverride";
ALTER TABLE "Activity" RENAME COLUMN "stageOverride_new" TO "stageOverride";

-- STEP 7: Fill defaults for any NULLs
UPDATE "Opportunity" SET "clientType" = 'new'::"ClientType"    WHERE "clientType" IS NULL;
UPDATE "Opportunity" SET "leadStage"  = 'meeting'::"LeadStage" WHERE "leadStage" IS NULL;

-- STEP 8: Drop old columns (stage, old leadType string, invoiceStage)
ALTER TABLE "Opportunity" DROP COLUMN "stage";
ALTER TABLE "Opportunity" DROP COLUMN "leadType";       -- old String? column
ALTER TABLE "Opportunity" DROP COLUMN "invoiceStage";

-- STEP 9: Rename leadType_new -> leadType
ALTER TABLE "Opportunity" RENAME COLUMN "leadType_new" TO "leadType";

-- STEP 10: Drop old enum types
DROP TYPE IF EXISTS "OpportunityStage";
DROP TYPE IF EXISTS "InvoiceStage";

-- STEP 11: Add indexes
CREATE INDEX IF NOT EXISTS "Opportunity_leadStage_idx" ON "Opportunity"("leadStage");
CREATE INDEX IF NOT EXISTS "Opportunity_leadType_idx"  ON "Opportunity"("leadType");

-- Verify:
-- SELECT "clientType", "leadType", "leadStage", COUNT(*) FROM "Opportunity" GROUP BY 1,2,3 ORDER BY 3,2,1;
