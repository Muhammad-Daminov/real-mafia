-- CreateEnum
CREATE TYPE "RoomVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "RulesetMode" AS ENUM ('NORMAL', 'FAST');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('DRAFT', 'LOBBY', 'RUNNING', 'PAUSED', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GamePhaseName" AS ENUM ('LOBBY', 'ROLE_REVEAL', 'NIGHT', 'NIGHT_RESOLUTION', 'MORNING', 'DISCUSSION', 'VOTING', 'VOTE_RESOLUTION', 'LAST_WORD', 'EXECUTION', 'WIN_CHECK', 'GAME_OVER');

-- CreateEnum
CREATE TYPE "LifeStatus" AS ENUM ('WAITING', 'ALIVE', 'DEAD', 'LEFT');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "visibility" "RoomVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "RoomStatus" NOT NULL DEFAULT 'OPEN',
    "ruleset_mode" "RulesetMode" NOT NULL DEFAULT 'NORMAL',
    "max_players" INTEGER NOT NULL,
    "creator_user_id" INTEGER NOT NULL,
    "telegram_group_id" TEXT,
    "active_game_id" UUID,
    "code_released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'LOBBY',
    "current_phase" "GamePhaseName" NOT NULL DEFAULT 'LOBBY',
    "round" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "rules_version" TEXT,
    "config_snapshot" JSONB,
    "host_player_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_players" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "life_status" "LifeStatus" NOT NULL DEFAULT 'WAITING',
    "connection_status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "is_ready" BOOLEAN NOT NULL DEFAULT false,
    "is_chat_muted" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_phases" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "phase" "GamePhaseName" NOT NULL,
    "round" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "game_phases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rooms_active_game_id_key" ON "rooms"("active_game_id");

-- CreateIndex
CREATE INDEX "rooms_status_visibility_idx" ON "rooms"("status", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "games_host_player_id_key" ON "games"("host_player_id");

-- CreateIndex
CREATE INDEX "games_status_idx" ON "games"("status");

-- CreateIndex
CREATE INDEX "game_players_game_id_life_status_idx" ON "game_players"("game_id", "life_status");

-- CreateIndex
CREATE UNIQUE INDEX "game_players_game_id_user_id_key" ON "game_players"("game_id", "user_id");

-- CreateIndex
CREATE INDEX "game_phases_game_id_round_idx" ON "game_phases"("game_id", "round");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_creator_user_id_fkey" FOREIGN KEY ("creator_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_active_game_id_fkey" FOREIGN KEY ("active_game_id") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_host_player_id_fkey" FOREIGN KEY ("host_player_id") REFERENCES "game_players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_phases" ADD CONSTRAINT "game_phases_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Raw-SQL constructs required by Master TZ §33.3
--
-- Prisma's schema language cannot express partial unique indexes or CHECK
-- constraints, so they are declared here. They are not decoration: each one is
-- the enforcement mechanism for a named spec invariant, and the schema is
-- wrong without them.
-- ===========================================================================

-- §33.3 item 1 / §8.3: exactly one active game per room.
-- The application also maintains rooms.active_game_id, but THIS index is the
-- authority — it holds even against two concurrent transactions that both pass
-- an application-level check.
CREATE UNIQUE INDEX "games_one_active_per_room"
  ON "games" ("room_id")
  WHERE "status" IN ('DRAFT', 'LOBBY', 'RUNNING', 'PAUSED');

-- §33.3 item 8 / §8.1: room `code` is unique among rooms that are not CLOSED.
-- A closed room keeps its row forever (§33.1, never deleted) but releases the
-- code back into the pool, so the uniqueness scope must exclude CLOSED.
CREATE UNIQUE INDEX "rooms_code_unique_while_open"
  ON "rooms" ("code")
  WHERE "status" <> 'CLOSED';

-- §33.3 item 2: at most one active (not yet ended) phase per game.
-- `game_phases.ends_at` is the sole timer authority (§19), which is only
-- meaningful if a game cannot have two live phases at once.
CREATE UNIQUE INDEX "game_phases_one_active_per_game"
  ON "game_phases" ("game_id")
  WHERE "ended_at" IS NULL;

-- §8.1 / §13.1: the engine is built for the full 4–24 range from day one; the
-- MVP's cap of 12 is a client affordance, not a server limit (§15.1).
ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_max_players_range"
  CHECK ("max_players" >= 4 AND "max_players" <= 24);

-- §9/§10: rounds start at 0 (pre-game) and only ever advance.
ALTER TABLE "games"
  ADD CONSTRAINT "games_round_non_negative" CHECK ("round" >= 0);
ALTER TABLE "game_phases"
  ADD CONSTRAINT "game_phases_round_non_negative" CHECK ("round" >= 0);

-- §33.3 item 3/7: the shared immutability trigger function for append-only
-- history tables. Declared here so every later slice attaches the SAME
-- function rather than inventing its own variant.
--
-- NOT attached to any table in this migration: the spec names game_events,
-- game_results, game_chat_messages and wallet_ledger_entries as the immutable
-- tables (§33.3), and none of those exist yet. rooms/games/game_players/
-- game_phases are mutable by design — they carry live state.
CREATE OR REPLACE FUNCTION "err_immutable_history"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ERR_IMMUTABLE_HISTORY: % rows are append-only and cannot be % (Master TZ §33.3)',
    TG_TABLE_NAME, lower(TG_OP);
END;
$$ LANGUAGE plpgsql;
