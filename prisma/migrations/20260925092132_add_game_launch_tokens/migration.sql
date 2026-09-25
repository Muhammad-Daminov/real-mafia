-- CreateTable
CREATE TABLE "game_launch_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "room_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "consumed_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_launch_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_launch_tokens_token_hash_key" ON "game_launch_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "game_launch_tokens_expires_at_idx" ON "game_launch_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "game_launch_tokens" ADD CONSTRAINT "game_launch_tokens_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_launch_tokens" ADD CONSTRAINT "game_launch_tokens_consumed_by_user_id_fkey" FOREIGN KEY ("consumed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- §22.2 rules enforced in the database, not only in application code.
-- ===========================================================================

-- "<= 15 min TTL". A token whose lifetime exceeds the ceiling cannot be
-- inserted at all, so the rule survives a future caller that forgets it.
ALTER TABLE "game_launch_tokens"
  ADD CONSTRAINT "game_launch_tokens_ttl_ceiling"
  CHECK ("expires_at" > "created_at"
     AND "expires_at" <= "created_at" + INTERVAL '15 minutes');

-- "single-use consumption recorded": the two consumption columns move
-- together — a row is either unconsumed (both null) or consumed (both set).
-- This makes a half-written consumption impossible to represent.
ALTER TABLE "game_launch_tokens"
  ADD CONSTRAINT "game_launch_tokens_consumption_consistent"
  CHECK (("used_at" IS NULL AND "consumed_by_user_id" IS NULL)
      OR ("used_at" IS NOT NULL AND "consumed_by_user_id" IS NOT NULL));

-- Unconsumed tokens are the hot path for the janitor's expiry sweep (§35).
CREATE INDEX "game_launch_tokens_unused_expiry"
  ON "game_launch_tokens" ("expires_at")
  WHERE "used_at" IS NULL;
