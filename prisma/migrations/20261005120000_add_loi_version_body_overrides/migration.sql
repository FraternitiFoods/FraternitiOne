-- plan.md section 19 L3: per-version section-wording overrides for a DRAFT
-- LoiVersion. Nullable JSON, absent key = use the template's own text.

-- AlterTable
ALTER TABLE "LoiVersion" ADD COLUMN "bodyOverrides" JSONB;
