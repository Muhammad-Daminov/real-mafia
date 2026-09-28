import { ActionType, RoleCode } from '@prisma/client';
import { Team, teamForRole } from '../roles';

export interface RosterEntry {
  playerId: string;
  roleCode: RoleCode;
  /** Alive at the start of this night's resolution (before any of tonight's deaths). */
  alive: boolean;
}

export interface SubmittedAction {
  actorPlayerId: string;
  actionType: ActionType;
  targetPlayerId: string;
  targetPlayerId2: string | null;
}

export interface ActionResult {
  actorPlayerId: string;
  /** The actionType of the GameAction row this result belongs to (an actor may hold two, e.g. Don). */
  actionType: ActionType;
  result: Record<string, unknown>;
}

export type AbilityUsageKind = 'SHERIFF_SHOOT' | 'DOCTOR_SELF_PROTECT';

export interface AbilityUsageIncrement {
  playerId: string;
  ability: AbilityUsageKind;
}

export interface NightResolutionOutcome {
  /** Deduped player ids who die this night — never more than 3 by construction (§12.4 note, OD-031). */
  deaths: string[];
  /** Private per-actor outcomes (§17.5's PRIVATE_PLAYER events, §12.3's "private information received" column). */
  results: ActionResult[];
  abilityUsageIncrements: AbilityUsageIncrement[];
}

interface PendingKill {
  target: string;
}

/**
 * §12.4's 9-step deterministic resolution priority, transcribed verbatim
 * (quoted in full in OD-041/OD-044's surrounding commit history):
 *
 *   1. Don CHECK             (informational, no life-state effect)
 *   2. Don KILL override     (Don's KILL, if submitted, is the binding mafia
 *                             target; else mafia majority vote, tie = no kill, OD-002)
 *   3. Maniac KILL           (independent target; may coincide with mafia's)
 *   4. Sheriff SHOOT
 *   5. Doctor PROTECT        (blocks any pending kill on the Doctor's target)
 *   6. Bodyguard GUARD       (blocks any *remaining* pending kill on the
 *                             Bodyguard's target; the Bodyguard dies in its
 *                             place instead — §12.6)
 *   7. Deaths finalized
 *   8. Detective INVESTIGATE (against final team, unaffected by same-night death)
 *   9. Journalist INVESTIGATE_PAIR (same rule as 8)
 *
 * Pure function: no I/O, no wall-clock, no randomness (§17.4's determinism
 * requirement) — a deterministic function of the roster snapshot and the
 * round's submitted actions. `NightActionService`/`NightResolutionService`
 * own reading the DB and writing this outcome back; this function only
 * decides *what happened*.
 *
 * OD-044a: Sheriff's SHOOT is a standard kill attempt, no team-based
 * difference in outcome. OD-044b: Maniac cannot target itself (enforced at
 * submission, not here — this function trusts its input is already valid).
 */
