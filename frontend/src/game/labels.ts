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

/** F7a: the team-color accent (`styles/tokens.css`'s `--rm-team-*`) behind
 * RoleReveal/GameEnd's role cards — same safe-fallback shape as
 * `teamLabel`/`phaseLabel`, a neutral gray for anything the frontend
 * doesn't recognize rather than guessing a team's color. */
export function teamColorVar(team: Team | string): string {
  switch (team) {
    case 'TOWN':
      return 'var(--rm-team-town)';
    case 'MAFIA':
      return 'var(--rm-team-mafia)';
    case 'NEUTRAL':
      return 'var(--rm-team-neutral)';
    default:
      return 'var(--rm-text-2)';
  }
}

/** F7b: `GameEndScreen`'s role-reveal list, grouped by team — TOWN/MAFIA/
 * NEUTRAL in that fixed order (the backend's own `WinnerTeam`/`Team`
 * enum order, not alphabetical or arrival order), with any team this
 * frontend doesn't recognize appended last as its own group rather than
 * dropped. Groups with no players are omitted entirely. */
export function groupByTeam<T extends { team: Team | string }>(players: T[]): { team: string; players: T[] }[] {
  const order: (Team | string)[] = ['TOWN', 'MAFIA', 'NEUTRAL'];
  const byTeam = new Map<string, T[]>();
  for (const player of players) {
    const list = byTeam.get(player.team);
    if (list) list.push(player);
    else byTeam.set(player.team, [player]);
  }

  const knownGroups = order.filter((team) => byTeam.has(team)).map((team) => ({ team, players: byTeam.get(team)! }));
  const unknownGroups = [...byTeam.keys()]
    .filter((team) => !order.includes(team))
    .map((team) => ({ team, players: byTeam.get(team)! }));

  return [...knownGroups, ...unknownGroups];
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
