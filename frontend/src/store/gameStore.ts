import { create } from 'zustand';
import { ApiError } from '../api/client';
import { getGameState, type GameResultPlayer, type GameStateResponse, type GameStateTeammate, type LifeStatus, type RoleCode, type Team, type WinnerTeam } from '../api/games';
import type { SubmittedNightAction } from '../api/nightActions';
import { getVoteTally, type CastVoteResponse, type VoteTallyEntry } from '../api/votes';
import { getRoomByCode, type GamePhaseName, type GameStatus, type RoomPlayerSummary } from '../api/rooms';
import { writeStoredGameId } from '../auth/gameIdStorage';
import { writeStoredRoomCode } from '../auth/roomCodeStorage';
import type { NightActionType } from '../game/nightAbility';
import { computeDeathDiff, type DeathDiff } from '../game/deathDiff';

/** Trailing debounce for roster refetches triggered in quick succession
 * (e.g. a socket reconnect landing right after a PHASE_CHANGED) — same
 * value/reasoning as `lobbyStore.ts`'s `REFETCH_DEBOUNCE_MS`. */
const ROSTER_REFETCH_DEBOUNCE_MS = 150;
/** Same debounce, separate timer — a vote tally refetch and a roster
 * refetch are independent request pipelines (F5). */
const VOTE_TALLY_REFETCH_DEBOUNCE_MS = 150;

export interface MySubmittedAction {
  actionType: NightActionType;
  targetPlayerId: string;
  targetPlayerId2: string | null;
}

export interface NightResult {
  event: string;
  payload: Record<string, unknown>;
}

/**
 * F5.1: looser than the REST `GameResultPayload` (api/games.ts) —
 * `finishedAt`/`players` are `null` for the `GAME_FINISHED` socket
 * event's own provisional write (the event only ever carries
 * `winnerTeam`), populated once the REST refetch it triggers resolves.
 * `winnerTeam: null` only arises if a future backend value isn't one
 * `WinnerTeam` already recognizes — never guessed, never defaulted to a
 * specific team.
 */
