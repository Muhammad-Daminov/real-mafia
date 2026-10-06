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

/**
 * `POST /rooms/:id/host-transfer` (`TransferHostDto`/`RoomsService.transferHost`)
 * — room-id-keyed. Not wired to any UI in F2 (no "transfer host" button in
 * scope), added only so `HostTransferred`'s shape is available to type the
 * `HOST_TRANSFERRED` realtime event payload (`lobbyStore.ts`).
 */
export interface HostTransferred {
  roomId: string;
  gameId: string;
  previousHostPlayerId: string;
  newHostPlayerId: string;
}

/**
 * `GET /rooms/:code` (`RoomsController.getByCode`/`RoomsService.getRoomByCode`)
 * — the only room/game snapshot endpoint that exists. Deliberately does
 * **not** include a per-player roster (names, avatars, ready flags, or a
 * `hostPlayerId`) — confirmed by reading `RoomsService.getRoomByCode`
 * (../../../src/rooms/rooms.service.ts) line by line, not assumed. See
 * `frontend/docs/OPEN_DECISIONS.md` OD-F2-001 for the consequence this has
 * for the lobby's player list and the proposed (not implemented) backend
 * addition.
 */
export type RoomStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';
export type GameStatus = 'DRAFT' | 'LOBBY' | 'RUNNING' | 'PAUSED' | 'FINISHED' | 'CANCELLED';
export type GamePhaseName =
  | 'LOBBY'
  | 'ROLE_REVEAL'
  | 'NIGHT'
  | 'NIGHT_RESOLUTION'
  | 'MORNING'
  | 'DISCUSSION'
  | 'VOTING'
  | 'VOTE_RESOLUTION'
  | 'LAST_WORD'
  | 'EXECUTION'
  | 'WIN_CHECK'
  | 'GAME_OVER';

/**
 * `RoomsService.RoomPlayerSummary` (backend commit 769618e, B-R1; `lifeStatus`
 * added by backend commit 2395b4c, B-R3) — never carries `telegramId`,
 * `roleCode`, `team`, or any other internal field, including for a DEAD
 * player (no role reveal on death, OD-024). `avatarUrl` is nullable (we only
 * store what Telegram's `photo_url` gave us at login).
 *
 * `lifeStatus` is optional-tolerant: typed as the exact backend enum but
 * marked optional so an older cached response shape (or any future value
 * this frontend doesn't yet know about) doesn't break typing — every
 * consumer must treat `undefined`/unrecognized as "not alive" (see
 * `game/nightTargets.ts`'s `isAlivePlayer`), never silently "alive".
 */
export type RoomPlayerLifeStatus = 'WAITING' | 'ALIVE' | 'DEAD' | 'LEFT';

export interface RoomPlayerSummary {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  isReady: boolean;
  isHost: boolean;
  joinedAt: string;
  lifeStatus?: RoomPlayerLifeStatus;
}

export interface RoomSummary {
  roomId: string;
  code: string;
  visibility: RoomVisibility;
  status: RoomStatus;
  rulesetMode: RulesetMode;
  maxPlayers: number;
  gameId: string;
  gameStatus: GameStatus;
  playerCount: number;
  /**
   * OD-055 (backend): present only when the caller is an active member of
   * this room's game, ordered by `joinedAt` — omitted (not `[]`) for a
   * non-member/removed caller. See OD-F2-001 in this file's companion doc.
   */
  players?: RoomPlayerSummary[];
}

export function getRoomByCode(code: string): Promise<RoomSummary> {
  return apiFetch<RoomSummary>(`/rooms/${encodeURIComponent(code)}`);
}

/**
 * `POST /rooms/:id/start` (`StartGameDto`/`RoomsService.startGame`) —
 * room-id-keyed. Host-only (`NOT_HOST`), requires `Room` status `LOBBY`
 * (`ROOM_NOT_IN_LOBBY`) and `playerCount >= 4` (`NOT_ENOUGH_PLAYERS`,
 * `MIN_PLAYERS_TO_START` in `start-game.config.ts`). Per OD-014
 * (../../../docs/decisions/OPEN_DECISIONS.md), `isReady` never gates start —
 * confirmed by reading `startGameTransaction`: it checks host + player count
 * only, never touches `isReady`.
 */
export interface GameStarted {
  roomId: string;
  gameId: string;
  status: GameStatus;
  currentPhase: GamePhaseName;
  playerCount: number;
  rulesVersion: string;
  startedAt: string;
}

export function startGame(roomId: string): Promise<GameStarted> {
  return apiFetch<GameStarted>(`/rooms/${encodeURIComponent(roomId)}/start`, {
    method: 'POST',
    body: JSON.stringify({ clientRequestId: crypto.randomUUID() }),
  });
}
