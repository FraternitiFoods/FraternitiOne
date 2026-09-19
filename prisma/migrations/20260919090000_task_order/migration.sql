-- Add ordering within a (project, lifecycleStage) group, for the swappable
-- task list in the stage dialog.
ALTER TABLE "Task" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows to their current creation order per stage.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "projectId", "lifecycleStage" ORDER BY "createdAt" ASC) - 1 AS rn
  FROM "Task"
)
UPDATE "Task" t
SET "order" = ranked.rn
FROM ranked
WHERE t.id = ranked.id;