export interface GameResult {
  winnerTeam: WinnerTeam | null;
  finishedAt: string | null;
  players: GameResultPlayer[] | null;
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
  /** F4.1: the room code `GET /rooms/:code`'s roster read is keyed by —
   * `lobbyStore.code` for the normal in-session path, or
   * `auth/roomCodeStorage.ts` on a reload (see `setRoomCode`). `null` means
   * the roster is permanently unavailable for this session (no stored code
   * to recover from) — a distinct, honest state from "loading". */
  roomCode: string | null;
  /** The last successful `GET /rooms/:code` roster — `null` before the
   * first fetch resolves. `RoomPlayerSummary.lifeStatus` is what
   * `game/nightTargets.ts` filters on; never carries `roleCode`/`team`. */
  roster: RoomPlayerSummary[] | null;
  rosterLoading: boolean;
  rosterError: string | null;
  /** F5: the `from` side of the most recent `PHASE_CHANGED` — read by
   * `refetchRoster` to tag a freshly-computed `lastDeaths` diff with which
   * transition produced it. Not meant to be read directly by a screen. */
  lastPhaseFrom: GamePhaseName | null;
  /** F5/OD-F5-001: who flipped alive -> not-alive since the previous
   * roster snapshot, recomputed fresh on every `refetchRoster` call (never
   * accumulated) — the only signal available for "who died," since no
   * event names a single night death (`MULTIPLE_DEATHS` only fires for
   * >1) or a vote execution's target at all. `null` once a refetch finds
   * nothing new. */
  lastDeaths: DeathDiff | null;
  /** F5: this round's own submitted vote (`POST /games/:gameId/votes`'s
   * response), cleared on every phase change — mirrors `mySubmittedAction`. */
  myVote: string | null;
  /** F5/OD-020(a): every current-round vote, refetched (debounced) on
   * every `VOTE_CAST` broadcast and on entering/leaving `VOTING` — never
   * patched in place from the event payload (same "refetch over patch"
   * convention `lobbyStore.ts` already established for partial events). */
  voteTally: VoteTallyEntry[] | null;
  voteTallyError: string | null;
  /** F5.1/OD-F5-001 (resolved by backend 95a2908): comes from EITHER the
   * `GAME_FINISHED` socket event (provisional — `winnerTeam` only) OR
   * `GET /games/:gameId/state`'s `result` (authoritative — also carries
   * the full role reveal). REST always wins if the two ever disagree —
   * see `applyGameResult`. A reload now recovers the full result via
   * REST; only a session whose `gameId` predates the game actually
   * finishing has nothing to show yet. */
  gameResult: GameResult | null;
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
  /** Sets the room code the roster is keyed by and persists it (so a
   * reload can recover it, OD-F4-001) — called once from `App.tsx` as soon
   * as the code is known (normal path: `lobbyStore.code`; reload path:
   * `auth/roomCodeStorage.ts`). Also schedules an immediate (debounced)
   * roster refetch. */
  setRoomCode: (code: string) => void;
  /** Re-fetches `GET /rooms/:code`'s roster for the already-known
   * `roomCode` — called on game start, every `PHASE_CHANGED`, and every
   * socket reconnect (no event replay on the backend, same reasoning as
   * `refetchState`). A no-op when `roomCode` isn't known yet. */
  refetchRoster: () => Promise<void>;
  /** Sets `myVote` from a successful `POST /games/:gameId/votes` response. */
  applyVoteSubmitted: (response: CastVoteResponse) => void;
  /** `VOTE_CAST` socket handler — schedules a debounced tally refetch
   * rather than patching from the event's own `{voterPlayerId,
   * targetPlayerId}` payload (same "refetch over patch" reasoning
   * `lobbyStore.ts` already applies to its own partial-payload events). */
  applyVoteCast: () => void;
  /** Re-fetches `GET /games/:gameId/votes` for the already-known `gameId`. */
  refetchVoteTally: () => Promise<void>;
  /**
   * The one path every `gameResult` write goes through (task: "single
   * code path, REST wins if both disagree"). `source: 'rest'` always
   * overwrites outright — `GET /games/:gameId/state`'s `result` is
   * authoritative whenever it's present at all. `source: 'event'` (the
   * `GAME_FINISHED` socket payload) only ever writes a provisional entry,
   * and is ignored outright once a `'rest'` write has already supplied
   * the full `players` list — a later event can never un-reveal roles
   * REST already confirmed.
   */
  applyGameResult: (result: GameResult, source: 'rest' | 'event') => void;
  /** `GAME_FINISHED` socket handler — writes a provisional `gameResult`
   * (via `applyGameResult`, `source: 'event'`) and triggers one
   * `refetchState` so the full REST result (role reveal included)
   * arrives, unless it already has. */
  applyGameFinished: (winnerTeam: WinnerTeam | null) => void;
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
  roomCode: null,
  roster: null,
  rosterLoading: false,
  rosterError: null,
  lastPhaseFrom: null,
  lastDeaths: null,
  myVote: null,
  voteTally: null,
  voteTallyError: null,
  gameResult: null,
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

/** Independent of `stateSeq` — a roster refetch and a state refetch are
 * separate request pipelines and must not invalidate each other. Same
 * "bump on fetch, check after resolve" pattern as `stateSeq`/
 * `lobbyStore.ts`'s `refetchSeq`. */
let rosterSeq = 0;
let rosterRefetchTimer: ReturnType<typeof setTimeout> | null = null;

/** Independent of `rosterSeq`/`stateSeq` — F5's own request pipeline. */
let voteTallySeq = 0;
let voteTallyRefetchTimer: ReturnType<typeof setTimeout> | null = null;

export const useGameStore = create<GameState & GameActions>((set, get) => {
  function scheduleRosterRefetch(): void {
    if (rosterRefetchTimer) clearTimeout(rosterRefetchTimer);
    rosterRefetchTimer = setTimeout(() => {
      rosterRefetchTimer = null;
      void get().refetchRoster();
    }, ROSTER_REFETCH_DEBOUNCE_MS);
  }

  function scheduleVoteTallyRefetch(): void {
    if (voteTallyRefetchTimer) clearTimeout(voteTallyRefetchTimer);
    voteTallyRefetchTimer = setTimeout(() => {
      voteTallyRefetchTimer = null;
      void get().refetchVoteTally();
    }, VOTE_TALLY_REFETCH_DEBOUNCE_MS);
  }

  return {
  ...initialState,

  initFromGameId: async (gameId) => {
    const seq = ++stateSeq;
    set({ ...initialState, gameId, stateLoading: true });

    try {
      const snapshot = await getGameState(gameId);
      if (seq !== stateSeq) return; // superseded

      writeStoredGameId(snapshot.gameId);
      set(applySnapshot(snapshot));
      // F5.1: present only once status is FINISHED — reload/reconnect's
      // one path to the full result, no "stuck waiting" state.
      if (snapshot.result) {
        get().applyGameResult(
          { winnerTeam: snapshot.result.winnerTeam, finishedAt: snapshot.result.finishedAt, players: snapshot.result.players },
          'rest',
        );
      }
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
      if (snapshot.result) {
        get().applyGameResult(
          { winnerTeam: snapshot.result.winnerTeam, finishedAt: snapshot.result.finishedAt, players: snapshot.result.players },
          'rest',
        );
      }
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
      // F5: a vote only applies within the one VOTING occurrence that
      // produced it, same reasoning as mySubmittedAction. The tally is
      // refetched fresh below rather than carried forward.
      myVote: null,
      voteTally: null,
      // `refetchRoster` reads this once it resolves, to tag a freshly
      // computed `lastDeaths` diff with which transition produced it.
      lastPhaseFrom: payload.from,
    });
    // PHASE_CHANGED carries no `phaseEndsAt` — refetch to learn the new
    // phase's deadline. Fire-and-forget; `refetchState` itself guards
    // against out-of-order responses.
    void get().refetchState();
    // F4.1: a death may have just happened (NIGHT -> NIGHT_RESOLUTION) —
    // the roster's lifeStatus is stale until refetched. No-ops via
    // `refetchRoster` itself if `roomCode` isn't known yet. F5: also the
    // only way to learn who a vote executed (OD-F5-001) — same refetch
    // serves both.
    scheduleRosterRefetch();
    // F5: refetch the tally on every phase change — relevant on entering
    // VOTING (fresh round) and harmless elsewhere (GET /games/:gameId/votes
    // just returns the current, non-voting phase's empty vote list).
    scheduleVoteTallyRefetch();
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

  setRoomCode: (code) => {
    writeStoredRoomCode(code);
    set({ roomCode: code });
    scheduleRosterRefetch();
  },

  refetchRoster: async () => {
    const code = get().roomCode;
    if (!code) return;

    const seq = ++rosterSeq;
    set({ rosterLoading: true, rosterError: null });

    try {
      const summary = await getRoomByCode(code);
      if (seq !== rosterSeq) return; // superseded

      // `players` is omitted (not `[]`) for a non-member (OD-055) — by the
      // time this runs the caller is always an active game member, but
      // treat an absent roster as "not yet available" rather than crashing.
      const nextRoster = summary.players ?? null;
      // F5/OD-F5-001: computed against the *previous* in-memory roster,
      // before it's overwritten below — the only signal for "who died"
      // this codebase has (no event names a single night death or a vote
      // execution's target). Recomputed fresh every call, never
      // accumulated — `null` once a later refetch finds nothing new.
      const lastDeaths = computeDeathDiff(get().roster, nextRoster, get().lastPhaseFrom);
      set({ roster: nextRoster, rosterLoading: false, lastDeaths });
    } catch (error) {
      if (seq !== rosterSeq) return;
      set({ rosterLoading: false, rosterError: error instanceof Error ? error.message : String(error) });
    }
  },

  applyVoteSubmitted: (response) => {
    set({ myVote: response.targetPlayerId });
  },

  applyVoteCast: () => {
    scheduleVoteTallyRefetch();
  },

  refetchVoteTally: async () => {
    const gameId = get().gameId;
    if (!gameId) return;

    const seq = ++voteTallySeq;
    set({ voteTallyError: null });

    try {
      const tally = await getVoteTally(gameId);
      if (seq !== voteTallySeq) return; // superseded

      set({ voteTally: tally });
    } catch (error) {
      if (seq !== voteTallySeq) return;
      set({ voteTallyError: error instanceof Error ? error.message : String(error) });
    }
  },

  applyGameResult: (result, source) => {
    if (source === 'event' && get().gameResult?.players) return; // REST already won
    set({ gameResult: result });
  },

  applyGameFinished: (winnerTeam) => {
    get().applyGameResult({ winnerTeam, finishedAt: null, players: null }, 'event');
    if (!get().gameResult?.players) {
      void get().refetchState();
    }
  },

  dismissRoleReveal: () => set({ roleRevealDismissed: true }),

  reset: () => {
    stateSeq++; // invalidate any in-flight request
    rosterSeq++;
    voteTallySeq++;
    writeStoredGameId(null);
    writeStoredRoomCode(null);
    set(initialState);
  },
  };
});
