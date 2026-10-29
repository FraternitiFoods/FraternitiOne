-- CreateIndex
CREATE INDEX "PosOrder_projectId_receivedAt_idx" ON "PosOrder"("projectId", "receivedAt");

-- CreateIndex
CREATE INDEX "StoreOnboarding_kycStatus_idx" ON "StoreOnboarding"("kycStatus");

-- CreateIndex
CREATE INDEX "StoreOnboarding_onboardingStatus_idx" ON "StoreOnboarding"("onboardingStatus");

-- CreateIndex
CREATE INDEX "StoreOnboarding_paymentStatus_idx" ON "StoreOnboarding"("paymentStatus");

-- CreateIndex
CREATE INDEX "Task_module_idx" ON "Task"("module");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_completedAt_idx" ON "Task"("completedAt");

-- CreateIndex
CREATE INDEX "Task_slaDays_idx" ON "Task"("slaDays");
