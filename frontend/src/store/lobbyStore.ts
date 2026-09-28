import { create } from 'zustand';
import {
  getRoomByCode,
  type CreatedRoom,
  type GamePhaseName,
  type GameStatus,
  type HostTransferred,
  type JoinedRoom,
  type LeftRoom,
  type ReadySet,
  type RoomPlayerSummary,
  type RoomStatus,
  type RoomVisibility,
  type RulesetMode,
} from '../api/rooms';
import { uz } from '../messages/uz';

export const MIN_PLAYERS_TO_START = 4;

/** Trailing debounce for roster refetches triggered by realtime events —
 * coalesces a burst (e.g. several players joining in quick succession)
 * into a single `GET /rooms/:code` call. */
const REFETCH_DEBOUNCE_MS = 150;

export interface LobbyState {
  roomId: string | null;
  gameId: string | null;
  code: string | null;
  visibility: RoomVisibility | null;
  roomStatus: RoomStatus | null;
  rulesetMode: RulesetMode | null;
  maxPlayers: number | null;
  gameStatus: GameStatus | null;
  currentPhase: GamePhaseName | null;
  playerCount: number;
  /** F2.1: the roster itself, from the last successful snapshot — `null`
   * before the first fetch resolves. Source of truth for rendering; also
   * used to derive `myPlayerId`/`myIsHost`/`myIsReady` below. */
  players: RoomPlayerSummary[] | null;
  /** Known for joiners from `JoinedRoom.playerId`. For the creator (whose
   * own playerId is never returned by `POST /rooms`), identified from the
   * first roster fetch as "the sole host" — see `resolveMyPlayerId`. Once
   * set, never recomputed — see that function's comment for why this stays
   * correct even after a later host transfer. */
  myPlayerId: string | null;
  /** Derived from `players` by matching `myPlayerId`, every snapshot. */
  myIsHost: boolean;
  myIsReady: boolean;
  snapshotLoading: boolean;
  snapshotError: string | null;
  /** One-shot message for the screen the user lands on after being kicked
   * back to Home (e.g. `players` came back absent — see `refetchSnapshot`).
   * Cleared by `clearNotice()`, which `HomeScreen` calls on mount. */
  notice: string | null;
}

interface LobbyActions {
  enterFromCreate: (room: CreatedRoom) => void;
  enterFromJoin: (code: string, room: JoinedRoom) => void;
  applyPlayerJoined: (payload: JoinedRoom) => void;
  applyPlayerLeft: (payload: LeftRoom) => void;
  applyReadySet: (payload: ReadySet) => void;
  applyHostTransferred: (payload: HostTransferred) => void;
  applyPhaseChanged: (payload: { from: GamePhaseName; to: GamePhaseName; round: number }) => void;
  refetchSnapshot: () => Promise<void>;
  clearNotice: () => void;
  reset: () => void;
}

const initialState: LobbyState = {
  roomId: null,
  gameId: null,
  code: null,
  visibility: null,
  roomStatus: null,
  rulesetMode: null,
  maxPlayers: null,
  gameStatus: null,
  currentPhase: null,
  playerCount: 0,
  players: null,
  myPlayerId: null,
  myIsHost: false,
  myIsReady: false,
  snapshotLoading: false,
  snapshotError: null,
  notice: null,
};

/**
 * The creator's own `playerId` is never returned by `POST /rooms` — but
 * right after creation, before any `HOST_TRANSFERRED`, the creator is
 * unambiguously "whichever roster entry is host" (there's exactly one
 * host, and it's provably them: `createRoomTransaction` seats the creator
 * as both the sole player and the host, atomically). Only used while
 * `myPlayerId` is still unresolved — once found, it's pinned in state and
 * this function is never consulted again, so it staying "true only at
 * creation time" doesn't matter for later host transfers.
 */
function resolveMyPlayerId(
  state: Pick<LobbyState, 'myPlayerId' | 'myIsHost'>,
  players: RoomPlayerSummary[],
): string | null {
  if (state.myPlayerId) return state.myPlayerId;
  if (state.myIsHost) {
    return players.find((p) => p.isHost)?.playerId ?? null;
  }
  return null;
}

let refetchTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on every `refetchSnapshot` call and checked after the request
 * resolves, so a response for a since-superseded request is dropped
 * instead of clobbering state with stale data (out-of-order responses). */
let refetchSeq = 0;

function clearScheduledRefetch(): void {
  if (refetchTimer) {
    clearTimeout(refetchTimer);
    refetchTimer = null;
  }
}