export function resolveNightActions(
  roster: RosterEntry[],
  actions: SubmittedAction[],
): NightResolutionOutcome {
  const byId = new Map(roster.map((r) => [r.playerId, r]));
  const alive = roster.filter((r) => r.alive);
  const teamOf = (id: string): Team => teamForRole(byId.get(id)!.roleCode);
  const roleOf = (id: string): RoleCode => byId.get(id)!.roleCode;

  const findAction = (actorId: string, type: ActionType): SubmittedAction | null =>
    actions.find((a) => a.actorPlayerId === actorId && a.actionType === type) ?? null;

  const findAlive = (role: RoleCode) => alive.find((r) => r.roleCode === role) ?? null;

  const results: ActionResult[] = [];
  const abilityUsageIncrements: AbilityUsageIncrement[] = [];

  // 1. Don CHECK
  const don = findAlive(RoleCode.DON);
  if (don) {
    const checkAction = findAction(don.playerId, ActionType.CHECK);
    if (checkAction) {
      results.push({
        actorPlayerId: don.playerId,
        actionType: ActionType.CHECK,
        result: { isSheriff: roleOf(checkAction.targetPlayerId) === RoleCode.SHERIFF },
      });
    }
  }

  // 2. Don KILL override, else mafia majority (OD-002: tie = no kill)
  let mafiaTarget: string | null = null;
  const donKill = don ? findAction(don.playerId, ActionType.KILL) : null;
  if (donKill) {
    mafiaTarget = donKill.targetPlayerId;
  } else {
    const mafiaVotes = alive
      .filter((r) => teamOf(r.playerId) === 'MAFIA' && r.roleCode !== RoleCode.DON)
      .map((r) => findAction(r.playerId, ActionType.KILL))
      .filter((a): a is SubmittedAction => a !== null);

    if (mafiaVotes.length > 0) {
      const tally = new Map<string, number>();
      for (const vote of mafiaVotes) {
        tally.set(vote.targetPlayerId, (tally.get(vote.targetPlayerId) ?? 0) + 1);
      }
      const maxVotes = Math.max(...tally.values());
      const winners = [...tally.entries()].filter(([, count]) => count === maxVotes);
      if (winners.length === 1) {
        mafiaTarget = winners[0][0];
      }
    }
  }

  // 3. Maniac KILL
  const maniac = findAlive(RoleCode.MANIAC);
  const maniacTarget = maniac ? findAction(maniac.playerId, ActionType.KILL)?.targetPlayerId ?? null : null;

  // 4. Sheriff SHOOT — §13.1's distribution table seats up to TWO Sheriffs at
  // higher player counts (rows 17+), unlike Doctor/Bodyguard/Journalist/
  // Maniac/Don, which §12.6/the table itself cap at exactly one. Each
  // Sheriff acts independently, with their own once-per-game shot.
  const sheriffShots = alive
    .filter((r) => r.roleCode === RoleCode.SHERIFF)
    .map((s) => ({ sheriffId: s.playerId, action: findAction(s.playerId, ActionType.SHOOT) }))
    .filter((s): s is { sheriffId: string; action: SubmittedAction } => s.action !== null);

  const pendingKills: PendingKill[] = [];
  if (mafiaTarget) pendingKills.push({ target: mafiaTarget });
  if (maniacTarget) pendingKills.push({ target: maniacTarget });
  for (const shot of sheriffShots) {
    pendingKills.push({ target: shot.action.targetPlayerId });
  }

  // 5. Doctor PROTECT
  const doctor = findAlive(RoleCode.DOCTOR);
  const doctorAction = doctor ? findAction(doctor.playerId, ActionType.PROTECT) : null;
  const doctorTarget = doctorAction?.targetPlayerId ?? null;
  const afterDoctor = doctorTarget
    ? pendingKills.filter((k) => k.target !== doctorTarget)
    : pendingKills;

  if (doctorAction) {
    // OD-006 default: silent — confirmation only, no save/no-save feedback.
    results.push({ actorPlayerId: doctor!.playerId, actionType: ActionType.PROTECT, result: { applied: true } });
    if (doctorAction.targetPlayerId === doctor!.playerId) {
      abilityUsageIncrements.push({ playerId: doctor!.playerId, ability: 'DOCTOR_SELF_PROTECT' });
    }
  }

  // 6. Bodyguard GUARD
  const bodyguard = findAlive(RoleCode.BODYGUARD);
  const bodyguardAction = bodyguard ? findAction(bodyguard.playerId, ActionType.GUARD) : null;
  const bodyguardTarget = bodyguardAction?.targetPlayerId ?? null;

  let finalPendingKills = afterDoctor;
  let guardConsumed = false;

  if (bodyguardTarget) {
    const hasRemainingKill = afterDoctor.some((k) => k.target === bodyguardTarget);
    if (hasRemainingKill) {
      guardConsumed = true;
      finalPendingKills = [
        ...afterDoctor.filter((k) => k.target !== bodyguardTarget),
        { target: bodyguard!.playerId },
      ];
    }
  }

  if (bodyguardAction) {
    results.push({ actorPlayerId: bodyguard!.playerId, actionType: ActionType.GUARD, result: { consumed: guardConsumed } });
  }

  // 7. Deaths finalized (dedup: a shared target dies once regardless of how many sources aimed at it).
  const deaths = [...new Set(finalPendingKills.map((k) => k.target))];

  for (const shot of sheriffShots) {
    results.push({
      actorPlayerId: shot.sheriffId,
      actionType: ActionType.SHOOT,
      result: { died: deaths.includes(shot.action.targetPlayerId) },
    });
    abilityUsageIncrements.push({ playerId: shot.sheriffId, ability: 'SHERIFF_SHOOT' });
  }

  // 8. Detective INVESTIGATE (OD-019: binary MAFIA/NOT_MAFIA flag). Like
  // Sheriff, up to two Detectives are possible at higher player counts.
  const detectives = alive.filter((r) => r.roleCode === RoleCode.DETECTIVE);
  for (const detective of detectives) {
    const action = findAction(detective.playerId, ActionType.INVESTIGATE);
    if (action) {
      results.push({
        actorPlayerId: detective.playerId,
        actionType: ActionType.INVESTIGATE,
        result: { flag: teamOf(action.targetPlayerId) === 'MAFIA' ? 'MAFIA' : 'NOT_MAFIA' },
      });
    }
  }

  // 9. Journalist INVESTIGATE_PAIR (team-based, never leaks Maniac-as-mafia)
  const journalist = findAlive(RoleCode.JOURNALIST);
  if (journalist) {
    const action = findAction(journalist.playerId, ActionType.INVESTIGATE_PAIR);
    if (action?.targetPlayerId2) {
      const sameTeam = teamOf(action.targetPlayerId) === teamOf(action.targetPlayerId2);
      results.push({
        actorPlayerId: journalist.playerId,
        actionType: ActionType.INVESTIGATE_PAIR,
        result: { relation: sameTeam ? 'SAME_TEAM' : 'DIFFERENT_TEAM' },
      });
    }
  }

  return { deaths, results, abilityUsageIncrements };
}
