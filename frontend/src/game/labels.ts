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
 * reasoning as `phaseLabel`. Never logs the role code itself (§ROLE_REVEAL
 * scope: never log other players' roles; this only ever renders the
 * caller's own). */
export function roleInfo(roleCode: RoleCode | string): { name: string; ability: string } {
  return (uz.roles as Record<string, { name: string; ability: string }>)[roleCode] ?? uz.roles.unknown;
}
