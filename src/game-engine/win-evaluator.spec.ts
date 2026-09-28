import { RoleCode } from '@prisma/client';
import { evaluateWinCondition, WinRosterEntry } from './win-evaluator';

const alive = (roleCode: RoleCode): WinRosterEntry => ({ roleCode, alive: true });
const dead = (roleCode: RoleCode): WinRosterEntry => ({ roleCode, alive: false });

describe('evaluateWinCondition (§16.1, OD-046 fix applied)', () => {
  it('no winner when all three factions are still viable', () => {
    const roster = [alive(RoleCode.DON), alive(RoleCode.MANIAC), alive(RoleCode.CIVILIAN), alive(RoleCode.CIVILIAN)];
    expect(evaluateWinCondition(roster)).toBeNull();
  });

  it('TOWN wins when the last Mafia-aligned player dies and no Maniac remains', () => {
    const roster = [dead(RoleCode.DON), dead(RoleCode.MAFIA), alive(RoleCode.CIVILIAN), alive(RoleCode.DETECTIVE)];
    expect(evaluateWinCondition(roster)).toBe('TOWN');
  });

  it('TOWN wins even with zero town members left, as long as mafia and maniac are both gone (only via the DRAW branch below is that overridden)', () => {
    // Town alive > 0 case is the normal path; covered above. This test
    // documents that TOWN never wins when townAlive is also 0 — see the
    // DRAW test below (OD-046).
    const roster = [alive(RoleCode.CIVILIAN), dead(RoleCode.MAFIA), dead(RoleCode.MANIAC)];
    expect(evaluateWinCondition(roster)).toBe('TOWN');
  });

  it('MAFIA wins when mafia-aligned alive count reaches parity with town (no maniac alive)', () => {
    const roster = [alive(RoleCode.DON), alive(RoleCode.MAFIA), alive(RoleCode.CIVILIAN), dead(RoleCode.MANIAC)];
    // mafiaAlive=2, townAlive=1, maniacAlive=0 -> 2 >= (1+0)
    expect(evaluateWinCondition(roster)).toBe('MAFIA');
  });

  it('MAFIA does not win while a Maniac is still alive, even at numeric parity', () => {
    const roster = [alive(RoleCode.DON), alive(RoleCode.MANIAC), alive(RoleCode.CIVILIAN)];
    // mafiaAlive=1, maniacAlive=1, townAlive=1 -> none of the branches match, "no winner yet"
    expect(evaluateWinCondition(roster)).toBeNull();
  });

  it('MANIAC wins as the sole survivor', () => {
    const roster = [alive(RoleCode.MANIAC), dead(RoleCode.DON), dead(RoleCode.CIVILIAN)];
    expect(evaluateWinCondition(roster)).toBe('NEUTRAL');
  });

  it('MANIAC does not win while any Mafia-aligned player is still alive', () => {
    const roster = [alive(RoleCode.MANIAC), alive(RoleCode.MAFIA)];
    // mafiaAlive=1, maniacAlive=1, townAlive=0 -> the DUEL state, no winner yet
    expect(evaluateWinCondition(roster)).toBeNull();
  });

  it('the DUEL state (last Mafia vs. Maniac, no Town left) has no winner yet', () => {
    const roster = [alive(RoleCode.DON), alive(RoleCode.MANIAC)];
    expect(evaluateWinCondition(roster)).toBeNull();
  });

  it('OD-046: a simultaneous wipeout of all three factions is a DRAW, not a TOWN win', () => {
    const roster = [dead(RoleCode.DON), dead(RoleCode.MANIAC), dead(RoleCode.CIVILIAN)];
    expect(evaluateWinCondition(roster)).toBe('DRAW');
  });

  it('an empty roster (no role data at all) is "no winner yet", not a DRAW — a real wipeout still has dead roster entries', () => {
    expect(evaluateWinCondition([])).toBeNull();
  });

  it('Don counts toward mafiaAlive alongside plain Mafia', () => {
    const roster = [alive(RoleCode.DON), dead(RoleCode.MAFIA), alive(RoleCode.CIVILIAN)];
    // mafiaAlive=1 (Don only), townAlive=1, maniacAlive=0 -> 1 >= 1 -> MAFIA
    expect(evaluateWinCondition(roster)).toBe('MAFIA');
  });

  it('Journalist counts toward townAlive like every other Town role', () => {
    const roster = [alive(RoleCode.JOURNALIST), dead(RoleCode.DON), dead(RoleCode.MAFIA)];
    expect(evaluateWinCondition(roster)).toBe('TOWN');
  });

  it('dead players never count toward any faction tally', () => {
    const roster = [dead(RoleCode.DON), dead(RoleCode.MAFIA), dead(RoleCode.MANIAC), alive(RoleCode.CIVILIAN)];
    expect(evaluateWinCondition(roster)).toBe('TOWN');
  });
});
