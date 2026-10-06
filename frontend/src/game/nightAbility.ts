import type { RoleCode, Team } from '../api/games';

/**
 * Frontend mirror of `src/game-engine/night-actions/role-abilities.ts`'s
 * `ROLE_NIGHT_ABILITIES` and `src/game-engine/roles.ts`'s `ROLE_TEAM` — the
 * backend can't be imported into the frontend, so the static per-role shape
 * (which action, self-target allowed, pair-target, team exclusion) is
 * transcribed verbatim here. `frequency` (ONCE_PER_GAME/EVERY_NIGHT) is
 * deliberately omitted — enforcing it client-side would need per-player
 * ability-usage data (`RoleAbilityUsage`), which no endpoint exposes either
 * (same class of gap as OD-F4-001); the backend's own `ABILITY_ALREADY_USED`
 * error is the actual enforcement, surfaced via `errors/nightActionErrorMessages.ts`.
 */
export type NightActionType = 'KILL' | 'INVESTIGATE' | 'PROTECT' | 'SHOOT' | 'GUARD' | 'INVESTIGATE_PAIR' | 'CHECK';

export interface NightAbilitySpec {
  actionType: NightActionType;
  slot: number;
  allowSelfTarget: boolean;
  pairTarget: boolean;
  excludesTeam?: 'MAFIA';
  primary: boolean;
}

const ROLE_TEAM: Record<RoleCode, Team> = {
  CIVILIAN: 'TOWN',
  DETECTIVE: 'TOWN',
  SHERIFF: 'TOWN',
  DOCTOR: 'TOWN',
  BODYGUARD: 'TOWN',
  JOURNALIST: 'TOWN',
  MAFIA: 'MAFIA',
  DON: 'MAFIA',
  MANIAC: 'NEUTRAL',
};

export function teamForRole(roleCode: RoleCode): Team {
  return ROLE_TEAM[roleCode];
}

const ROLE_NIGHT_ABILITIES: Record<RoleCode, NightAbilitySpec[]> = {
  CIVILIAN: [],
  DETECTIVE: [{ actionType: 'INVESTIGATE', slot: 0, allowSelfTarget: false, pairTarget: false, primary: true }],
  SHERIFF: [{ actionType: 'SHOOT', slot: 0, allowSelfTarget: false, pairTarget: false, primary: true }],
  DOCTOR: [{ actionType: 'PROTECT', slot: 0, allowSelfTarget: true, pairTarget: false, primary: true }],
  BODYGUARD: [{ actionType: 'GUARD', slot: 0, allowSelfTarget: false, pairTarget: false, primary: true }],
  JOURNALIST: [{ actionType: 'INVESTIGATE_PAIR', slot: 0, allowSelfTarget: false, pairTarget: true, primary: true }],
  MAFIA: [
    { actionType: 'KILL', slot: 0, allowSelfTarget: false, pairTarget: false, excludesTeam: 'MAFIA', primary: true },
  ],
  DON: [
    { actionType: 'KILL', slot: 0, allowSelfTarget: false, pairTarget: false, excludesTeam: 'MAFIA', primary: true },
    { actionType: 'CHECK', slot: 1, allowSelfTarget: false, pairTarget: false, excludesTeam: 'MAFIA', primary: false },
  ],
  MANIAC: [{ actionType: 'KILL', slot: 0, allowSelfTarget: false, pairTarget: false, primary: true }],
};

export function abilitiesForRole(roleCode: RoleCode): NightAbilitySpec[] {
  return ROLE_NIGHT_ABILITIES[roleCode] ?? [];
}

/** The ability `NightScreen` offers a UI for — Don's secondary `CHECK` is
 * optional and never gates the screen's main action (mirrors the backend's
 * own `primary` flag, which OD-044c notes never gates early-completion). */
export function primaryAbility(roleCode: RoleCode): NightAbilitySpec | null {
  return abilitiesForRole(roleCode).find((a) => a.primary) ?? null;
}

export function hasNightAction(roleCode: RoleCode): boolean {
  return abilitiesForRole(roleCode).length > 0;
}
