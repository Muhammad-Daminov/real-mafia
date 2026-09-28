import { Injectable, OnModuleInit } from '@nestjs/common';
import { GamePhaseName, GameStatus, LifeStatus, Prisma, WinnerTeam } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../common/scheduling/scheduler.service';
import { GameLifecycleService, PhaseDurationsSec } from './game-lifecycle.service';
import { computeNextPhase, isTransientPhase, PhaseTransitionContext } from './phase-graph';
import { PHASE_ADVANCE_TASK_KIND, PhaseAdvanceTaskPayload } from './scheduled-task-kinds';
import { NightResolutionService } from './night-actions/night-resolution.service';
import { NightAbilitySpec, primaryAbility } from './night-actions/role-abilities';
import { PRIVATE_RESULT_EVENT_BY_ACTION_TYPE } from './night-actions/private-event-names';
import { ActionResult } from './night-actions/night-resolution';
import { VoteResolutionService } from './voting/vote-resolution.service';
import { evaluateWinCondition } from './win-evaluator';
import { RealtimeEventService } from '../common/realtime/realtime-event.service';

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
 * §19/OD-008/OD-043: `advancePhase` is registered as the handler for the
 * `PHASE_ADVANCE_CHECK` task kind on `SchedulerService` (`common/scheduling`,
 * domain-agnostic shared infra) — this is the dependency edge that makes
 * `advancePhase` actually get called on schedule: `GameLifecycleService`
 * enqueues a `PHASE_ADVANCE_CHECK` task for a game's next deadline every time
 * it writes a new `ends_at` (in `startGame` and `transitionPhase`), and
 * `SchedulerService`'s poll loop claims and dispatches it back here once due.
 * `game-engine` imports `common/scheduling` and registers itself with it;
 * `common/scheduling` never imports `game-engine` — the same one-directional
 * shape I-33 already requires for `game-engine <-> economy`.
 *
 * §20/OD-047: `advancePhase` also broadcasts `PHASE_CHANGED`/`GAME_FINISHED`,
 * and — §17.5/OD-050 — `MULTIPLE_DEATHS` (PUBLIC, only when a night kills more
 * than one player; a single death broadcasts nothing this slice, OD-050),
 * via `RealtimeEventService` — but only *after* `this.prisma.$transaction(...)`
 * has already resolved successfully, never from inside the callback passed to
 * it. A callback that throws rolls Postgres back and rejects the `$transaction`
 * promise before a single line after `await` runs, so gating every emit call
 * on that `await` having already returned is sufficient to guarantee "no
 * event fires for a transaction that didn't commit" — no separate post-commit
 * hook mechanism is needed, and none of `game-engine`'s other services
 * (`GameLifecycleService`, `NightResolutionService`, `VoteResolutionService`)
 * needed one either, since none of them call `RealtimeEventService` directly;
 * only this method does, right here, after its own `$transaction` call.
 */
