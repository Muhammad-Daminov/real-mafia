import { ActionType, RoleCode } from '@prisma/client';
import { resolveNightActions, RosterEntry, SubmittedAction } from './night-resolution';

const P = {
  mafia: 'mafia-1',
  don: 'don-1',
  maniac: 'maniac-1',
  sheriff: 'sheriff-1',
  doctor: 'doctor-1',
  bodyguard: 'bodyguard-1',
  detective: 'detective-1',
  journalist: 'journalist-1',
  civilian1: 'civilian-1',
  civilian2: 'civilian-2',
};

function roster(overrides: Partial<Record<keyof typeof P, boolean>> = {}): RosterEntry[] {
  const roleByKey: Record<keyof typeof P, RoleCode> = {
    mafia: RoleCode.MAFIA,
    don: RoleCode.DON,
    maniac: RoleCode.MANIAC,
    sheriff: RoleCode.SHERIFF,
    doctor: RoleCode.DOCTOR,
    bodyguard: RoleCode.BODYGUARD,
    detective: RoleCode.DETECTIVE,
    journalist: RoleCode.JOURNALIST,
    civilian1: RoleCode.CIVILIAN,
    civilian2: RoleCode.CIVILIAN,
  };

  return (Object.keys(P) as (keyof typeof P)[]).map((key) => ({
    playerId: P[key],
    roleCode: roleByKey[key],
    alive: overrides[key] ?? true,
  }));
}

function action(
  actorPlayerId: string,
  actionType: ActionType,
  targetPlayerId: string,
  targetPlayerId2: string | null = null,
): SubmittedAction {
  return { actorPlayerId, actionType, targetPlayerId, targetPlayerId2 };
}

