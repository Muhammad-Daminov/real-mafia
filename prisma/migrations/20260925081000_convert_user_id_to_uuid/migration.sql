-- Convert "User"."id" from SERIAL integer to UUID, and every FK that
-- references it (rooms.creator_user_id, game_players.user_id).
--
-- Why now: Master TZ §33's schema uses uuid primary keys throughout, and the
-- Phase 2 tables (rooms/games/game_players/game_phases) already do. Leaving
-- "User" on an integer PK left the only mixed-type FKs in the schema, and the
-- conversion gets strictly more expensive with every table added.
--
-- UUID version: v4 via gen_random_uuid() for the one-time backfill below.
-- PostgreSQL 16 (this deployment) has no native uuidv7() — that arrived in
-- PG18 — so a server-side v7 default is not available. New rows get UUIDv7
-- generated client-side by Prisma's `@default(uuid(7))`, matching the
-- no-DB-default convention the other uuid tables already use. Only the single
-- pre-existing row carries a v4 id.
--
-- DESTRUCTIVE: integer ids are not preserved. Accepted deliberately while the
-- table holds one row and the dependent tables are empty.
-- See docs/audit/GAP_REPORT.md F-05.

-- 1. Stage the new uuid values.
ALTER TABLE "User" ADD COLUMN "id_uuid" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "rooms" ADD COLUMN "creator_user_id_uuid" UUID;
ALTER TABLE "game_players" ADD COLUMN "user_id_uuid" UUID;

-- 2. Carry existing relationships across by joining on the old integer id.
UPDATE "rooms" r
   SET "creator_user_id_uuid" = u."id_uuid"
  FROM "User" u
 WHERE r."creator_user_id" = u."id";

UPDATE "game_players" gp
   SET "user_id_uuid" = u."id_uuid"
  FROM "User" u
 WHERE gp."user_id" = u."id";

-- 3. Release the old integer columns (drops their FKs and dependent indexes).
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_creator_user_id_fkey";
ALTER TABLE "game_players" DROP CONSTRAINT "game_players_user_id_fkey";
ALTER TABLE "rooms" DROP COLUMN "creator_user_id";
ALTER TABLE "game_players" DROP COLUMN "user_id";

ALTER TABLE "User" DROP CONSTRAINT "User_pkey";
ALTER TABLE "User" DROP COLUMN "id";

-- 4. Promote the uuid columns into place.
ALTER TABLE "User" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "rooms" RENAME COLUMN "creator_user_id_uuid" TO "creator_user_id";
ALTER TABLE "game_players" RENAME COLUMN "user_id_uuid" TO "user_id";

-- 5. Restore constraints. The DB-side default is dropped so id generation
--    stays with Prisma (`@default(uuid(7))`), consistent with rooms/games/
--    game_players/game_phases, none of which carry a DB default either.
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");

ALTER TABLE "rooms" ALTER COLUMN "creator_user_id" SET NOT NULL;
ALTER TABLE "game_players" ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_creator_user_id_fkey"
  FOREIGN KEY ("creator_user_id") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "game_players"
  ADD CONSTRAINT "game_players_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Recreate the membership uniqueness dropped along with the old column
--    (§8.4: one GamePlayer row per user per game).
CREATE UNIQUE INDEX "game_players_game_id_user_id_key"
  ON "game_players" ("game_id", "user_id");
