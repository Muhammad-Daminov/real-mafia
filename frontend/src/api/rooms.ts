import { apiFetch } from './client';

/**
 * `POST /rooms` (../../../src/rooms/rooms.controller.ts,
 * `CreateRoomDto`/`RoomsService.createRoom`) — `JwtGuard`-protected, so it
 * goes through `apiFetch` (attaches the bearer token). `clientRequestId` is
 * the idempotency key §19's mechanism requires on every state-changing
 * command (`CreateRoomDto`'s own docstring); `visibility` is omitted here
 * since the DTO already defaults it to `PRIVATE` server-side.
 */
export type RulesetMode = 'NORMAL' | 'FAST';
export type RoomVisibility = 'PRIVATE' | 'PUBLIC';

export interface CreateRoomRequest {
  maxPlayers: number;
  rulesetMode: RulesetMode;
}

/**
 * `RoomsService.CreatedRoom` (../../../src/rooms/rooms.service.ts), returned
 * verbatim as the response body — no wrapper object.
 */
export interface CreatedRoom {
  roomId: string;
  code: string;
  gameId: string;
  maxPlayers: number;
  rulesetMode: RulesetMode;
  visibility: RoomVisibility;
}

export function createRoom(request: CreateRoomRequest): Promise<CreatedRoom> {
  return apiFetch<CreatedRoom>('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      clientRequestId: crypto.randomUUID(),
      maxPlayers: request.maxPlayers,
      rulesetMode: request.rulesetMode,
    }),
  });
}
