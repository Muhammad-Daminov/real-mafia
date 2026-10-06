import { create } from 'zustand';
import { ApiError } from '../api/client';
import { getGameState, type GameStateResponse, type GameStateTeammate, type LifeStatus, type RoleCode, type Team } from '../api/games';
import type { SubmittedNightAction } from '../api/nightActions';
import type { GamePhaseName, GameStatus } from '../api/rooms';
import { writeStoredGameId } from '../auth/gameIdStorage';
import type { NightActionType } from '../game/nightAbility';

export interface MySubmittedAction {
  actionType: NightActionType;
  targetPlayerId: string;
  targetPlayerId2: string | null;
}

export interface NightResult {
  event: string;
  payload: Record<string, unknown>;
}

export interface GameState {
  gameId: string | null;
  status: GameStatus | null;
  phase: GamePhaseName | null;
  round: number;
  phaseEndsAt: string | null;
  myPlayerId: string | null;
  myLifeStatus: LifeStatus | null;
  myRoleCode: RoleCode | null;
  myTeam: Team | null;
  teammates: GameStateTeammate[];
  /** F3: the role-reveal screen is shown once per `myRoleCode` becoming
   * known; dismissing it flips this so the phase screen (with its "My
   * role" chip) takes over. Reset along with everything else on `reset()`. */
  roleRevealDismissed: boolean;
  /** F4: this round's own submitted night action, from `POST
   * /games/:gameId/night-actions`'s response — cleared on every phase
   * change (a submission only makes sense within the one NIGHT occurrence
   * that produced it; a new NIGHT round needs a fresh one). */
  mySubmittedAction: MySubmittedAction | null;
  /** F4/§17.5/OD-048: the private per-actor result delivered at the NIGHT ->
   * NIGHT_RESOLUTION transition (DON_CHECK_RESULT/SHERIFF_RESULT/
   * GUARD_CONSUMED/DETECTIVE_RESULT/JOURNALIST_RESULT/
   * DOCTOR_PROTECT_RESULT — KILL has no result event). Persists through the
   * following day phases so the next phase screen can show it; cleared only
   * when a fresh NIGHT starts (not on every phase change, unlike
   * `mySubmittedAction`). */
  nightResult: NightResult | null;
  stateLoading: boolean;
  stateError: string | null;
}

interface GameActions {
  /** Sets `gameId` and fetches the full snapshot — the entry point used
   * once a game is known to have started (`currentPhase !== 'LOBBY'`). */
  initFromGameId: (gameId: string) => Promise<void>;
  /** Re-fetches `GET /games/:gameId/state` for the already-known `gameId` —
   * called on every socket (re)connect and after every `PHASE_CHANGED`
   * (whose payload carries no `phaseEndsAt`, so a refetch is the only way
   * to learn the new phase's deadline; see rooms.service.ts/
   * phase-transition.service.ts, grepped for `phaseEndsAt` — it's only on
   * this endpoint, never on the socket payload). */
  refetchState: () => Promise<void>;
  applyRoleRevealed: (payload: { roleCode: RoleCode; team: Team; teammates: GameStateTeammate[] }) => void;
  applyPhaseChanged: (payload: { from: GamePhaseName; to: GamePhaseName; round: number }) => void;
  applyActionSubmitted: (action: SubmittedNightAction) => void;
  applyNightResult: (event: string, payload: Record<string, unknown>) => void;
  dismissRoleReveal: () => void;
  reset: () => void;
}

const initialState: GameState = {
  gameId: null,
  status: null,
  phase: null,
  round: 0,
  phaseEndsAt: null,
  myPlayerId: null,
  myLifeStatus: null,
  myRoleCode: null,
  myTeam: null,
  teammates: [],
  roleRevealDismissed: false,
  mySubmittedAction: null,
  nightResult: null,
  stateLoading: false,
  stateError: null,
};

function applySnapshot(snapshot: GameStateResponse): Partial<GameState> {
  return {
    gameId: snapshot.gameId,
    status: snapshot.status,
    phase: snapshot.currentPhase,
    round: snapshot.round,
    phaseEndsAt: snapshot.phaseEndsAt,
    myPlayerId: snapshot.myPlayerId,
    myLifeStatus: snapshot.myLifeStatus,
    myRoleCode: snapshot.myRoleCode,
    myTeam: snapshot.myTeam,
    teammates: snapshot.teammates,
    stateLoading: false,
    stateError: null,
  };
}

