import { RoleCode } from '@prisma/client';
import {
  dealRoles,
  expandDistribution,
  RoleDistribution,
  shuffle,
  teamForRole,
} from './roles';

const DISTRIBUTIONS: Record<number, RoleDistribution> = {
  4: {
    mafia: 1,
    don: 0,
    detective: 0,
    sheriff: 0,
    doctor: 1,
    bodyguard: 0,
    maniac: 0,
    journalist: 0,
    civilian: 2,
  },
  8: {
    mafia: 1,
    don: 1,
    detective: 1,
    sheriff: 0,
    doctor: 1,
    bodyguard: 1,
    maniac: 0,
    journalist: 0,
    civilian: 3,
  },
  24: {
    mafia: 5,
    don: 1,
    detective: 2,
    sheriff: 2,
    doctor: 1,
    bodyguard: 1,
    maniac: 1,
    journalist: 1,
    civilian: 10,
  },
};

const totalRoles = (d: RoleDistribution) =>
  Object.values(d).reduce((sum, n) => sum + n, 0);

describe('expandDistribution', () => {
  it.each(Object.entries(DISTRIBUTIONS))(
    'expands the §13.1 row for %s players into a list matching every count exactly',
    (playerCountStr, distribution) => {
      const roles = expandDistribution(distribution);
      const playerCount = Number(playerCountStr);

      expect(roles).toHaveLength(playerCount);
      expect(roles.filter((r) => r === RoleCode.MAFIA)).toHaveLength(
        distribution.mafia,
      );
      expect(roles.filter((r) => r === RoleCode.DON)).toHaveLength(
        distribution.don,
      );
      expect(roles.filter((r) => r === RoleCode.DETECTIVE)).toHaveLength(
        distribution.detective,
      );
      expect(roles.filter((r) => r === RoleCode.SHERIFF)).toHaveLength(
        distribution.sheriff,
      );
      expect(roles.filter((r) => r === RoleCode.DOCTOR)).toHaveLength(
        distribution.doctor,
      );
      expect(roles.filter((r) => r === RoleCode.BODYGUARD)).toHaveLength(
        distribution.bodyguard,
      );
      expect(roles.filter((r) => r === RoleCode.MANIAC)).toHaveLength(
        distribution.maniac,
      );
      expect(roles.filter((r) => r === RoleCode.JOURNALIST)).toHaveLength(
        distribution.journalist,
      );
      expect(roles.filter((r) => r === RoleCode.CIVILIAN)).toHaveLength(
        distribution.civilian,
      );
    },
  );
});

describe('dealRoles', () => {
  it.each(Object.entries(DISTRIBUTIONS))(
    'deals exactly one role per player for %s players, multiset matching the distribution exactly',
    (playerCountStr, distribution) => {
      const playerCount = Number(playerCountStr);
      const playerIds = Array.from({ length: playerCount }, (_, i) => `p${i}`);

      const assignments = dealRoles(playerIds, distribution);

      // Uniqueness: every player appears exactly once.
      expect(assignments).toHaveLength(playerCount);
      const assignedPlayerIds = assignments.map((a) => a.playerId);
      expect(new Set(assignedPlayerIds).size).toBe(playerCount);
      expect(new Set(assignedPlayerIds)).toEqual(new Set(playerIds));

      // Multiset of dealt roles matches configSnapshot.roleDistribution exactly.
      const dealtRoles = assignments.map((a) => a.roleCode);
      expect(dealtRoles.sort()).toEqual(
        expandDistribution(distribution).sort(),
      );
    },
  );

  it('throws if the player count does not match the distribution total (caller-bug guard)', () => {
    const distribution = DISTRIBUTIONS[4];
    expect(() => dealRoles(['p0', 'p1', 'p2'], distribution)).toThrow();
    expect(totalRoles(distribution)).toBe(4);
  });
});

describe('teamForRole', () => {
  it('maps every role to its §12.2 team', () => {
    expect(teamForRole(RoleCode.CIVILIAN)).toBe('TOWN');
    expect(teamForRole(RoleCode.DETECTIVE)).toBe('TOWN');
    expect(teamForRole(RoleCode.SHERIFF)).toBe('TOWN');
    expect(teamForRole(RoleCode.DOCTOR)).toBe('TOWN');
    expect(teamForRole(RoleCode.BODYGUARD)).toBe('TOWN');
    expect(teamForRole(RoleCode.JOURNALIST)).toBe('TOWN');
    expect(teamForRole(RoleCode.MAFIA)).toBe('MAFIA');
    expect(teamForRole(RoleCode.DON)).toBe('MAFIA');
    expect(teamForRole(RoleCode.MANIAC)).toBe('NEUTRAL');
  });
});

describe('shuffle fairness (crypto.randomInt Fisher-Yates, no modulo bias)', () => {
  it('does not statistically favor any player for the MAFIA role', () => {
    // 4 players, exactly 1 MAFIA -> P(player i is MAFIA) = 1/4 under a fair
    // shuffle. Over TRIALS runs, each player's MAFIA count should land near
    // TRIALS/4. Bound is ~6 standard deviations of the underlying binomial
    // (n=TRIALS, p=0.25), which is astronomically unlikely to trip by chance
        // under a fair shuffle, while still catching any real bias (e.g. a bug
    // that always favors one array position would blow past it immediately).
    const TRIALS = 4000;
    const playerIds = ['p0', 'p1', 'p2', 'p3'];
    const distribution = DISTRIBUTIONS[4];
    const expected = TRIALS / playerIds.length;
    const stdev = Math.sqrt(TRIALS * 0.25 * 0.75);
    const bound = 6 * stdev; // ≈ 142

    const mafiaCounts: Record<string, number> = Object.fromEntries(
      playerIds.map((id) => [id, 0]),
    );

    for (let i = 0; i < TRIALS; i += 1) {
      const assignments = dealRoles(playerIds, distribution);
      const mafiaPlayer = assignments.find(
        (a) => a.roleCode === RoleCode.MAFIA,
      )!;
      mafiaCounts[mafiaPlayer.playerId] += 1;
    }

    for (const id of playerIds) {
      expect(mafiaCounts[id]).toBeGreaterThan(expected - bound);
      expect(mafiaCounts[id]).toBeLessThan(expected + bound);
    }
  });

  it('produces permutations covering more than just a handful of orderings', () => {
    // A weak/broken shuffle (e.g. off-by-one Fisher-Yates) tends to collapse
    // onto a small number of distinct orderings. With 4 distinct items there
    // are 4! = 24 possible orderings; over many trials we expect to observe
    // a healthy majority of them, not just one or two.
    const TRIALS = 2000;
    const seen = new Set<string>();

    for (let i = 0; i < TRIALS; i += 1) {
      seen.add(shuffle(['a', 'b', 'c', 'd']).join(''));
    }

    expect(seen.size).toBeGreaterThanOrEqual(20); // out of 24 possible
  });
});
