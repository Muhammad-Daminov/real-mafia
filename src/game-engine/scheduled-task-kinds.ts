/**
 * `game-engine`'s own scheduled-task `kind` discriminators. Opaque strings as
 * far as `SchedulerService` (`src/common/scheduling/`) is concerned — kept in
 * their own file (not inside `game-lifecycle.service.ts` or
 * `phase-transition.service.ts`) purely to avoid those two files importing
 * each other just to share a constant.
 */
export const PHASE_ADVANCE_TASK_KIND = 'PHASE_ADVANCE_CHECK';

export interface PhaseAdvanceTaskPayload {
  gameId: string;
}

export function phaseAdvanceDedupeKey(gameId: string): string {
  return `phase-advance:${gameId}`;
}
