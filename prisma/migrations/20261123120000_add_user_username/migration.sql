-- AlterTable
-- Guarded: a prior unmerged/stashed migration already added this column to
-- the shared preview DB directly (never committed) — these guards make this
-- migration correct both there and on a fresh database that doesn't have it.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