@Injectable()
export class PhaseTransitionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameLifecycle: GameLifecycleService,
    private readonly scheduler: SchedulerService,
    private readonly nightResolution: NightResolutionService,
    private readonly voteResolution: VoteResolutionService,
    private readonly realtime: RealtimeEventService,
  ) {}

  onModuleInit(): void {
    this.scheduler.registerHandler(PHASE_ADVANCE_TASK_KIND, async (payload) => {
      const { gameId } = payload as unknown as PhaseAdvanceTaskPayload;
      await this.advancePhase(gameId);
    });
  }

  async advancePhase(gameId: string): Promise<AdvancePhaseResult> {
    // §17.5/OD-048: populated (if at all) only by a night resolution that
    // actually ran inside the transaction below; read only *after* that
    // transaction has resolved successfully (see this method's own docstring
    // on why "push inside, read after a successful await" is safe: a thrown
    // callback never reaches the code that reads this array at all).
    const nightResultsToEmit: ActionResult[] = [];
    // §17.5/OD-050: same discipline — a night's dead player ids, read only
    // after the transaction resolves. `MULTIPLE_DEATHS` only fires when this
    // has more than one entry (OD-050: the event name is load-bearing per
    // §17.5's literal wording, "when more than one death occurs the same
    // night" — a single-death night broadcasts nothing this slice).
    const nightDeathsToEmit: string[] = [];

    const result = await this.prisma.$transaction(async (tx): Promise<AdvancePhaseResult> => {
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

      // Stable/timed phase, not yet due: no-op, UNLESS this is NIGHT and
      // every alive player with a usable night ability has already submitted
      // (§10.2's "all actions submitted" early-completion edge, OD-044c), or
      // VOTING and every alive player has cast a vote (§10.2's "all alive
      // voted" edge) — in either case fall through to the cascade below
      // instead of waiting out the timer. Every other stable phase has no
      // early-completion path, so keeps waiting.
      if (activePhase.endsAt !== null && now < activePhase.endsAt) {
        const readyEarly =
          (activePhase.phase === GamePhaseName.NIGHT &&
            (await this.allNightActionsSubmitted(tx, gameId, activePhase.id))) ||
          (activePhase.phase === GamePhaseName.VOTING &&
            (await this.allAliveVoted(tx, gameId, activePhase.id)));

        if (!readyEarly) {
          return { advanced: false, reason: 'NOT_DUE', from, to: from, round: activePhase.round };
        }
      }

      // §17.4/§16: carry the just-resolved NIGHT/VOTING round's outcome into
      // the very next loop iteration's context (the NIGHT_RESOLUTION -> ? and
      // VOTE_RESOLUTION -> ? branches are the only places these are
      // consulted) — never stale beyond that one step.
      let nightDeathsOccurred = false;
      let voteExecutionOccurred = false;

      for (;;) {
        // §16.2: "evaluated after night resolution, after execution, and
        // after any alive-count-changing transition" — in this state machine
        // that's exactly the two points `computeNextPhase` consults
        // `ctx.hasWinner`: leaving NIGHT_RESOLUTION (right after night
        // deaths) and at WIN_CHECK itself (reached after every day-vote
        // round, executed or not). It's a pure predicate over current
        // `game_players`/`game_role_assignments` state, so it's recomputed
        // fresh here rather than threaded as a loop variable like the two
        // outcome flags above.
        const winner =
          activePhase.phase === GamePhaseName.NIGHT_RESOLUTION || activePhase.phase === GamePhaseName.WIN_CHECK
            ? await this.evaluateWinner(tx, gameId)
            : null;

        const ctx: PhaseTransitionContext = {
          lastWordEnabled: config.lastWordEnabled,
          deathsOccurred:
            activePhase.phase === GamePhaseName.NIGHT_RESOLUTION ? nightDeathsOccurred : false,
          executionOccurred:
            activePhase.phase === GamePhaseName.VOTE_RESOLUTION ? voteExecutionOccurred : false,
          // §10.4: LAST_WORD's own outgoing edge depends on how *this*
          // occurrence of it was entered, decided in a wholly separate
          // `advancePhase` call from the one that ran the resolution (LAST_WORD
          // is stable/timed) — so it can't ride a loop-local variable the way
          // the two flags above do. Derived instead from `game_phases`'
          // append-only history: NIGHT_RESOLUTION and VOTE_RESOLUTION never
          // increment the round (only ROLE_REVEAL->NIGHT and WIN_CHECK->NIGHT
          // do), so the most recent resolution-phase row for this same round
          // unambiguously identifies which one triggered this LAST_WORD.
          triggeredByVote:
            activePhase.phase === GamePhaseName.LAST_WORD
              ? await this.wasLastWordTriggeredByVote(tx, gameId, activePhase.round)
              : false,
          hasWinner: winner !== null,
        };

        const next = computeNextPhase(activePhase.phase, ctx);

        const round = next.incrementsRound ? activePhase.round + 1 : activePhase.round;
        const gameOver = next.phase === GamePhaseName.GAME_OVER;
        const endsAt =
          gameOver || isTransientPhase(next.phase)
            ? null
            : new Date(now.getTime() + this.durationSecFor(next.phase, config.phaseDurationsSec) * 1000);

        const closingPhase = activePhase;

        await this.gameLifecycle.transitionPhase(tx, {
          gameId,
          closePhaseId: closingPhase.id,
          toPhase: next.phase,
          round,
          endsAt,
          gameOver,
          winnerTeam: gameOver ? winner : null,
        });

        if (closingPhase.phase === GamePhaseName.NIGHT && next.phase === GamePhaseName.NIGHT_RESOLUTION) {
          const resolved = await this.nightResolution.resolveRound(tx, {
            gameId,
            nightPhaseId: closingPhase.id,
          });
          nightDeathsOccurred = resolved.deathsOccurred;
          nightDeathsToEmit.push(...resolved.deaths);
          nightResultsToEmit.push(...resolved.results);
        }

        if (closingPhase.phase === GamePhaseName.VOTING && next.phase === GamePhaseName.VOTE_RESOLUTION) {
          const resolved = await this.voteResolution.resolveRound(tx, {
            gameId,
            votingPhaseId: closingPhase.id,
          });
          voteExecutionOccurred = resolved.executionOccurred;
        }

        if (gameOver || !isTransientPhase(next.phase)) {
          return { advanced: true, from, to: next.phase, round };
        }

        activePhase = await tx.gamePhase.findFirstOrThrow({
          where: { gameId, endedAt: null },
        });
      }
    });

    if (result.advanced) {
      this.realtime.broadcastToGame(gameId, 'PHASE_CHANGED', {
        from: result.from,
        to: result.to,
        round: result.round,
      });

      if (result.to === GamePhaseName.GAME_OVER) {
        // Read-your-writes outside the transaction: `$transaction` above has
        // already resolved, so `GameLifecycleService.transitionPhase`'s
        // `GameResult` insert is committed and visible here.
        const gameResult = await this.prisma.gameResult.findUnique({ where: { gameId } });
        this.realtime.broadcastToGame(gameId, 'GAME_FINISHED', {
          winnerTeam: gameResult?.winnerTeam ?? null,
        });
      }

      // §17.5/OD-050: PUBLIC, only when more than one player died this
      // night — reuses `deaths` verbatim (no role field, per OD-024).
      // Ordering relative to PHASE_CHANGED above is not spec'd and clients
      // consume both independently off the same committed state, so no
      // particular order is load-bearing; emitted right after for locality.
      if (nightDeathsToEmit.length > 1) {
        this.realtime.broadcastToGame(gameId, 'MULTIPLE_DEATHS', { deaths: nightDeathsToEmit });
      }
    }

    // §17.5/OD-048: private per-actor night-action results, one `sendToPlayer`
    // per result, only reached once the transaction that produced them has
    // already committed (see this array's declaration above).
    for (const actionResult of nightResultsToEmit) {
      const eventName = PRIVATE_RESULT_EVENT_BY_ACTION_TYPE[actionResult.actionType];
      if (eventName) {
        this.realtime.sendToPlayer(gameId, actionResult.actorPlayerId, eventName, actionResult.result);
      }
    }

    return result;
  }

  /**
   * OD-044c's early-completion gate: every `ALIVE` player whose role still
   * has a *usable* night ability must have submitted their **primary** slot
   * action. A Sheriff who has already spent their once-per-game `SHOOT` is
   * removed from the expected set (nothing left to submit); Don's optional
   * `CHECK` never gates this (it isn't a primary slot, see role-abilities.ts).
   */
  private async allNightActionsSubmitted(
    tx: Prisma.TransactionClient,
    gameId: string,
    nightPhaseId: string,
  ): Promise<boolean> {
    const alivePlayers = await tx.gamePlayer.findMany({
      where: { gameId, lifeStatus: LifeStatus.ALIVE },
      select: { id: true, roleAssignment: { select: { roleCode: true } } },
    });

    const expected = alivePlayers
      .filter((p) => p.roleAssignment !== null)
      .map((p) => ({ playerId: p.id, ability: primaryAbility(p.roleAssignment!.roleCode) }))
      .filter((p): p is { playerId: string; ability: NightAbilitySpec } => p.ability !== null);

    // No alive player has a night ability to submit at all: nothing to gate
    // on, so this isn't "early completion" — defer to the normal timeout
    // (a real RUNNING game always seats at least one Mafia/Don, so this only
    // arises for a degenerate/empty fixture, never live play).
    if (expected.length === 0) {
      return false;
    }

    const onceAbilityPlayerIds = expected
      .filter((e) => e.ability.frequency === 'ONCE_PER_GAME')
      .map((e) => e.playerId);

    const usedUp = onceAbilityPlayerIds.length
      ? new Set(
          (
            await tx.roleAbilityUsage.findMany({
              where: {
                gameId,
                playerId: { in: onceAbilityPlayerIds },
                ability: 'SHERIFF_SHOOT',
                usedCount: { gt: 0 },
              },
              select: { playerId: true },
            })
          ).map((u) => u.playerId),
        )
      : new Set<string>();

    const stillExpected = expected.filter((e) => !usedUp.has(e.playerId));

    if (stillExpected.length === 0) {
      return true;
    }

    const submitted = await tx.gameAction.findMany({
      where: {
        gameId,
        phaseId: nightPhaseId,
        actorPlayerId: { in: stillExpected.map((e) => e.playerId) },
      },
      select: { actorPlayerId: true, actionSlot: true },
    });

    const submittedKeys = new Set(submitted.map((s) => `${s.actorPlayerId}:${s.actionSlot}`));

    return stillExpected.every((e) => submittedKeys.has(`${e.playerId}:${e.ability.slot}`));
  }

  /**
   * §10.2's "all alive voted" early-completion edge for VOTING. Unlike
   * night's per-role gate, every alive player is expected to vote — voting
   * has no role restriction — so this is just "does every ALIVE player have
   * a `GameVote` row for this phase," per OD-015's "absence is a legitimate
   * outcome" default (a non-voter simply has no row; the normal timeout
   * still governs them).
   */
  private async allAliveVoted(
    tx: Prisma.TransactionClient,
    gameId: string,
    votingPhaseId: string,
  ): Promise<boolean> {
    const alivePlayers = await tx.gamePlayer.findMany({
      where: { gameId, lifeStatus: LifeStatus.ALIVE },
      select: { id: true },
    });

    // No alive player at all: nothing to gate on (degenerate/empty fixture,
    // never live play) — defer to the normal timeout, same reasoning as
    // `allNightActionsSubmitted`'s empty-expected-set case.
    if (alivePlayers.length === 0) {
      return false;
    }

    const votes = await tx.gameVote.findMany({
      where: { gameId, phaseId: votingPhaseId, voterPlayerId: { in: alivePlayers.map((p) => p.id) } },
      select: { voterPlayerId: true },
    });

    const votedIds = new Set(votes.map((v) => v.voterPlayerId));
    return alivePlayers.every((p) => votedIds.has(p.id));
  }

  /**
   * §10.4: which resolution phase most recently led into this round's
   * LAST_WORD. See the ctx-construction comment above for why this can't be
   * a loop-local variable.
   */
  private async wasLastWordTriggeredByVote(
    tx: Prisma.TransactionClient,
    gameId: string,
    round: number,
  ): Promise<boolean> {
    const priorResolution = await tx.gamePhase.findFirst({
      where: {
        gameId,
        round,
        phase: { in: [GamePhaseName.NIGHT_RESOLUTION, GamePhaseName.VOTE_RESOLUTION] },
        endedAt: { not: null },
      },
      orderBy: { startedAt: 'desc' },
    });

    return priorResolution?.phase === GamePhaseName.VOTE_RESOLUTION;
  }

  /**
   * §16.1: builds the current alive roster from `game_players`/
   * `game_role_assignments` and runs the pure `evaluateWinCondition`. Reads
   * post-resolution state — by the time this is called (NIGHT_RESOLUTION or
   * WIN_CHECK), `NightResolutionService`/`VoteResolutionService` have already
   * written this round's deaths, so `life_status` reflects them.
   */
  private async evaluateWinner(
    tx: Prisma.TransactionClient,
    gameId: string,
  ): Promise<WinnerTeam | null> {
    const players = await tx.gamePlayer.findMany({
      where: { gameId },
      select: { lifeStatus: true, roleAssignment: { select: { roleCode: true } } },
    });

    const roster = players
      .filter((p) => p.roleAssignment !== null)
      .map((p) => ({ roleCode: p.roleAssignment!.roleCode, alive: p.lifeStatus === LifeStatus.ALIVE }));

    return evaluateWinCondition(roster) as WinnerTeam | null;
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
