-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('MAFIA', 'DON', 'DETECTIVE', 'SHERIFF', 'DOCTOR', 'BODYGUARD', 'MANIAC', 'JOURNALIST', 'CIVILIAN');

-- CreateTable
CREATE TABLE "game_role_assignments" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "role_code" "RoleCode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_role_assignments_player_id_key" ON "game_role_assignments"("player_id");

-- CreateIndex
CREATE INDEX "game_role_assignments_game_id_idx" ON "game_role_assignments"("game_id");

-- AddForeignKey
ALTER TABLE "game_role_assignments" ADD CONSTRAINT "game_role_assignments_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_role_assignments" ADD CONSTRAINT "game_role_assignments_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "game_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
