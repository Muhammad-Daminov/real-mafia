import type { GamePhaseName } from '../api/rooms';
import type { DeathDiff } from './deathDiff';

/**
 * F7b: `DayScreen`'s morning/vote-result announcement card decision,
 * extracted for testing. Three outcomes, not two — `'none'` matters as
 * much as `'deaths'`/`'quiet'`: `lastDeaths === null` is ambiguous on its
 * own (OD-F5-001/`deathDiff.ts` — it means either "nobody died" or "no
 * prior snapshot to diff against yet"), so a "quiet night" card is only
 * ever shown when `lastPhaseFrom` confirms the relevant transition
 * (NIGHT->* or VOTING->*) actually just happened; any other refetch
 * (reconnect, an unrelated phase change) renders nothing rather than a
 * guessed "nobody died" claim.
 */
export type DayAnnouncement =
  | { kind: 'deaths'; context: 'NIGHT' | 'VOTE' | null; playerIds: string[] }
  | { kind: 'quiet'; context: 'NIGHT' | 'VOTE' }
  | { kind: 'none' };

export function resolveDayAnnouncement(
  lastDeaths: DeathDiff | null,
  lastPhaseFrom: GamePhaseName | null,
): DayAnnouncement {
  if (lastDeaths) {
    return { kind: 'deaths', context: lastDeaths.context, playerIds: lastDeaths.playerIds };
  }
  if (lastPhaseFrom === 'NIGHT') return { kind: 'quiet', context: 'NIGHT' };
  if (lastPhaseFrom === 'VOTING') return { kind: 'quiet', context: 'VOTE' };
  return { kind: 'none' };
}
