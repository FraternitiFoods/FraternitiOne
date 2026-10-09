-- CreateTable
CREATE TABLE "BoardDigestRun" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardDigestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardDigestRun_weekStart_key" ON "BoardDigestRun"("weekStart");
