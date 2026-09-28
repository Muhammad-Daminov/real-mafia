-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('KILL', 'INVESTIGATE', 'PROTECT', 'SHOOT', 'GUARD', 'INVESTIGATE_PAIR', 'CHECK');

-- CreateEnum
CREATE TYPE "AbilityUsageKind" AS ENUM ('SHERIFF_SHOOT', 'DOCTOR_SELF_PROTECT');

-- CreateTable
CREATE TABLE "game_actions" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "phase_id" UUID NOT NULL,
    "actor_player_id" UUID NOT NULL,
    "action_type" "ActionType" NOT NULL,
    "action_slot" INTEGER NOT NULL,
    "target_player_id" UUID NOT NULL,
    "target_player_id_2" UUID,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_ability_usage" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "ability" "AbilityUsageKind" NOT NULL,
    "used_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "role_ability_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_actions_game_id_phase_id_idx" ON "game_actions"("game_id", "phase_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_actions_game_id_phase_id_actor_player_id_action_slot_key" ON "game_actions"("game_id", "phase_id", "actor_player_id", "action_slot");

-- CreateIndex
CREATE UNIQUE INDEX "role_ability_usage_game_id_player_id_ability_key" ON "role_ability_usage"("game_id", "player_id", "ability");

-- AddForeignKey
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "game_phases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_actor_player_id_fkey" FOREIGN KEY ("actor_player_id") REFERENCES "game_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_target_player_id_fkey" FOREIGN KEY ("target_player_id") REFERENCES "game_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_target_player_id_2_fkey" FOREIGN KEY ("target_player_id_2") REFERENCES "game_players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_ability_usage" ADD CONSTRAINT "role_ability_usage_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_ability_usage" ADD CONSTRAINT "role_ability_usage_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "game_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
