-- CreateIndex
CREATE INDEX "rooms_visibility_status_created_at_idx" ON "rooms"("visibility", "status", "created_at" DESC);
