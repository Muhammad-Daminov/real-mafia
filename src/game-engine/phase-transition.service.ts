import { Injectable } from '@nestjs/common';
import { GamePhaseName, GameStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GameLifecycleService, PhaseDurationsSec } from './game-lifecycle.service';
import { computeNextPhase, isTransientPhase } from './phase-graph';

export type AdvancePhaseReason = 'GAME_NOT_FOUND' | 'GAME_NOT_RUNNING' | 'NOT_DUE';

export interface AdvancePhaseResult {
  advanced: boolean;
  reason?: AdvancePhaseReason;
  from?: GamePhaseName;
  to?: GamePhaseName;
  round?: number;
}

interface FrozenPhaseConfig {
  phaseDurationsSec: PhaseDurationsSec;
  lastWordEnabled: boolean;
}

const TIMED_PHASE_KEY: Partial<Record<GamePhaseName, keyof PhaseDurationsSec>> = {
  [GamePhaseName.ROLE_REVEAL]: 'ROLE_REVEAL',
  [GamePhaseName.NIGHT]: 'NIGHT',
  [GamePhaseName.MORNING]: 'MORNING',
  [GamePhaseName.LAST_WORD]: 'LAST_WORD',
  [GamePhaseName.DISCUSSION]: 'DISCUSSION',
  [GamePhaseName.VOTING]: 'VOTING',
};

/**
 * §10.2/§10.3/§19: the phase state machine's correctness boundary. Mirrors
 * `RoomsService.startGameTransaction`'s discipline exactly — a single
 * `SELECT games ... FOR UPDATE` transaction is the only thing that decides
 * "are we due to transition," so two simultaneous triggers (a future timer
 * worker firing at the same instant as another trigger) serialize on the
 * game row lock instead of racing into a double-advance or a skipped round.
 *
 * §10.3's restricted writes (`current_phase`/`round`, and by extension the
 * `game_phases` history rows) are never written directly here — every
 * mutation goes through `GameLifecycleService.transitionPhase`, exactly the
 * same division of labor as StartGame (this service decides *what* happens
 * next and holds the lock; GameLifecycleService performs the write).
 *
 * Known gap: nothing in this codebase yet calls `advancePhase` on a
 * schedule. §19/OD-008 name a `scheduled_tasks` + `FOR UPDATE SKIP LOCKED`
 * polling worker as the timer mechanism, but no such worker (and no
 * `scheduled_tasks` table) exists in this codebase yet — building that
 * generic background-job infrastructure is its own slice, shared with the
 * outbox dispatcher's near-identical needs (§19/§25), and is out of scope
 * here. This service is written to be safe to call from that worker once it
 * exists, or from a manual/action-driven trigger, without any redesign.
 */
@Injectable()
export class PhaseTransitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameLifecycle: GameLifecycleService,
  ) {}

  async advancePhase(gameId: string): Promise<AdvancePhaseResult> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM games WHERE id = ${gameId}::uuid FOR UPDATE
      `;

      if (locked.length === 0) {
        return { advanced: false, reason: 'GAME_NOT_FOUND' };
      }

      const game = await tx.game.findUniqueOrThrow({
        where: { id: gameId },
        select: { status: true, configSnapshot: true },
      });

      if (game.status !== GameStatus.RUNNING) {
        return { advanced: false, reason: 'GAME_NOT_RUNNING' };
      }

      const config = game.configSnapshot as unknown as FrozenPhaseConfig | null;

      if (!config) {
        throw new Error(
          `PhaseTransitionService.advancePhase: RUNNING game ${gameId} has no config_snapshot (§14.3 invariant violated)`,
        );
      }

      let activePhase = await tx.gamePhase.findFirstOrThrow({
        where: { gameId, endedAt: null },
      });
      const from = activePhase.phase;
      const now = new Date();

      // Stable/timed phase, not yet due: no-op. Transient phases (endsAt
      // null) always fall through to the cascade below (§10.1: they never
      // survive a commit, so there is no "due" concept for them).
      if (activePhase.endsAt !== null && now < activePhase.endsAt) {
        return { advanced: false, reason: 'NOT_DUE', from, to: from, round: activePhase.round };
      }

      for (;;) {
        const next = computeNextPhase(activePhase.phase, {
          lastWordEnabled: config.lastWordEnabled,
          deathsOccurred: false, // night-action resolution: separate later slice
          executionOccurred: false, // vote-counting: separate later slice
          triggeredByVote: false, // unreachable until the two above exist
          hasWinner: false, // win evaluator: separate later slice
        });

        const round = next.incrementsRound ? activePhase.round + 1 : activePhase.round;
        const gameOver = next.phase === GamePhaseName.GAME_OVER;
        const endsAt =
          gameOver || isTransientPhase(next.phase)
            ? null
            : new Date(now.getTime() + this.durationSecFor(next.phase, config.phaseDurationsSec) * 1000);

        await this.gameLifecycle.transitionPhase(tx, {
          gameId,
          closePhaseId: activePhase.id,
          toPhase: next.phase,
          round,
          endsAt,
          gameOver,
        });

        if (gameOver || !isTransientPhase(next.phase)) {
          return { advanced: true, from, to: next.phase, round };
        }

        activePhase = await tx.gamePhase.findFirstOrThrow({
          where: { gameId, endedAt: null },
        });
      }
    });
  }

  private durationSecFor(phase: GamePhaseName, durations: PhaseDurationsSec): number {
    const key = TIMED_PHASE_KEY[phase];

    if (!key) {
      throw new Error(`durationSecFor: ${phase} is not a timed stable phase`);
    }

    const seconds = durations[key];

    if (seconds === null) {
      throw new Error(`durationSecFor: ${phase}'s duration is null (disabled) but the graph routed into it`);
    }

    return seconds;
  }
}
