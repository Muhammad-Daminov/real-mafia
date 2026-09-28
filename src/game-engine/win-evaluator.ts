import { RoleCode } from '@prisma/client';
import { Team, teamForRole } from './roles';

export interface WinRosterEntry {
  roleCode: RoleCode;
  alive: boolean;
}

/** §16.3's literal domain: `game_results.winner_team ∈ {TOWN, MAFIA, NEUTRAL, DRAW}`. Null = no winner yet. */
export type WinnerTeamResult = 'TOWN' | 'MAFIA' | 'NEUTRAL' | 'DRAW' | null;

/**
 * §16.1's evaluator, transcribed with OD-046's fix applied. Quoted verbatim
 * (comments below mark exactly where OD-046 departs from the literal text):
 *
 *   mafiaAlive   = count(alive AND team = MAFIA)          // Mafia + Don
 *   maniacAlive  = count(alive AND team = NEUTRAL)         // 0 or 1
 *   townAlive    = count(alive AND team = TOWN)
 *
 *   if maniacAlive == 1 AND mafiaAlive == 0 AND townAlive == 0
 *       -> MANIAC wins
 *   else if mafiaAlive == 0 AND maniacAlive == 0
 *       -> TOWN wins
 *   else if mafiaAlive >= (townAlive + maniacAlive) AND maniacAlive == 0
 *       -> MAFIA wins
 *   else if mafiaAlive == 1 AND maniacAlive == 1 AND townAlive == 0
 *       -> DUEL: no winner yet; continues to next NIGHT with only these two alive
 *   else
 *       -> no winner, continue
 *
 * OD-046(1): a DRAW check (`mafiaAlive == maniacAlive == townAlive == 0`) is
 * inserted ahead of the TOWN-wins branch — the literal TOWN-wins condition
 * has no `townAlive` term at all, so a simultaneous wipeout of all three
 * factions would otherwise be misread as a TOWN win, contradicting §16.1's
 * own prose two lines later ("if both are somehow eliminated simultaneously,
 * declared a DRAW"). Reachable in practice: a duel's last Mafia-team
 * survivor and the Maniac can submit mutual `KILL`s with no Doctor/Bodyguard
 * alive to intercept either (§12.4), producing exactly this state.
 *
 * Pure function — no I/O, no wall-clock — same determinism bar as
 * `resolveNightActions`/`resolveVotes`. `PhaseTransitionService` owns
 * building the roster from current `game_players`/`game_role_assignments`
 * state and threading the result into `GameLifecycleService`'s GAME_OVER
 * write; this function only decides *who*, if anyone, has won.
 */
export function evaluateWinCondition(roster: WinRosterEntry[]): WinnerTeamResult {
  // No roster data at all (no role assignments exist yet for this game) is a
  // degenerate/empty fixture, never a real wipeout — a real 3-way wipeout
  // still has role-bearing roster *entries*, just all `alive: false`. Same
  // "defer, don't act on a vacuous truth" precedent already applied to the
  // NIGHT/VOTING early-completion gates in `PhaseTransitionService`.
  if (roster.length === 0) {
    return null;
  }

  const alive = roster.filter((r) => r.alive);
  const countTeam = (team: Team) => alive.filter((r) => teamForRole(r.roleCode) === team).length;

  const mafiaAlive = countTeam('MAFIA');
  const maniacAlive = countTeam('NEUTRAL');
  const townAlive = countTeam('TOWN');

  if (maniacAlive === 1 && mafiaAlive === 0 && townAlive === 0) {
    return 'NEUTRAL'; // MANIAC wins (sole survivor)
  }

  if (mafiaAlive === 0 && maniacAlive === 0 && townAlive === 0) {
    return 'DRAW'; // OD-046(1)
  }

  if (mafiaAlive === 0 && maniacAlive === 0) {
    return 'TOWN';
  }

  if (mafiaAlive >= townAlive + maniacAlive && maniacAlive === 0) {
    return 'MAFIA';
  }

  // mafiaAlive === 1 && maniacAlive === 1 && townAlive === 0 (the DUEL state)
  // and every other remaining combination both fall through to "no winner
  // yet, continue" — the DUEL state needs no distinct persisted marker (see
  // OPEN_DECISIONS.md OD-046's discussion): it naturally resolves itself on
  // a later call once the roster changes again.
  return null;
}
