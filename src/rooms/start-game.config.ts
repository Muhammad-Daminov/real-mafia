import { RulesetMode } from '@prisma/client';

/**
 * Master TZ §13.1's fixed distribution table, `rulesVersion` "6.0.0".
 * Verbatim from the spec — never edit in place; a table change requires a new
 * `rulesVersion` per §13.2/§14.3's immutability rule.
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

export const RULES_VERSION = '6.0.0';

/** §13.1/§13.2: the lowest defined row is 4 — the engine-wide floor to start. */
export const MIN_PLAYERS_TO_START = 4;

/** §13.1: the highest defined row — the engine-wide ceiling, not any one room's chosen maxPlayers. */
export const MAX_PLAYERS_CEILING = 24;

const ROLE_DISTRIBUTION_TABLE: Record<number, RoleDistribution> = {
  4: { mafia: 1, don: 0, detective: 0, sheriff: 0, doctor: 1, bodyguard: 0, maniac: 0, journalist: 0, civilian: 2 },
  5: { mafia: 1, don: 0, detective: 1, sheriff: 0, doctor: 1, bodyguard: 0, maniac: 0, journalist: 0, civilian: 2 },
  6: { mafia: 1, don: 0, detective: 1, sheriff: 0, doctor: 1, bodyguard: 0, maniac: 0, journalist: 0, civilian: 3 },
  7: { mafia: 1, don: 1, detective: 1, sheriff: 0, doctor: 1, bodyguard: 0, maniac: 0, journalist: 0, civilian: 3 },
  8: { mafia: 1, don: 1, detective: 1, sheriff: 0, doctor: 1, bodyguard: 1, maniac: 0, journalist: 0, civilian: 3 },
  9: { mafia: 1, don: 1, detective: 1, sheriff: 0, doctor: 1, bodyguard: 1, maniac: 0, journalist: 0, civilian: 4 },
  10: { mafia: 2, don: 1, detective: 1, sheriff: 0, doctor: 1, bodyguard: 1, maniac: 0, journalist: 0, civilian: 4 },
  11: { mafia: 2, don: 1, detective: 1, sheriff: 1, doctor: 1, bodyguard: 1, maniac: 0, journalist: 0, civilian: 4 },
  12: { mafia: 2, don: 1, detective: 1, sheriff: 1, doctor: 1, bodyguard: 1, maniac: 0, journalist: 0, civilian: 5 },
  13: { mafia: 2, don: 1, detective: 2, sheriff: 1, doctor: 1, bodyguard: 1, maniac: 0, journalist: 0, civilian: 5 },
  14: { mafia: 3, don: 1, detective: 2, sheriff: 1, doctor: 1, bodyguard: 1, maniac: 0, journalist: 0, civilian: 5 },
  15: { mafia: 3, don: 1, detective: 2, sheriff: 1, doctor: 1, bodyguard: 1, maniac: 1, journalist: 0, civilian: 5 },
  16: { mafia: 3, don: 1, detective: 2, sheriff: 1, doctor: 1, bodyguard: 1, maniac: 1, journalist: 0, civilian: 6 },
  17: { mafia: 3, don: 1, detective: 2, sheriff: 2, doctor: 1, bodyguard: 1, maniac: 1, journalist: 0, civilian: 6 },
  18: { mafia: 3, don: 1, detective: 2, sheriff: 2, doctor: 1, bodyguard: 1, maniac: 1, journalist: 1, civilian: 6 },
  19: { mafia: 4, don: 1, detective: 2, sheriff: 2, doctor: 1, bodyguard: 1, maniac: 1, journalist: 1, civilian: 6 },
  20: { mafia: 4, don: 1, detective: 2, sheriff: 2, doctor: 1, bodyguard: 1, maniac: 1, journalist: 1, civilian: 7 },
  21: { mafia: 4, don: 1, detective: 2, sheriff: 2, doctor: 1, bodyguard: 1, maniac: 1, journalist: 1, civilian: 8 },
  22: { mafia: 4, don: 1, detective: 2, sheriff: 2, doctor: 1, bodyguard: 1, maniac: 1, journalist: 1, civilian: 9 },
  23: { mafia: 5, don: 1, detective: 2, sheriff: 2, doctor: 1, bodyguard: 1, maniac: 1, journalist: 1, civilian: 9 },
  24: { mafia: 5, don: 1, detective: 2, sheriff: 2, doctor: 1, bodyguard: 1, maniac: 1, journalist: 1, civilian: 10 },
};

/** §13.2: null if no row exists (CONFIG_INVALID) — defense-in-depth, unreachable given the 4-24 bounds enforced elsewhere. */
export function lookupRoleDistribution(playerCount: number): RoleDistribution | null {
  return ROLE_DISTRIBUTION_TABLE[playerCount] ?? null;
}

/** §13.3: Fast mode disables LAST_WORD entirely. */
export function isLastWordEnabled(rulesetMode: RulesetMode): boolean {
  return rulesetMode === RulesetMode.NORMAL;
}

export interface PhaseDurationsSec {
  ROLE_REVEAL: number;
  NIGHT: number;
  MORNING: number;
  LAST_WORD: number | null;
  DISCUSSION: number;
  VOTING: number;
}

/**
 * §14.2, computed once at StartGame from the seated player count and frozen
 * — never recalculated mid-game even if players die.
 */
export function computePhaseDurationsSec(
  rulesetMode: RulesetMode,
  aliveCount: number,
): PhaseDurationsSec {
  if (rulesetMode === RulesetMode.FAST) {
    return {
      ROLE_REVEAL: 10,
      NIGHT: 30,
      MORNING: 10,
      LAST_WORD: null,
      DISCUSSION: 15 + 6 * aliveCount,
      VOTING: 15 + 2 * aliveCount,
    };
  }

  return {
    ROLE_REVEAL: 15,
    NIGHT: 45,
    MORNING: 15,
    LAST_WORD: 20,
    DISCUSSION: 30 + 12 * aliveCount,
    VOTING: 25 + 4 * aliveCount,
  };
}
