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

/** `prisma/schema.prisma`'s `LifeStatus` enum, verbatim. */
export type LifeStatus = 'WAITING' | 'ALIVE' | 'DEAD' | 'LEFT';

export interface GameStateTeammate {
  playerId: string;
  roleCode: RoleCode;
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
