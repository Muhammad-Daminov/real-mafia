import { apiFetch } from './client';
import type { NightActionType } from '../game/nightAbility';

export interface SubmitNightActionRequest {
  actionType: NightActionType;
  targetPlayerId: string;
  /** Journalist's `INVESTIGATE_PAIR` second target — omitted for every other action. */
  targetPlayerId2?: string;
}

/**
 * `SubmittedActionResponse` (../../../src/game-engine/night-actions/night-action.service.ts)
 * — returned verbatim by `POST /games/:gameId/night-actions`, no wrapper.
 */
export interface SubmittedNightAction {
  actionId: string;
  gameId: string;
  phaseId: string;
  actionType: NightActionType;
  actionSlot: number;
  targetPlayerId: string;
  targetPlayerId2: string | null;
}

/**
 * `POST /games/:gameId/night-actions` (`SubmitNightActionDto`/
 * `NightActionService.submitAction`) — `clientRequestId` is a fresh
 * `crypto.randomUUID()` per call, same idempotency convention `api/rooms.ts`
 * already uses for every state-changing command. OD-028 (resolved, default
 * "allowed, update-in-place"): resubmitting during the same NIGHT phase with
 * a *new* clientRequestId updates the existing action row rather than being
 * rejected — this is a deliberate re-submission, not a replay of the same
 * request (that's `CommandRequestService`'s separate, unrelated idempotency
 * layer). Every 4xx (`NightActionErrorCode`,
 * ../../../src/game-engine/night-actions/night-action.errors.ts) surfaces as
 * `ApiError.code`, same mechanism every other authenticated call already uses.
 */
export function submitNightAction(gameId: string, request: SubmitNightActionRequest): Promise<SubmittedNightAction> {
  return apiFetch<SubmittedNightAction>(`/games/${encodeURIComponent(gameId)}/night-actions`, {
    method: 'POST',
    body: JSON.stringify({
      clientRequestId: crypto.randomUUID(),
      actionType: request.actionType,
      targetPlayerId: request.targetPlayerId,
      ...(request.targetPlayerId2 ? { targetPlayerId2: request.targetPlayerId2 } : {}),
    }),
  });
}