export const useLobbyStore = create<LobbyState & LobbyActions>((set, get) => {
  function scheduleRefetch(): void {
    clearScheduledRefetch();
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      void get().refetchSnapshot();
    }, REFETCH_DEBOUNCE_MS);
  }

  return {
    ...initialState,

    enterFromCreate: (room) => {
      clearScheduledRefetch();
      set({
        ...initialState,
        roomId: room.roomId,
        gameId: room.gameId,
        code: room.code,
        visibility: room.visibility,
        rulesetMode: room.rulesetMode,
        maxPlayers: room.maxPlayers,
        // A freshly created Room+Game is always OPEN/LOBBY — guaranteed by
        // `RoomsService.createRoomTransaction`, not an invented default.
        roomStatus: 'OPEN',
        gameStatus: 'LOBBY',
        currentPhase: 'LOBBY',
        playerCount: 1,
        myIsHost: true,
      });
    },

    // `JoinedRoom` carries no `code`/`visibility`/`rulesetMode` — `code` is
    // passed in from what the user typed (the request that produced this
    // response), the rest is filled in by the `refetchSnapshot` call the
    // screen triggers right after this.
    enterFromJoin: (code, room) => {
      clearScheduledRefetch();
      set({
        ...initialState,
        roomId: room.roomId,
        gameId: room.gameId,
        code,
        maxPlayers: room.maxPlayers,
        roomStatus: 'OPEN',
        gameStatus: 'LOBBY',
        currentPhase: 'LOBBY',
        playerCount: room.playerCount,
        myPlayerId: room.playerId,
        myIsHost: false,
      });
    },

    // F2.1: event payloads only ever carry the *acting* player (join/leave/
    // ready/host-transfer), never a full roster — so every lobby event just
    // schedules a debounced roster refetch instead of trying to patch
    // `players` in place from a partial payload.
    applyPlayerJoined: (payload) => {
      if (get().gameId !== payload.gameId) return;
      scheduleRefetch();
    },

    applyPlayerLeft: (payload) => {
      if (get().gameId !== payload.gameId) return;
      scheduleRefetch();
    },

    applyReadySet: (payload) => {
      if (get().gameId !== payload.gameId) return;
      scheduleRefetch();
    },

    applyHostTransferred: (payload) => {
      if (get().gameId !== payload.gameId) return;
      scheduleRefetch();
    },

    applyPhaseChanged: (payload) => {
      set({ currentPhase: payload.to });
    },

    refetchSnapshot: async () => {
      const code = get().code;
      if (!code) return;

      const seq = ++refetchSeq;
      set({ snapshotLoading: true, snapshotError: null });

      try {
        const snapshot = await getRoomByCode(code);
        if (seq !== refetchSeq) return; // superseded by a newer request

        if (!snapshot.players) {
          // Not a member (or removed) — treated as "not in room": bail out
          // to Home with a friendly, one-shot notice rather than crashing
          // or rendering a broken lobby.
          set({ ...initialState, notice: uz.lobby.removedNotice });
          return;
        }

        const myPlayerId = resolveMyPlayerId(get(), snapshot.players);
        const mine = myPlayerId ? snapshot.players.find((p) => p.playerId === myPlayerId) : undefined;

        set({
          roomId: snapshot.roomId,
          gameId: snapshot.gameId,
          code: snapshot.code,
          visibility: snapshot.visibility,
          roomStatus: snapshot.status,
          rulesetMode: snapshot.rulesetMode,
          maxPlayers: snapshot.maxPlayers,
          gameStatus: snapshot.gameStatus,
          playerCount: snapshot.playerCount,
          players: snapshot.players,
          myPlayerId,
          myIsHost: mine?.isHost ?? get().myIsHost,
          myIsReady: mine?.isReady ?? get().myIsReady,
          snapshotLoading: false,
        });
      } catch (error) {
        if (seq !== refetchSeq) return;
        set({
          snapshotLoading: false,
          snapshotError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    clearNotice: () => set({ notice: null }),

    reset: () => {
      clearScheduledRefetch();
      refetchSeq++; // invalidate any in-flight request
      set(initialState);
    },
  };
});

export interface StartGameGate {
  enabled: boolean;
  reasonKey: 'NOT_HOST' | 'NOT_ENOUGH_PLAYERS' | 'NOT_IN_LOBBY' | null;
}

/**
 * Pure function mirroring `startGameTransaction`'s actual checks — host,
 * the *Game* row's status must be `LOBBY` (`locked[0].status !== 'LOBBY'`
 * throws `ROOM_NOT_IN_LOBBY`, despite the code's own name — confirmed by
 * reading `startGameTransaction`, it locks and checks `games.status`, not
 * `rooms.status`), and `playerCount >= MIN_PLAYERS_TO_START`. No readiness
 * check, per OD-014. Kept pure/exported so it's testable without the store.
 */
export function canStartGame(state: {
  myIsHost: boolean;
  playerCount: number;
  gameStatus: GameStatus | null;
}): StartGameGate {
  if (!state.myIsHost) {
    return { enabled: false, reasonKey: 'NOT_HOST' };
  }
  if (state.gameStatus !== 'LOBBY') {
    return { enabled: false, reasonKey: 'NOT_IN_LOBBY' };
  }
  if (state.playerCount < MIN_PLAYERS_TO_START) {
    return { enabled: false, reasonKey: 'NOT_ENOUGH_PLAYERS' };
  }
  return { enabled: true, reasonKey: null };
}
