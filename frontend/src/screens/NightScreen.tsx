import { useState } from 'react';
import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { roleInfo } from '../game/labels';
import { hasNightAction, primaryAbility } from '../game/nightAbility';
import { buildTargetRows, canConfirmSelection, submitSelectedTarget } from '../game/nightTargets';
import { describeNightActionError } from '../errors/nightActionErrorMessages';
import type { LifeStatus, RoleCode } from '../api/games';
import type { IneligibleReason } from '../game/targetEligibility';

export type NightScreenState = 'dead' | 'sleeping' | 'acting';

/**
 * Pure decision extracted for testing — no React Testing Library in this
 * project (no `.test.tsx` anywhere in `src/`), same convention
 * `LobbyScreen.tsx`'s `isDebugMode` already established: test the
 * predicate a component renders against, not the JSX itself.
 */
export function resolveNightScreenState(myLifeStatus: LifeStatus | null, myRoleCode: RoleCode | null): NightScreenState {
  if (myLifeStatus !== null && myLifeStatus !== 'ALIVE') {
    return 'dead';
  }
  if (!myRoleCode || !hasNightAction(myRoleCode)) {
    return 'sleeping';
  }
  return 'acting';
}

const REASON_LABEL: Record<IneligibleReason, string> = {
  SELF: uz.night.reasonSelf,
  DEAD: uz.night.reasonDead,
  EXCLUDED_TEAM: uz.night.reasonExcludedTeam,
};

/**
 * F4.1: the NIGHT phase screen. Three mutually exclusive states:
 *  - dead (`myLifeStatus !== 'ALIVE'`): a calm "watching" screen.
 *  - alive, role has no night action (CIVILIAN, or an unrecognized code):
 *    a calm "sleeping" screen — same tone, different copy, never a button.
 *  - alive, role has a night action: role/ability reminder, teammates
 *    (MAFIA/DON only, from gameStore — already sent by the backend, OD-025),
 *    and the real alive-target picker (OD-F4-001, resolved by backend
 *    commit 2395b4c — `RoomPlayerSummary.lifeStatus`).
 */
function NightScreen() {
  const gameId = useGameStore((s) => s.gameId);
  const myLifeStatus = useGameStore((s) => s.myLifeStatus);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const myRoleCode = useGameStore((s) => s.myRoleCode);
  const teammates = useGameStore((s) => s.teammates);
  const mySubmittedAction = useGameStore((s) => s.mySubmittedAction);
  const roomCode = useGameStore((s) => s.roomCode);
  const roster = useGameStore((s) => s.roster);
  const rosterLoading = useGameStore((s) => s.rosterLoading);
  const rosterError = useGameStore((s) => s.rosterError);

  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const screenState = resolveNightScreenState(myLifeStatus, myRoleCode);

  if (screenState === 'dead') {
    return (
      <div className="mafia-screen">
        <h1>{uz.night.watchingTitle}</h1>
        <p className="mafia-hint">{uz.night.watchingNote}</p>
      </div>
    );
  }

  if (screenState === 'sleeping') {
    return (
      <div className="mafia-screen">
        <h1>{uz.night.sleepingTitle}</h1>
        <p className="mafia-hint">{uz.night.sleepingNote}</p>
      </div>
    );
  }

  // screenState === 'acting' guarantees myRoleCode is non-null (see
  // resolveNightScreenState); hasNightAction being true guarantees
  // primaryAbility is non-null too (same underlying data).
  const info = roleInfo(myRoleCode!);
  const ability = primaryAbility(myRoleCode!)!;

  const toggleSelect = (playerId: string, eligible: boolean) => {
    if (!eligible) return;
    setSubmitError(null);
    setSelected((current) => {
      if (current.includes(playerId)) {
        return current.filter((id) => id !== playerId);
      }
      if (ability.pairTarget) {
        return current.length >= 2 ? [current[1]!, playerId] : [...current, playerId];
      }
      return [playerId];
    });
  };

  const handleConfirm = async () => {
    if (!gameId || !myPlayerId || !canConfirmSelection(ability, selected)) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await submitSelectedTarget(gameId, ability, selected);
      useGameStore.getState().applyActionSubmitted(response);
    } catch (error) {
      setSubmitError(describeNightActionError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mafia-screen">
      <h1>{uz.night.title}</h1>
      <div className="mafia-card">
        <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{info.name}</p>
        <p className="mafia-hint" style={{ margin: 0 }}>
          {info.ability}
        </p>

        {teammates.length > 0 && (
          <div className="mafia-row" style={{ flexWrap: 'wrap' }}>
            {teammates.map((teammate) => (
              <span key={teammate.playerId} className="mafia-badge">
                {roleInfo(teammate.roleCode).name}
              </span>
            ))}
          </div>
        )}
      </div>

      {!roomCode && <p className="mafia-banner mafia-banner--error">{uz.night.rosterUnavailable}</p>}

      {roomCode && rosterLoading && !roster && <p className="mafia-hint">{uz.night.rosterLoading}</p>}

      {roomCode && rosterError && !roster && <p className="mafia-banner mafia-banner--error">{uz.night.rosterError}</p>}

      {roomCode && roster && myPlayerId && (
        <div className="mafia-card">
          <p style={{ fontWeight: 600, margin: 0 }}>{uz.night.targetsTitle}</p>
          {ability.pairTarget && <p className="mafia-hint" style={{ margin: 0 }}>{uz.night.pairTargetHint}</p>}

          {buildTargetRows(ability, myPlayerId, roster, teammates).map((row) => {
            const isSelected = selected.includes(row.playerId);
            return (
              <button
                key={row.playerId}
                type="button"
                className={`mafia-button ${isSelected ? '' : 'mafia-button--secondary'}`}
                disabled={!row.eligible || submitting}
                onClick={() => toggleSelect(row.playerId, row.eligible)}
              >
                {row.displayName}
                {row.isSelf && ` ${uz.night.youMarker}`}
                {!row.eligible && row.reason && ` — ${REASON_LABEL[row.reason]}`}
              </button>
            );
          })}
        </div>
      )}

      {submitError && <p className="mafia-banner mafia-banner--error">{submitError}</p>}
      {mySubmittedAction && !submitError && <p className="mafia-hint">{uz.night.submitted}</p>}

      {roomCode && roster && myPlayerId && (
        <button
          className="mafia-button"
          disabled={!canConfirmSelection(ability, selected) || submitting}
          onClick={() => void handleConfirm()}
        >
          {submitting ? uz.night.submitting : mySubmittedAction ? uz.night.resubmitButton : uz.night.confirmButton}
        </button>
      )}
    </div>
  );
}

export default NightScreen;
