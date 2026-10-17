import { apiFetch } from './client';
import type { GamePhaseName, GameStatus } from './rooms';

/**
 * `src/prisma/schema.prisma`'s `RoleCode` enum, verbatim — 9 roles, no
 * subset (../../../src/game-engine/roles.ts has no 10th role anywhere).
 */
export type RoleCode =
  | 'MAFIA'
  | 'DON'
  | 'DETECTIVE'
  | 'SHERIFF'
  | 'DOCTOR'
  | 'BODYGUARD'
  | 'MANIAC'
  | 'JOURNALIST'
  | 'CIVILIAN';

/** `game-engine/roles.ts`'s `Team` type, verbatim. */
export type Team = 'TOWN' | 'MAFIA' | 'NEUTRAL';

/** `prisma/schema.prisma`'s `WinnerTeam` enum, verbatim — the one extra
 * value over `Team` (`DRAW`) is a real, distinct outcome (OD-018: a tie
 * for the top vote spot leads to no execution, but `WinnerTeam` itself is
 * only ever `DRAW` from `win-evaluator.ts`'s own win-condition logic, not
 * from vote ties). Only ever seen in the `GAME_FINISHED` socket payload —
 * no REST endpoint returns it (see frontend/docs/OPEN_DECISIONS.md
 * OD-F5-001). */
export type WinnerTeam = 'TOWN' | 'MAFIA' | 'NEUTRAL' | 'DRAW';

/** `prisma/schema.prisma`'s `LifeStatus` enum, verbatim. */
export type LifeStatus = 'WAITING' | 'ALIVE' | 'DEAD' | 'LEFT';

export interface GameStateTeammate {
  playerId: string;
  roleCode: RoleCode;
}

/**
 * `GamesService.GameResultPlayer` (backend commit 95a2908, B-R4) — every
 * seated player, full role reveal. Only ever present once the game has
 * ended (`result` below); never leaked a moment before that.
 */
export interface GameResultPlayer {
  playerId: string;
  displayName: string;
  roleCode: RoleCode;
  team: Team;
  lifeStatus: LifeStatus;
}

/** `GamesService.GameResultPayload` — see `GameStateResponse.result`'s own docstring. */
export interface GameResultPayload {
  winnerTeam: WinnerTeam;
  finishedAt: string;
  players: GameResultPlayer[];
}

/**
 * `GET /games/:gameId/state` (../../../src/games/games.service.ts,
 * `GamesService.getMyState`, backend commit b30442c, OD-059) — the response
 * is `GameStateResponse` verbatim, no wrapper. `myRoleCode`/`myTeam` are
 * `null` before `ROLE_REVEAL` (no `GameRoleAssignment` row exists yet).
 * `teammates` is non-empty only for a MAFIA-team caller (OD-025) — empty
 * for every other role, never another team's membership.
 */
export interface GameStateResponse {
  gameId: string;
  status: GameStatus;
  currentPhase: GamePhaseName;
  round: number;
  phaseEndsAt: string | null;
  myPlayerId: string;
  myLifeStatus: LifeStatus;
  myRoleCode: RoleCode | null;
  myTeam: Team | null;
  teammates: GameStateTeammate[];
  /** B-R4/OD-F5-001 (resolved): present ONLY when `status === 'FINISHED'` —
   * `undefined` (the key absent, not a half-filled placeholder) while
   * `RUNNING` or earlier. The full role reveal + winner — safe once the
   * game has actually ended (§12.7 is a mid-game rule). Does NOT carry
   * `diedInRound`/`deathCause` — OD-061 found those not derivable without
   * a backend schema change; do not build on fields that aren't here. */
  result?: GameResultPayload;
}

/**
 * 404 `PLAYER_NOT_IN_GAME` (`game-state.errors.ts`) for both a nonexistent
 * `gameId` and a `gameId` the caller isn't a member of — indistinguishable
 * by design (the backend never confirms/denies existence to a non-member).
 * Surfaces as `ApiError` with `status === 404` — same `apiFetch` wrapper,
 * same `ApiError` shape every other authenticated call already uses.
 */
export function getGameState(gameId: string): Promise<GameStateResponse> {
  return apiFetch<GameStateResponse>(`/games/${encodeURIComponent(gameId)}/state`);
}
