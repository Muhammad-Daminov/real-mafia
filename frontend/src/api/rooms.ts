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

/**
 * `POST /rooms/:code/join` (`JoinRoomDto`/`RoomsService.joinRoom`) — the
 * code is a route param, not a body field (`JoinRoomDto`'s own docstring:
 * "The room code is a route param, not body"). Response is
 * `RoomsService.JoinedRoom` verbatim, no wrapper.
 */
export interface JoinedRoom {
  roomId: string;
  gameId: string;
  playerId: string;
  playerCount: number;
  maxPlayers: number;
}

export function joinRoom(code: string): Promise<JoinedRoom> {
  return apiFetch<JoinedRoom>(`/rooms/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    body: JSON.stringify({ clientRequestId: crypto.randomUUID() }),
  });
}

/**
 * `POST /rooms/:id/leave` (`LeaveRoomDto`/`RoomsService.leaveRoom`) — `:id`
 * is the **room id**, not the game id (`LeaveRoomDto`'s own docstring: "The
 * room id is a route param, not body"). Response is `RoomsService.LeftRoom`
 * verbatim.
 */
export interface LeftRoom {
  roomId: string;
  gameId: string;
  playerId: string;
  playerCount: number;
  newHostPlayerId: string | null;
  roomClosed: boolean;
}

export function leaveRoom(roomId: string): Promise<LeftRoom> {
  return apiFetch<LeftRoom>(`/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: 'POST',
    body: JSON.stringify({ clientRequestId: crypto.randomUUID() }),
  });
}

/**
 * `POST /rooms/:id/ready` (`SetReadyDto`/`RoomsService.setReady`) — also
 * room-id-keyed, same as `leave`. Broadcasts `PLAYER_READY_CHANGED`
 * (`rooms.service.ts`, grepped for `broadcastToGame` — not guessed).
 * Response is `RoomsService.ReadySet` verbatim.
 */
export interface ReadySet {
  roomId: string;
  gameId: string;
  playerId: string;
  isReady: boolean;
}

export function setReady(roomId: string, isReady: boolean): Promise<ReadySet> {
  return apiFetch<ReadySet>(`/rooms/${encodeURIComponent(roomId)}/ready`, {
    method: 'POST',
    body: JSON.stringify({ clientRequestId: crypto.randomUUID(), isReady }),
  });
}
