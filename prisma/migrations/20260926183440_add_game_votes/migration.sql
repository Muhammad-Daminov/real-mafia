-- CreateTable
CREATE TABLE "game_votes" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "phase_id" UUID NOT NULL,
    "voter_player_id" UUID NOT NULL,
    "target_player_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_votes_game_id_phase_id_idx" ON "game_votes"("game_id", "phase_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_votes_game_id_phase_id_voter_player_id_key" ON "game_votes"("game_id", "phase_id", "voter_player_id");

-- AddForeignKey
ALTER TABLE "game_votes" ADD CONSTRAINT "game_votes_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_votes" ADD CONSTRAINT "game_votes_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "game_phases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_votes" ADD CONSTRAINT "game_votes_voter_player_id_fkey" FOREIGN KEY ("voter_player_id") REFERENCES "game_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_votes" ADD CONSTRAINT "game_votes_target_player_id_fkey" FOREIGN KEY ("target_player_id") REFERENCES "game_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
