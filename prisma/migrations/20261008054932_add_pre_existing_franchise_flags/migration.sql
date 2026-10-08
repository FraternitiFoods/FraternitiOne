-- AlterTable
ALTER TABLE "FranchiseProject" ADD COLUMN     "isPreExisting" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPreExistingFranchisee" BOOLEAN NOT NULL DEFAULT false;
