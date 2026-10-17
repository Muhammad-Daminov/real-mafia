import type { GamePhaseName } from '../api/rooms';
import type { RoleCode, Team } from '../api/games';
import { uz } from '../messages/uz';

/** Safe fallback for a phase name the frontend doesn't recognize — the
 * backend enum is closed (12 values, `prisma/schema.prisma`'s
 * `GamePhaseName`), but this keeps an unexpected value from crashing the
 * screen instead of just mislabeling it. */
export function phaseLabel(phase: GamePhaseName | string): string {
  return (uz.phases as Record<string, string>)[phase] ?? uz.phases.unknown;
}

export function teamLabel(team: Team | string): string {
  return (uz.teams as Record<string, string>)[team] ?? team;
}

/** Safe fallback for a role code the frontend doesn't recognize — same
 * reasoning as `phaseLabel`. Pre-GAME_OVER this only ever renders the
 * caller's own role (§ROLE_REVEAL scope: never show other players' roles
 * mid-game); `GameEndScreen` is the one post-GAME_OVER exception, backed by
 * the backend's own full reveal (`GameResultPlayer`, B-R4) — there is
 * nothing left to protect once the game has ended. */
export function roleInfo(roleCode: RoleCode | string): { name: string; ability: string } {
  return (uz.roles as Record<string, { name: string; ability: string }>)[roleCode] ?? uz.roles.unknown;
}
