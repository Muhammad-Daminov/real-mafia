import { io, type Socket } from 'socket.io-client';
import { requireApiUrl } from '../config/env';
import { getToken } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import { useLobbyStore } from '../store/lobbyStore';
import { useGameStore } from '../store/gameStore';
import type { GamePhaseName, HostTransferred, JoinedRoom, LeftRoom, ReadySet } from '../api/rooms';
import type { GameStateTeammate, RoleCode, Team } from '../api/games';

/**
 * Cap on socket.io-client's built-in reconnection attempts (default:
 * `Infinity`) — a debug tool retrying forever with a permanently-bad
 * `gameId`/token is more confusing than a clear terminal error state.
 */
const MAX_RECONNECTION_ATTEMPTS = 10;

let socket: Socket | null = null;
/** Reset on every successful `connect` — one re-auth attempt per error episode, not per retry. */
let reAuthAttempted = false;

/**
 * §20/OD-047(3) (../../../src/common/realtime/realtime.gateway.ts): the
 * gateway's namespace middleware requires both a bearer JWT
 * (`handshake.auth.token`) and a `gameId` (`handshake.auth.gameId`) to
 * authenticate at all — resolving `GamePlayer(gameId, userId)` before any
 * room join. There is no lobby/room-selection UI in this slice (out of
 * scope), so `connectSocket` takes an explicit `gameId` from the debug
 * screen's manual input rather than sourcing one from app state.
 *
 * `auth` is passed as a callback (not a plain object) so every reconnection
 * attempt — automatic or after `handleConnectError`'s re-auth — re-reads
 * whatever token is currently in `api/client.ts`'s in-memory store, per the
 * task's "re-auth on token expiry" requirement.
 */
export function connectSocket(gameId: string): void {
  disconnectSocket();
  reAuthAttempted = false;

  useSocketStore.getState().setStatus('connecting');

  const instance = io(`${requireApiUrl()}/game`, {
    auth: (callback) => callback({ token: getToken(), gameId }),
    reconnection: true,
    reconnectionAttempts: MAX_RECONNECTION_ATTEMPTS,
  });

  instance.on('connect', () => {
    reAuthAttempted = false;
    useSocketStore.getState().setStatus('connected');

    // Slice F2: there's no event-replay/sequence on the backend (§20), so
    // any (re)connect — including automatic reconnects after a drop — may
    // have missed events. If a lobby is active, refetch its REST snapshot
    // to resync playerCount/status; own host/ready state can't be
    // refreshed this way (the snapshot has no per-player fields — see
    // lobbyStore.ts / OD-F2-001), a known limitation, not silently ignored.
    if (useLobbyStore.getState().code) {
      void useLobbyStore.getState().refetchSnapshot();
    }

    // F3: same "no event replay" gap (§20) applies to a game already in
    // progress — a (re)connect may have missed ROLE_REVEALED/PHASE_CHANGED
    // entirely, so resync from GET /games/:gameId/state whenever one is
    // already known.
    if (useGameStore.getState().gameId) {
      void useGameStore.getState().refetchState();
    }
  });

  instance.on('connect_error', (error: Error) => {
    handleConnectError(error);
  });

  instance.on('disconnect', (reason: string) => {
    useSocketStore.getState().setStatus('disconnected', reason);
  });

  instance.on('reconnect_failed', () => {
    useSocketStore.getState().setStatus('error', 'reconnection attempts exhausted');
  });

  instance.onAny((eventName: string, payload: unknown) => {
    useSocketStore.getState().pushEvent(eventName, payload);
    applyLobbyEvent(eventName, payload);
  });

  socket = instance;
}

/**
 * `realtime.gateway.ts`'s `authenticate()` throws the same plain `Error`
 * whether the cause is a missing token, an expired/invalid JWT, or a
 * `gameId` the user isn't a `GamePlayer` of — the client cannot distinguish
 * "token expired" from "wrong gameId" from the `connect_error` message
 * alone. Re-auth is attempted unconditionally (bounded to once per error
 * episode by `reAuthAttempted`) since a wrong `gameId` makes the retry a
 * harmless no-op rather than a wrong action — logged as OD-F1-002 in
 * docs/OPEN_DECISIONS.md (this project) since a status-coded rejection
 * would let this be narrowed, and that's a backend change out of this
 * slice's scope.
 */
function handleConnectError(error: Error): void {
  useSocketStore.getState().setStatus('error', error.message);

  if (reAuthAttempted) {
    return;
  }
  reAuthAttempted = true;

  // Fire-and-forget: the next automatic reconnection attempt (built into
  // socket.io-client, still running per `reconnectionAttempts` above)
  // re-reads the token via the `auth` callback, so no manual `.connect()`
  // call is needed here. If `authenticate()` itself fails, the same bad/no
  // token is retried once more, `connect_error` fires again, and
  // `reAuthAttempted` is already `true` so this branch does not loop.
  void useAuthStore.getState().authenticate();
}

/**
 * `ROOM_CREATED` is deliberately not applied here — the creator already has
 * everything it carries from `POST /rooms`'s own response, and OD-049 notes
 * no other socket can be connected to `game:{gameId}` yet at creation time.
 */
function applyLobbyEvent(eventName: string, payload: unknown): void {
  const lobby = useLobbyStore.getState();

  switch (eventName) {
    case 'PLAYER_JOINED':
      lobby.applyPlayerJoined(payload as JoinedRoom);
      break;
    case 'PLAYER_LEFT':
      lobby.applyPlayerLeft(payload as LeftRoom);
      break;
    case 'PLAYER_READY_CHANGED':
      lobby.applyReadySet(payload as ReadySet);
      break;
    case 'HOST_TRANSFERRED':
      lobby.applyHostTransferred(payload as HostTransferred);
      break;
    case 'PHASE_CHANGED':
      lobby.applyPhaseChanged(payload as { from: GamePhaseName; to: GamePhaseName; round: number });
      useGameStore.getState().applyPhaseChanged(payload as { from: GamePhaseName; to: GamePhaseName; round: number });
      break;
    case 'ROLE_REVEALED':
      useGameStore
        .getState()
        .applyRoleRevealed(payload as { roleCode: RoleCode; team: Team; teammates: GameStateTeammate[] });
      break;
    default:
      break;
  }
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  useSocketStore.getState().reset();
}

export function getSocket(): Socket | null {
  return socket;
}
