-- Close the gap between the Prisma schema's non-null String[] and the
-- actual DB constraint, which 20261021060659_user_category_to_array left
-- nullable. A NULL here crashes every .category.map()/.length call site
-- that correctly assumes an array per the schema's own contract.
UPDATE "User" SET "category" = ARRAY[]::TEXT[] WHERE "category" IS NULL;
ALTER TABLE "User" ALTER COLUMN "category" SET NOT NULL;
