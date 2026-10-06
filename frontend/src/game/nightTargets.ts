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