/** Bumped on every fetch, checked after it resolves — a response for a
 * since-superseded request (reset, or a newer refetch already in flight)
 * is dropped instead of clobbering state with stale data. Same pattern as
 * `lobbyStore.ts`'s `refetchSeq`. */
let stateSeq = 0;

/** OD-F3-002: a definitive "not a member" means the persisted `gameId`
 * (`auth/gameIdStorage.ts`) is stale — clear it so a reload doesn't keep
 * retrying a game the caller is no longer in. Never cleared for a
 * transient/network failure (anything that isn't this specific 404). */
function isNotAMember(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'PLAYER_NOT_IN_GAME';
}

export const useGameStore = create<GameState & GameActions>((set, get) => ({
  ...initialState,

  initFromGameId: async (gameId) => {
    const seq = ++stateSeq;
    set({ ...initialState, gameId, stateLoading: true });

    try {
      const snapshot = await getGameState(gameId);
      if (seq !== stateSeq) return; // superseded

      writeStoredGameId(snapshot.gameId);
      set(applySnapshot(snapshot));
    } catch (error) {
      if (seq !== stateSeq) return;
      // A definitive "not a member" also clears `gameId` itself, not just
      // storage — otherwise `App.tsx`'s routing (gated on `gameStore.gameId`
      // being set) stays stuck on a broken game screen instead of falling
      // through to Home, the task's own explicit fallback for "no way to
      // recover". A transient/network failure leaves `gameId` alone so a
      // retry still has something to retry.
      set({
        stateLoading: false,
        stateError: error instanceof Error ? error.message : String(error),
        ...(isNotAMember(error) ? { gameId: null } : {}),
      });
      if (isNotAMember(error)) writeStoredGameId(null);
    }
  },

  refetchState: async () => {
    const gameId = get().gameId;
    if (!gameId) return;

    const seq = ++stateSeq;
    set({ stateLoading: true, stateError: null });

    try {
      const snapshot = await getGameState(gameId);
      if (seq !== stateSeq) return;

      set(applySnapshot(snapshot));
    } catch (error) {
      if (seq !== stateSeq) return;
      // A definitive "not a member" also clears `gameId` itself, not just
      // storage — otherwise `App.tsx`'s routing (gated on `gameStore.gameId`
      // being set) stays stuck on a broken game screen instead of falling
      // through to Home, the task's own explicit fallback for "no way to
      // recover". A transient/network failure leaves `gameId` alone so a
      // retry still has something to retry.
      set({
        stateLoading: false,
        stateError: error instanceof Error ? error.message : String(error),
        ...(isNotAMember(error) ? { gameId: null } : {}),
      });
      if (isNotAMember(error)) writeStoredGameId(null);
    }
  },

  applyRoleRevealed: (payload) => {
    set({ myRoleCode: payload.roleCode, myTeam: payload.team, teammates: payload.teammates });
  },

  applyPhaseChanged: (payload) => {
    set({
      phase: payload.to,
      round: payload.round,
      // F4: a submission only applies within the one NIGHT occurrence that
      // produced it — any phase change invalidates it. `nightResult`
      // outlives the phase change that delivers it (shown through the
      // following day phases) and is only cleared once a fresh NIGHT starts.
      mySubmittedAction: null,
      ...(payload.to === 'NIGHT' ? { nightResult: null } : {}),
    });
    // PHASE_CHANGED carries no `phaseEndsAt` — refetch to learn the new
    // phase's deadline. Fire-and-forget; `refetchState` itself guards
    // against out-of-order responses.
    void get().refetchState();
  },

  applyActionSubmitted: (action) => {
    set({
      mySubmittedAction: {
        actionType: action.actionType,
        targetPlayerId: action.targetPlayerId,
        targetPlayerId2: action.targetPlayerId2,
      },
    });
  },

  applyNightResult: (event, payload) => {
    set({ nightResult: { event, payload } });
  },

  dismissRoleReveal: () => set({ roleRevealDismissed: true }),

  reset: () => {
    stateSeq++; // invalidate any in-flight request
    writeStoredGameId(null);
    set(initialState);
  },
}));
