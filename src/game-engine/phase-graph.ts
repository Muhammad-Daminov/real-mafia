import { GamePhaseName } from '@prisma/client';

/**
 * §10.1: `NIGHT_RESOLUTION`, `VOTE_RESOLUTION`, `EXECUTION`, `WIN_CHECK` are
 * transient — "they never survive a commit." The transition engine treats a
 * transient phase as immediately due regardless of `game_phases.ends_at`
 * (which is always null for them).
 */
export const TRANSIENT_PHASES: ReadonlySet<GamePhaseName> = new Set([
  GamePhaseName.NIGHT_RESOLUTION,
  GamePhaseName.VOTE_RESOLUTION,
  GamePhaseName.EXECUTION,
  GamePhaseName.WIN_CHECK,
]);

export function isTransientPhase(phase: GamePhaseName): boolean {
  return TRANSIENT_PHASES.has(phase);
}

/**
 * The domain facts §10.2's diagram branches on. `deathsOccurred`,
 * `executionOccurred`, and `hasWinner` can only ever be produced by
 * night-action resolution, vote-counting, and the win evaluator — none of
 * which exist yet (explicitly out of scope for the phase-transition slice).
 * Every caller in this codebase currently passes the trivial context
 * (`deathsOccurred: false, executionOccurred: false, hasWinner: false`),
 * which is why `LAST_WORD`, `EXECUTION`, and the winner branch of
 * `GAME_OVER` are unreachable in practice today — a visible consequence of
 * those slices not existing yet, not a guess about their eventual behavior.
 */
export interface PhaseTransitionContext {
  lastWordEnabled: boolean;
  deathsOccurred: boolean;
  executionOccurred: boolean;
  /** Only consulted when `current` is LAST_WORD: was it entered via an execution (vote) rather than a night kill? */
  triggeredByVote: boolean;
  hasWinner: boolean;
}

export interface NextPhase {
  phase: GamePhaseName;
  /** OD-042: round increments exactly when entering NIGHT. */
  incrementsRound: boolean;
}

const STAY = (phase: GamePhaseName): NextPhase => ({ phase, incrementsRound: false });

/**
 * Pure §10.2 state-machine transcription — no I/O, no locking, no defaults
 * invented beyond what the diagram states. `LOBBY` and `GAME_OVER` have no
 * engine-driven outgoing edge (`LOBBY -> ROLE_REVEAL` is StartGame's own
 * transition, handled by `GameLifecycleService.startGame`; `GAME_OVER` is
 * terminal), so both throw if reached here — a caller asking this function
 * to advance past them is a caller bug.
 */
export function computeNextPhase(
  current: GamePhaseName,
  ctx: PhaseTransitionContext,
): NextPhase {
  switch (current) {
    case GamePhaseName.LOBBY:
      throw new Error('computeNextPhase: LOBBY has no engine-driven transition (StartGame owns it)');

    case GamePhaseName.ROLE_REVEAL:
      return { phase: GamePhaseName.NIGHT, incrementsRound: true };

    case GamePhaseName.NIGHT:
      return STAY(GamePhaseName.NIGHT_RESOLUTION);

    case GamePhaseName.NIGHT_RESOLUTION:
      if (ctx.hasWinner) return STAY(GamePhaseName.GAME_OVER);
      if (ctx.deathsOccurred && ctx.lastWordEnabled) return STAY(GamePhaseName.LAST_WORD);
      return STAY(GamePhaseName.MORNING);

    case GamePhaseName.LAST_WORD:
      return ctx.triggeredByVote ? STAY(GamePhaseName.EXECUTION) : STAY(GamePhaseName.MORNING);

    case GamePhaseName.MORNING:
      return STAY(GamePhaseName.DISCUSSION);

    case GamePhaseName.DISCUSSION:
      return STAY(GamePhaseName.VOTING);

    case GamePhaseName.VOTING:
      return STAY(GamePhaseName.VOTE_RESOLUTION);

    case GamePhaseName.VOTE_RESOLUTION:
      if (ctx.executionOccurred && ctx.lastWordEnabled) return STAY(GamePhaseName.LAST_WORD);
      if (ctx.executionOccurred) return STAY(GamePhaseName.EXECUTION);
      return STAY(GamePhaseName.WIN_CHECK);

    case GamePhaseName.EXECUTION:
      return STAY(GamePhaseName.WIN_CHECK);

    case GamePhaseName.WIN_CHECK:
      return ctx.hasWinner
        ? STAY(GamePhaseName.GAME_OVER)
        : { phase: GamePhaseName.NIGHT, incrementsRound: true };

    case GamePhaseName.GAME_OVER:
      throw new Error('computeNextPhase: GAME_OVER is terminal');
  }
}
