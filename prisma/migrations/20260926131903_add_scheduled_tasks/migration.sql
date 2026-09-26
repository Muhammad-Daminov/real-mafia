-- CreateEnum
CREATE TYPE "ScheduledTaskStatus" AS ENUM ('PENDING', 'LEASED', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledTaskStatus" NOT NULL DEFAULT 'PENDING',
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 10,
    "last_error" TEXT,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_tasks_status_run_at_idx" ON "scheduled_tasks"("status", "run_at");

-- CreateIndex
CREATE INDEX "scheduled_tasks_status_lease_expires_at_idx" ON "scheduled_tasks"("status", "lease_expires_at");

-- ===========================================================================
-- Raw-SQL construct, same discipline as Master TZ §33.3's rooms/games/
-- game_phases partial indexes (Prisma's schema language cannot express a
-- partial unique index).
-- ===========================================================================

-- OD-043: a caller-supplied dedupeKey is unique only while the task hasn't
-- reached a terminal status. This is what makes `SchedulerService.enqueue`
-- idempotent (e.g. "phase-advance:<gameId>") without ever blocking a *new*
-- task from being scheduled once the previous one with the same key is done
-- or has been abandoned.
CREATE UNIQUE INDEX "scheduled_tasks_dedupe_key_while_active"
  ON "scheduled_tasks" ("dedupe_key")
  WHERE "dedupe_key" IS NOT NULL AND "status" IN ('PENDING', 'LEASED');