describe('resolveNightActions (§12.4 pure resolution pipeline)', () => {
  it('an unprotected mafia (Don override) kill results in one death', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.don, ActionType.KILL, P.civilian1),
    ]);
    expect(outcome.deaths).toEqual([P.civilian1]);
  });

  it('Don KILL overrides plain Mafia majority vote', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.mafia, ActionType.KILL, P.civilian1),
      action(P.don, ActionType.KILL, P.civilian2),
    ]);
    expect(outcome.deaths).toEqual([P.civilian2]); // Don's choice wins, not the plain vote
  });

  it('without a Don override, mafia majority vote wins; a tie produces no mafia kill (OD-002)', () => {
    const rosterNoDon = roster({ don: false });

    const majority = resolveNightActions(rosterNoDon, [
      action(P.mafia, ActionType.KILL, P.civilian1),
    ]);
    expect(majority.deaths).toEqual([P.civilian1]);

    // Simulate a tie with a second mafia vote via a synthetic extra voter:
    // reuse detective's slot as a stand-in "mafia" voter for tie construction
    // is invalid (wrong role) — instead assert the single-voter case only,
    // and cover the tie explicitly with two distinct mafia-team actors below.
  });

  it('a genuine tie between two mafia-team voters (no Don) produces no kill', () => {
    const twoMafiaRoster: RosterEntry[] = [
      { playerId: 'm1', roleCode: RoleCode.MAFIA, alive: true },
      { playerId: 'm2', roleCode: RoleCode.MAFIA, alive: true },
      { playerId: 'c1', roleCode: RoleCode.CIVILIAN, alive: true },
      { playerId: 'c2', roleCode: RoleCode.CIVILIAN, alive: true },
    ];
    const outcome = resolveNightActions(twoMafiaRoster, [
      action('m1', ActionType.KILL, 'c1'),
      action('m2', ActionType.KILL, 'c2'),
    ]);
    expect(outcome.deaths).toEqual([]);
  });

  it('Maniac kill is independent and may coincide with the mafia target (dedup to one death)', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.don, ActionType.KILL, P.civilian1),
      action(P.maniac, ActionType.KILL, P.civilian1),
    ]);
    expect(outcome.deaths).toEqual([P.civilian1]);
  });

  it('Maniac kill on a distinct target from mafia produces two deaths', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.don, ActionType.KILL, P.civilian1),
      action(P.maniac, ActionType.KILL, P.civilian2),
    ]);
    expect(outcome.deaths.sort()).toEqual([P.civilian1, P.civilian2].sort());
  });

  it('Doctor protecting the mafia target blocks that kill entirely', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.don, ActionType.KILL, P.civilian1),
      action(P.doctor, ActionType.PROTECT, P.civilian1),
    ]);
    expect(outcome.deaths).toEqual([]);
    expect(outcome.results).toContainEqual({
      actorPlayerId: P.doctor,
      actionType: ActionType.PROTECT,
      result: { applied: true },
    });
  });

  it('Doctor self-protecting increments the DOCTOR_SELF_PROTECT usage counter', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.doctor, ActionType.PROTECT, P.doctor),
    ]);
    expect(outcome.abilityUsageIncrements).toContainEqual({
      playerId: P.doctor,
      ability: 'DOCTOR_SELF_PROTECT',
    });
  });

  it('Doctor protecting a non-self target does not touch the self-protect counter', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.doctor, ActionType.PROTECT, P.civilian1),
    ]);
    expect(outcome.abilityUsageIncrements).toEqual([]);
  });

  it('Bodyguard guarding an unprotected kill target dies in their place; target survives (§12.6)', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.don, ActionType.KILL, P.civilian1),
      action(P.bodyguard, ActionType.GUARD, P.civilian1),
    ]);
    expect(outcome.deaths).toEqual([P.bodyguard]);
    expect(outcome.results).toContainEqual({
      actorPlayerId: P.bodyguard,
      actionType: ActionType.GUARD,
      result: { consumed: true },
    });
  });

  it('Bodyguard guarding a target the Doctor already protects is not consumed (§12.6: same-target stacking)', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.don, ActionType.KILL, P.civilian1),
      action(P.doctor, ActionType.PROTECT, P.civilian1),
      action(P.bodyguard, ActionType.GUARD, P.civilian1),
    ]);
    expect(outcome.deaths).toEqual([]); // blocked by Doctor, no Bodyguard death
    expect(outcome.results).toContainEqual({
      actorPlayerId: P.bodyguard,
      actionType: ActionType.GUARD,
      result: { consumed: false },
    });
  });

  it('Doctor and Bodyguard protecting different targets resolve independently', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.don, ActionType.KILL, P.civilian1),
      action(P.maniac, ActionType.KILL, P.civilian2),
      action(P.doctor, ActionType.PROTECT, P.civilian1), // blocks the mafia kill
      action(P.bodyguard, ActionType.GUARD, P.civilian2), // catches the maniac kill
    ]);
    expect(outcome.deaths).toEqual([P.bodyguard]);
  });

  it('Bodyguard guarding a target with no pending kill at all is not consumed', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.bodyguard, ActionType.GUARD, P.civilian1),
    ]);
    expect(outcome.deaths).toEqual([]);
    expect(outcome.results).toContainEqual({
      actorPlayerId: P.bodyguard,
      actionType: ActionType.GUARD,
      result: { consumed: false },
    });
  });

  it("Sheriff's shot is a standard kill attempt regardless of the target's team (OD-044a) and reports whether the target died", () => {
    const killsMafia = resolveNightActions(roster(), [
      action(P.sheriff, ActionType.SHOOT, P.mafia),
    ]);
    expect(killsMafia.deaths).toEqual([P.mafia]);
    expect(killsMafia.results).toContainEqual({
      actorPlayerId: P.sheriff,
      actionType: ActionType.SHOOT,
      result: { died: true },
    });

    const killsInnocent = resolveNightActions(roster(), [
      action(P.sheriff, ActionType.SHOOT, P.civilian1),
    ]);
    expect(killsInnocent.deaths).toEqual([P.civilian1]);
    expect(killsInnocent.results).toContainEqual({
      actorPlayerId: P.sheriff,
      actionType: ActionType.SHOOT,
      result: { died: true },
    });
  });

  it('a blocked Sheriff shot reports died: false and still consumes the once-per-game ability', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.sheriff, ActionType.SHOOT, P.civilian1),
      action(P.doctor, ActionType.PROTECT, P.civilian1),
    ]);
    expect(outcome.deaths).toEqual([]);
    expect(outcome.results).toContainEqual({
      actorPlayerId: P.sheriff,
      actionType: ActionType.SHOOT,
      result: { died: false },
    });
    expect(outcome.abilityUsageIncrements).toContainEqual({
      playerId: P.sheriff,
      ability: 'SHERIFF_SHOOT',
    });
  });

  it('up to three independent, unprotected kill sources produce exactly three deaths (OD-031 ceiling, not an enforced cap)', () => {
    const outcome = resolveNightActions(roster(), [
      action(P.don, ActionType.KILL, P.civilian1),
      action(P.maniac, ActionType.KILL, P.civilian2),
      action(P.sheriff, ActionType.SHOOT, P.detective),
    ]);
    expect(outcome.deaths.sort()).toEqual([P.civilian1, P.civilian2, P.detective].sort());
  });

  it('Don CHECK reveals whether the target is the Sheriff, without affecting life state', () => {
    const isSheriff = resolveNightActions(roster(), [
      action(P.don, ActionType.CHECK, P.sheriff),
    ]);
    expect(isSheriff.results).toContainEqual({
      actorPlayerId: P.don,
      actionType: ActionType.CHECK,
      result: { isSheriff: true },
    });
    expect(isSheriff.deaths).toEqual([]);

    const notSheriff = resolveNightActions(roster(), [
      action(P.don, ActionType.CHECK, P.civilian1),
    ]);
    expect(notSheriff.results).toContainEqual({
      actorPlayerId: P.don,
      actionType: ActionType.CHECK,
      result: { isSheriff: false },
    });
  });

  it('Detective INVESTIGATE returns the OD-019 binary MAFIA/NOT_MAFIA flag, and reads a Maniac as NOT_MAFIA', () => {
    const onMafia = resolveNightActions(roster(), [
      action(P.detective, ActionType.INVESTIGATE, P.mafia),
    ]);
    expect(onMafia.results).toContainEqual({
      actorPlayerId: P.detective,
      actionType: ActionType.INVESTIGATE,
      result: { flag: 'MAFIA' },
    });

    const onManiac = resolveNightActions(roster(), [
      action(P.detective, ActionType.INVESTIGATE, P.maniac),
    ]);
    expect(onManiac.results).toContainEqual({
      actorPlayerId: P.detective,
      actionType: ActionType.INVESTIGATE,
      result: { flag: 'NOT_MAFIA' },
    });

    // Result is computed against the target's actual team even if that
    // target also dies this same night (§12.4 step 8: "unaffected by
    // whether the target died this same night").
    const targetAlsoDies = resolveNightActions(roster(), [
      action(P.don, ActionType.KILL, P.mafia === P.mafia ? P.civilian1 : P.civilian1),
      action(P.detective, ActionType.INVESTIGATE, P.civilian1),
    ]);
    expect(targetAlsoDies.deaths).toContain(P.civilian1);
    expect(targetAlsoDies.results).toContainEqual({
      actorPlayerId: P.detective,
      actionType: ActionType.INVESTIGATE,
      result: { flag: 'NOT_MAFIA' },
    });
  });

  it('Journalist INVESTIGATE_PAIR reports team-based SAME_TEAM/DIFFERENT_TEAM, never leaking Maniac as mafia', () => {
    const sameTeam = resolveNightActions(roster(), [
      action(P.journalist, ActionType.INVESTIGATE_PAIR, P.mafia, P.don),
    ]);
    expect(sameTeam.results).toContainEqual({
      actorPlayerId: P.journalist,
      actionType: ActionType.INVESTIGATE_PAIR,
      result: { relation: 'SAME_TEAM' },
    });

    // Maniac (NEUTRAL) paired with Mafia reads DIFFERENT_TEAM, not "both non-town" or similar leak.
    const maniacVsMafia = resolveNightActions(roster(), [
      action(P.journalist, ActionType.INVESTIGATE_PAIR, P.maniac, P.mafia),
    ]);
    expect(maniacVsMafia.results).toContainEqual({
      actorPlayerId: P.journalist,
      actionType: ActionType.INVESTIGATE_PAIR,
      result: { relation: 'DIFFERENT_TEAM' },
    });

    const bothTown = resolveNightActions(roster(), [
      action(P.journalist, ActionType.INVESTIGATE_PAIR, P.civilian1, P.civilian2),
    ]);
    expect(bothTown.results).toContainEqual({
      actorPlayerId: P.journalist,
      actionType: ActionType.INVESTIGATE_PAIR,
      result: { relation: 'SAME_TEAM' },
    });
  });

  it('a dead role does not act even if a stray action row somehow exists for them', () => {
    const outcome = resolveNightActions(roster({ doctor: false }), [
      action(P.doctor, ActionType.PROTECT, P.civilian1),
      action(P.don, ActionType.KILL, P.civilian1),
    ]);
    // Dead Doctor's "protection" must not block the kill.
    expect(outcome.deaths).toEqual([P.civilian1]);
  });

  it('two Sheriffs and two Detectives (§13.1 rows 13+/17+) act fully independently', () => {
    const bigRoster: RosterEntry[] = [
      { playerId: 's1', roleCode: RoleCode.SHERIFF, alive: true },
      { playerId: 's2', roleCode: RoleCode.SHERIFF, alive: true },
      { playerId: 'd1', roleCode: RoleCode.DETECTIVE, alive: true },
      { playerId: 'd2', roleCode: RoleCode.DETECTIVE, alive: true },
      { playerId: 'm1', roleCode: RoleCode.MAFIA, alive: true },
      { playerId: 'c1', roleCode: RoleCode.CIVILIAN, alive: true },
      { playerId: 'c2', roleCode: RoleCode.CIVILIAN, alive: true },
    ];

    const outcome = resolveNightActions(bigRoster, [
      action('s1', ActionType.SHOOT, 'c1'), // lands
      action('s2', ActionType.SHOOT, 'c2'), // lands
      action('d1', ActionType.INVESTIGATE, 'm1'),
      action('d2', ActionType.INVESTIGATE, 'c1'),
    ]);

    expect(outcome.deaths.sort()).toEqual(['c1', 'c2'].sort());
    expect(outcome.results).toContainEqual({ actorPlayerId: 's1', actionType: ActionType.SHOOT, result: { died: true } });
    expect(outcome.results).toContainEqual({ actorPlayerId: 's2', actionType: ActionType.SHOOT, result: { died: true } });
    expect(outcome.results).toContainEqual({ actorPlayerId: 'd1', actionType: ActionType.INVESTIGATE, result: { flag: 'MAFIA' } });
    expect(outcome.results).toContainEqual({ actorPlayerId: 'd2', actionType: ActionType.INVESTIGATE, result: { flag: 'NOT_MAFIA' } });
    expect(outcome.abilityUsageIncrements).toContainEqual({ playerId: 's1', ability: 'SHERIFF_SHOOT' });
    expect(outcome.abilityUsageIncrements).toContainEqual({ playerId: 's2', ability: 'SHERIFF_SHOOT' });
  });

  it('no submissions at all produces no deaths and no results', () => {
    const outcome = resolveNightActions(roster(), []);
    expect(outcome.deaths).toEqual([]);
    expect(outcome.results).toEqual([]);
    expect(outcome.abilityUsageIncrements).toEqual([]);
  });
});
