import type { GameStateTeammate } from '../api/games';
import type { RoomPlayerSummary } from '../api/rooms';
import { submitNightAction, type SubmitNightActionRequest, type SubmittedNightAction } from '../api/nightActions';
import { evaluateTarget, type IneligibleReason, type RosterCandidate } from './targetEligibility';
import type { NightAbilitySpec } from './nightAbility';

/**
 * F4.1: "not alive" is the safe default — `lifeStatus` is optional-tolerant
 * (`api/rooms.ts`), so `undefined` or any value this frontend doesn't
 * recognize (a future enum member) is treated as not-alive, never as a
 * silently-valid target. Only an exact `'ALIVE'` passes.
 */
export function isAlivePlayer(player: Pick<RoomPlayerSummary, 'lifeStatus'>): boolean {
  return player.lifeStatus === 'ALIVE';
}

export interface TargetRow {
  playerId: string;
  displayName: string;
  isSelf: boolean;
  eligible: boolean;
  reason: IneligibleReason | null;
}

/**
 * Builds one row per roster entry for the NIGHT target picker —
 * `game/targetEligibility.ts`'s `evaluateTarget` decides eligibility;
 * `roleCode` is filled in only for a known teammate (OD-025's `teammates`),
 * exactly as `RosterCandidate`'s own contract requires.
 */
export function buildTargetRows(
  ability: NightAbilitySpec,
  myPlayerId: string,
  roster: RoomPlayerSummary[],
  teammates: GameStateTeammate[],
): TargetRow[] {
  const teammateRoleById = new Map(teammates.map((t) => [t.playerId, t.roleCode]));

  return roster.map((player) => {
    const candidate: RosterCandidate = {
      playerId: player.playerId,
      alive: isAlivePlayer(player),
      roleCode: teammateRoleById.get(player.playerId),
    };
    const result = evaluateTarget(ability, myPlayerId, candidate);

    return {
      playerId: player.playerId,
      displayName: player.displayName,
      isSelf: player.playerId === myPlayerId,
      eligible: result.eligible,
      reason: result.reason,
    };
  });
}

/**
 * F7b: the target-grid tap handler's own selection-toggle rule, extracted
 * out of `NightScreen.tsx` so it's testable without React (same reasoning
 * as every other pure helper in this file). A second tap on an already-
 * selected id deselects it; a pair-target ability (Journalist) keeps at
 * most the two most recent picks, sliding the oldest one out once a third
 * is tapped, rather than growing unbounded or silently ignoring the tap.
 */
export function toggleTargetSelection(current: string[], playerId: string, pairTarget: boolean): string[] {
  if (current.includes(playerId)) {
    return current.filter((id) => id !== playerId);
  }
  if (pairTarget) {
    return current.length >= 2 ? [current[1]!, playerId] : [...current, playerId];
  }
  return [playerId];
}

/** A single-target ability needs exactly one selected id; Journalist's
 * pair-target ability needs exactly two distinct ones. */
export function canConfirmSelection(ability: NightAbilitySpec, selected: string[]): boolean {
  if (ability.pairTarget) {
    return selected.length === 2 && selected[0] !== selected[1];
  }
  return selected.length === 1;
}

/**
 * Builds the request and submits it — thin orchestration kept out of
 * `NightScreen.tsx` so it's testable without React. Throws (never
 * silently no-ops) when the selection is incomplete, so a caller can't
 * accidentally submit a malformed request.
 */
export async function submitSelectedTarget(
  gameId: string,
  ability: NightAbilitySpec,
  selected: string[],
): Promise<SubmittedNightAction> {
  if (!canConfirmSelection(ability, selected)) {
    throw new Error('submitSelectedTarget: selection incomplete for this ability');
  }

  const request: SubmitNightActionRequest = {
    actionType: ability.actionType,
    targetPlayerId: selected[0]!,
    ...(ability.pairTarget ? { targetPlayerId2: selected[1] } : {}),
  };

  return submitNightAction(gameId, request);
}
