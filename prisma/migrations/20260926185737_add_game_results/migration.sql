-- CreateEnum
CREATE TYPE "WinnerTeam" AS ENUM ('TOWN', 'MAFIA', 'NEUTRAL', 'DRAW');

-- CreateTable
CREATE TABLE "game_results" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "winner_team" "WinnerTeam" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_results_game_id_key" ON "game_results"("game_id");

-- AddForeignKey
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
