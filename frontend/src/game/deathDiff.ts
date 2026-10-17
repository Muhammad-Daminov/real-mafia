import type { GamePhaseName, RoomPlayerSummary } from '../api/rooms';
import { isAlivePlayer } from './nightTargets';

export interface DeathDiff {
  playerIds: string[];
  /** Best-effort context for which announcement to show — 'NIGHT' when the
   * transition that triggered this roster refetch left NIGHT, 'VOTE' when
   * it left VOTING, `null` when unknown (e.g. a reconnect-triggered
   * refetch not tied to any specific transition). See OD-F5-001: there is
   * no backend event naming who died for a single night death or a vote
   * execution — this diff against the previous roster snapshot is the
   * only signal available. */
  context: 'NIGHT' | 'VOTE' | null;
}

/**
 * Diffs two roster snapshots and returns the players who flipped from
 * alive to not-alive between them — `null` when there's nothing new to
 * announce (no prior snapshot to diff against, or no new deaths this
 * round). Deliberately generic over "newly not-alive" rather than
 * specifically "DEAD" — a LEFT transition mid-game doesn't happen (B-R3:
 * leaving is LOBBY-gated), so in practice this only ever catches a real
 * death, but the check itself doesn't need to assume that.
 */
export function computeDeathDiff(
  previousRoster: RoomPlayerSummary[] | null,
  nextRoster: RoomPlayerSummary[] | null,
  transitionFrom: GamePhaseName | null,
): DeathDiff | null {
  if (!previousRoster || !nextRoster) return null;

  const previouslyAliveIds = new Set(previousRoster.filter(isAlivePlayer).map((p) => p.playerId));
  const playerIds = nextRoster
    .filter((p) => previouslyAliveIds.has(p.playerId) && !isAlivePlayer(p))
    .map((p) => p.playerId);

  if (playerIds.length === 0) return null;

  const context: DeathDiff['context'] =
    transitionFrom === 'NIGHT' ? 'NIGHT' : transitionFrom === 'VOTING' ? 'VOTE' : null;

  return { playerIds, context };
}
