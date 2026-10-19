-- CreateIndex
CREATE INDEX "scheduled_tasks_status_kind_run_at_idx" ON "scheduled_tasks"("status", "kind", "run_at");

-- CreateIndex
CREATE INDEX "scheduled_tasks_status_kind_lease_expires_at_idx" ON "scheduled_tasks"("status", "kind", "lease_expires_at");
