import { ActionType, RoleCode } from '@prisma/client';

/**
 * §12.3's per-role night-action column, transcribed into data the submission
 * and early-completion logic can look up. `slot` matches §17.1's
 * `action_slot` — every role uses slot 0 except Don, who has two abilities
 * (`KILL`@0, `CHECK`@1). `pairTarget` marks Journalist's `INVESTIGATE_PAIR`,
 * the only ability needing `target_player_id_2`.
 *
 * `allowSelfTarget`: Doctor's `PROTECT` is the sole explicit self-target
 * exception in §12.3. OD-044b resolves the one role §12.3 leaves ambiguous
 * (Maniac) as "not self," matching every other ability's default.
 *
 * `frequency`:
 *  - `EVERY_NIGHT`: no ability-usage counter, but Doctor additionally carries
 *    a once-per-game self-target sub-limit (OD-003) and a no-consecutive-
 *    night-repeat rule (OD-004) — both checked in `NightActionService`, not
 *    here, since they're per-target rules, not "is this ability available."
 *  - `ONCE_PER_GAME`: Sheriff's `SHOOT` — gated by `role_ability_usage`.
 *  - `AT_MOST_ONCE_PER_NIGHT`: Don's `CHECK` — optional; never gates §10.2's
 *    early-completion condition (OD-044c).
 *
 * `excludesTeam`: Mafia/Don's `KILL` and Don's `CHECK` cannot target a
 * fellow Mafia-team member. Maniac's `KILL` has no team restriction
 * ("alive, any team including Mafia," §12.3).
 */
export type NightAbilityFrequency = 'EVERY_NIGHT' | 'ONCE_PER_GAME' | 'AT_MOST_ONCE_PER_NIGHT';

export interface NightAbilitySpec {
  actionType: ActionType;
  slot: number;
  frequency: NightAbilityFrequency;
  allowSelfTarget: boolean;
  pairTarget: boolean;
  excludesTeam?: 'MAFIA';
  /** True for the role's primary slot — the one OD-044c's early-completion gate waits on. */
  primary: boolean;
}

const ROLE_NIGHT_ABILITIES: Record<RoleCode, NightAbilitySpec[]> = {
  [RoleCode.CIVILIAN]: [],
  [RoleCode.DETECTIVE]: [
    {
      actionType: ActionType.INVESTIGATE,
      slot: 0,
      frequency: 'EVERY_NIGHT',
      allowSelfTarget: false,
      pairTarget: false,
      primary: true,
    },
  ],
  [RoleCode.SHERIFF]: [
    {
      actionType: ActionType.SHOOT,
      slot: 0,
      frequency: 'ONCE_PER_GAME',
      allowSelfTarget: false,
      pairTarget: false,
      primary: true,
    },
  ],
  [RoleCode.DOCTOR]: [
    {
      actionType: ActionType.PROTECT,
      slot: 0,
      frequency: 'EVERY_NIGHT',
      allowSelfTarget: true,
      pairTarget: false,
      primary: true,
    },
  ],
  [RoleCode.BODYGUARD]: [
    {
      actionType: ActionType.GUARD,
      slot: 0,
      frequency: 'EVERY_NIGHT',
      allowSelfTarget: false,
      pairTarget: false,
      primary: true,
    },
  ],
  [RoleCode.JOURNALIST]: [
    {
      actionType: ActionType.INVESTIGATE_PAIR,
      slot: 0,
      frequency: 'EVERY_NIGHT',
      allowSelfTarget: false,
      pairTarget: true,
      primary: true,
    },
  ],
  [RoleCode.MAFIA]: [
    {
      actionType: ActionType.KILL,
      slot: 0,
      frequency: 'EVERY_NIGHT',
      allowSelfTarget: false,
      pairTarget: false,
      excludesTeam: 'MAFIA',
      primary: true,
    },
  ],
  [RoleCode.DON]: [
    {
      actionType: ActionType.KILL,
      slot: 0,
      frequency: 'EVERY_NIGHT',
      allowSelfTarget: false,
      pairTarget: false,
      excludesTeam: 'MAFIA',
      primary: true,
    },
    {
      actionType: ActionType.CHECK,
      slot: 1,
      frequency: 'AT_MOST_ONCE_PER_NIGHT',
      allowSelfTarget: false,
      pairTarget: false,
      excludesTeam: 'MAFIA',
      primary: false,
    },
  ],
  [RoleCode.MANIAC]: [
    {
      actionType: ActionType.KILL,
      slot: 0,
      frequency: 'EVERY_NIGHT',
      allowSelfTarget: false, // OD-044b
      pairTarget: false,
      primary: true,
    },
  ],
};

export function abilitiesForRole(roleCode: RoleCode): NightAbilitySpec[] {
  return ROLE_NIGHT_ABILITIES[roleCode];
}

export function abilityForActionType(
  roleCode: RoleCode,
  actionType: ActionType,
): NightAbilitySpec | null {
  return ROLE_NIGHT_ABILITIES[roleCode].find((a) => a.actionType === actionType) ?? null;
}

export function primaryAbility(roleCode: RoleCode): NightAbilitySpec | null {
  return ROLE_NIGHT_ABILITIES[roleCode].find((a) => a.primary) ?? null;
}

export function hasNightAction(roleCode: RoleCode): boolean {
  return ROLE_NIGHT_ABILITIES[roleCode].length > 0;
}
