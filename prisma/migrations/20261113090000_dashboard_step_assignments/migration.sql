-- CreateTable
CREATE TABLE "DashboardStepAssignment" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardStepAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DashboardStepAssignment_userId_idx" ON "DashboardStepAssignment"("userId");

-- CreateIndex
CREATE INDEX "DashboardStepAssignment_stepId_idx" ON "DashboardStepAssignment"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardStepAssignment_stepId_userId_key" ON "DashboardStepAssignment"("stepId", "userId");

-- AddForeignKey
ALTER TABLE "DashboardStepAssignment" ADD CONSTRAINT "DashboardStepAssignment_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "DashboardStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardStepAssignment" ADD CONSTRAINT "DashboardStepAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardStepAssignment" ADD CONSTRAINT "DashboardStepAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
