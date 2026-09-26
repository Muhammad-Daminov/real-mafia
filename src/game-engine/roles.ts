import { randomInt } from 'crypto';
import { RoleCode } from '@prisma/client';

/**
 * Master TZ §13.1's fixed distribution shape, frozen into
 * `Game.configSnapshot.roleDistribution` at StartGame (Slice 1). This slice
 * consumes that frozen value — it never re-derives a distribution from
 * player count, since the whole point of freezing it was to make later
 * table edits unable to retroactively change an in-progress game.
 */
export interface RoleDistribution {
  mafia: number;
  don: number;
  detective: number;
  sheriff: number;
  doctor: number;
  bodyguard: number;
  maniac: number;
  journalist: number;
  civilian: number;
}

const DISTRIBUTION_KEY_TO_ROLE_CODE: Record<keyof RoleDistribution, RoleCode> = {
  mafia: RoleCode.MAFIA,
  don: RoleCode.DON,
  detective: RoleCode.DETECTIVE,
  sheriff: RoleCode.SHERIFF,
  doctor: RoleCode.DOCTOR,
  bodyguard: RoleCode.BODYGUARD,
  maniac: RoleCode.MANIAC,
  journalist: RoleCode.JOURNALIST,
  civilian: RoleCode.CIVILIAN,
};

/** §12.2: team membership is a fixed function of role code, never persisted. */
export type Team = 'TOWN' | 'MAFIA' | 'NEUTRAL';

const ROLE_TEAM: Record<RoleCode, Team> = {
  [RoleCode.CIVILIAN]: 'TOWN',
  [RoleCode.DETECTIVE]: 'TOWN',
  [RoleCode.SHERIFF]: 'TOWN',
  [RoleCode.DOCTOR]: 'TOWN',
  [RoleCode.BODYGUARD]: 'TOWN',
  [RoleCode.JOURNALIST]: 'TOWN',
  [RoleCode.MAFIA]: 'MAFIA',
  [RoleCode.DON]: 'MAFIA',
  [RoleCode.MANIAC]: 'NEUTRAL',
};

export function teamForRole(roleCode: RoleCode): Team {
  return ROLE_TEAM[roleCode];
}

/** Expands a distribution row into a flat, unshuffled list of role codes. */
export function expandDistribution(distribution: RoleDistribution): RoleCode[] {
  const roles: RoleCode[] = [];

  for (const key of Object.keys(DISTRIBUTION_KEY_TO_ROLE_CODE) as (keyof RoleDistribution)[]) {
    const count = distribution[key];
    const code = DISTRIBUTION_KEY_TO_ROLE_CODE[key];

    for (let i = 0; i < count; i += 1) {
      roles.push(code);
    }
  }

  return roles;
}

/**
 * Fisher-Yates shuffle using `crypto.randomInt` (not `Math.random`) — the
 * same fairness bar already applied to room-code generation. `randomInt`
 * rejects and retries outside the unbiased range internally rather than
 * reducing via modulo, so every one of the `n!` permutations of `items` is
 * equally likely; nobody, including the server operator, has a lever to
 * bias who gets which role.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/**
 * Pure dealing step: shuffles the expanded role list and pairs it 1:1 with
 * `playerIds` in the shuffled order. Throws if the counts don't match —
 * callers (RoleAssignmentService) are expected to have already validated
 * `activePlayerIds.length === sum(roleDistribution)` via StartGame's own
 * NOT_ENOUGH_PLAYERS/CONFIG_INVALID checks; a mismatch here means a caller
 * bug, not a user-facing error.
 */
export function dealRoles(
  playerIds: readonly string[],
  distribution: RoleDistribution,
): { playerId: string; roleCode: RoleCode }[] {
  const roles = expandDistribution(distribution);

  if (roles.length !== playerIds.length) {
    throw new Error(
      `Role count (${roles.length}) does not match player count (${playerIds.length})`,
    );
  }

  const shuffledRoles = shuffle(roles);

  return playerIds.map((playerId, index) => ({
    playerId,
    roleCode: shuffledRoles[index],
  }));
}
