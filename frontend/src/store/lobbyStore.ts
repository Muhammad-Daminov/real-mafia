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
  type RoomStatus,
  type RoomVisibility,
  type RulesetMode,
} from '../api/rooms';

export const MIN_PLAYERS_TO_START = 4;

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
  /** Known only for joiners (`JoinedRoom.playerId`) — the creator's own
   * playerId is never returned by `POST /rooms` (see OD-F2-001). `myIsHost`
   * is still tracked correctly for the creator without it — see
   * `applyHostTransferred`'s comment. */
  myPlayerId: string | null;
  myIsHost: boolean;
  myIsReady: boolean;
  snapshotLoading: boolean;
  snapshotError: string | null;
}

interface LobbyActions {
  enterFromCreate: (room: CreatedRoom) => void;
  enterFromJoin: (code: string, room: JoinedRoom) => void;
  applyPlayerJoined: (payload: JoinedRoom) => void;
  applyPlayerLeft: (payload: LeftRoom) => void;
  applyReadySet: (payload: ReadySet) => void;
  applyHostTransferred: (payload: HostTransferred) => void;
  applyPhaseChanged: (payload: { from: GamePhaseName; to: GamePhaseName; round: number }) => void;
  setMyReadyLocally: (isReady: boolean) => void;
  refetchSnapshot: () => Promise<void>;
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
  myPlayerId: null,
  myIsHost: false,
  myIsReady: false,
  snapshotLoading: false,
  snapshotError: null,
};

export const useLobbyStore = create<LobbyState & LobbyActions>((set, get) => ({
  ...initialState,

  enterFromCreate: (room) =>
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
    }),

  // `JoinedRoom` carries no `code`/`visibility`/`rulesetMode` — `code` is
  // passed in from what the user typed (the request that produced this
  // response), the rest is filled in by the `refetchSnapshot` call the
  // screen triggers right after this.
  enterFromJoin: (code, room) =>
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
    }),

  applyPlayerJoined: (payload) => {
    if (get().gameId !== payload.gameId) return;
    set({ playerCount: payload.playerCount });
  },

  applyPlayerLeft: (payload) => {
    if (get().gameId !== payload.gameId) return;
    set({ playerCount: payload.playerCount });
  },

  applyReadySet: (payload) => {
    const state = get();
    if (state.gameId !== payload.gameId) return;
    // Only "our own" ready state is ever knowable client-side (no roster —
    // see OD-F2-001), so this event is applied only when it's about us.
    if (state.myPlayerId && payload.playerId === state.myPlayerId) {
      set({ myIsReady: payload.isReady });
    }
  },

  applyHostTransferred: (payload) => {
    const state = get();
    if (state.gameId !== payload.gameId) return;

    if (state.myPlayerId) {
      set({ myIsHost: payload.newHostPlayerId === state.myPlayerId });
      return;
    }

    // Creator path: `myPlayerId` is unknown (OD-F2-001), but if I currently
    // believe I'm host, a host-transfer event firing means host moved away
    // from me — that's a valid deduction from event semantics, not
    // fabricated data.
    if (state.myIsHost) {
      set({ myIsHost: false });
    }
  },

  applyPhaseChanged: (payload) => {
    set({ currentPhase: payload.to });
  },

  setMyReadyLocally: (isReady) => set({ myIsReady: isReady }),

  refetchSnapshot: async () => {
    const code = get().code;
    if (!code) return;

    set({ snapshotLoading: true, snapshotError: null });
    try {
      const snapshot = await getRoomByCode(code);
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
        snapshotLoading: false,
      });
    } catch (error) {
      set({
        snapshotLoading: false,
        snapshotError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  reset: () => set(initialState),
}));

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
