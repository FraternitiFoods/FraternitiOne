-- AlterTable
-- User.category goes from a single optional trade-category string to a list
-- (multi-select in the UI). Existing single values are preserved as
-- one-element arrays rather than dropped; NULL becomes an empty array, same
-- "no narrowing" meaning the column already had.
ALTER TABLE "User"
  ALTER COLUMN "category" DROP DEFAULT,
  ALTER COLUMN "category" TYPE TEXT[] USING (CASE WHEN "category" IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY["category"] END),
  ALTER COLUMN "category" SET DEFAULT ARRAY[]::TEXT[];
