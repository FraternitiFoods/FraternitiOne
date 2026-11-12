-- Sites created from Dashboard were inserted tracker-only (usedInBoq = false),
-- so they never showed in Site BOQ. Website is now the source of truth: make
-- them BOQ sites too. Narrow: only WEB- rows that have a website-origin DashboardSite.
UPDATE "Site"
SET "usedInBoq" = true
WHERE "usedInBoq" = false
  AND "sourceKey" LIKE 'WEB-%'
  AND "name" IN (SELECT "name" FROM "DashboardSite" WHERE "origin" = 'WEBSITE');
