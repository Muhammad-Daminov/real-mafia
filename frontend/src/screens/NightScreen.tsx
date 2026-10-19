import { useState } from 'react';
import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { roleInfo } from '../game/labels';
import { hasNightAction, primaryAbility } from '../game/nightAbility';
import { buildTargetRows, canConfirmSelection, submitSelectedTarget, toggleTargetSelection } from '../game/nightTargets';
import { describeNightActionError } from '../errors/nightActionErrorMessages';
import type { LifeStatus, RoleCode } from '../api/games';
import type { IneligibleReason } from '../game/targetEligibility';
import { triggerConfirmHaptic, triggerSelectHaptic } from '../telegram/haptics';
import { InGameShell, Card, Button, Avatar, Banner, PlayerTile } from '../ui';

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
 * F4.1/F7b: the NIGHT phase screen, shelled by `InGameShell` (phase/round/
 * countdown/role chip/alive count, theme `night`). Three mutually
 * exclusive states:
 *  - dead (`myLifeStatus !== 'ALIVE'`): the shared spectator banner, no
 *    controls (task item 6 — "same layout" as everything else, via the
 *    same `InGameShell`).
 *  - alive, role has no night action (CIVILIAN, or an unrecognized code):
 *    a calm "sleeping" screen — same tone, different copy, never a button.
 *  - alive, role has a night action: role/ability reminder, a teammates
 *    strip (MAFIA/DON only, from gameStore — already sent by the backend,
 *    OD-025), and the real alive-target grid (OD-F4-001, resolved by
 *    backend commit 2395b4c — `RoomPlayerSummary.lifeStatus`). Tapping a
 *    tile is echoed in the pinned Confirm button's own label; once
 *    submitted, a "Change" action clears the local selection so a new
 *    pick can be made and resubmitted (OD-028: resubmitting mid-NIGHT
 *    updates the existing action in place, always allowed).
 */
function NightScreen() {
  const gameId = useGameStore((s) => s.gameId);
  const phase = useGameStore((s) => s.phase);
  const round = useGameStore((s) => s.round);
  const phaseEndsAt = useGameStore((s) => s.phaseEndsAt);
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
      <InGameShell theme="night" phase={phase} round={round} phaseEndsAt={phaseEndsAt} myRoleCode={myRoleCode} roster={roster}>
        <Banner variant="info">{uz.spectator.banner}</Banner>
        <p className="rm-hint">{uz.spectator.note}</p>
      </InGameShell>
    );
  }

  if (screenState === 'sleeping') {
    return (
      <InGameShell theme="night" phase={phase} round={round} phaseEndsAt={phaseEndsAt} myRoleCode={myRoleCode} roster={roster}>
        <Card>
          <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{uz.night.sleepingTitle}</p>
          <p className="rm-hint">{uz.night.sleepingNote}</p>
        </Card>
      </InGameShell>
    );
  }

  // screenState === 'acting' guarantees myRoleCode is non-null (see
  // resolveNightScreenState); hasNightAction being true guarantees
  // primaryAbility is non-null too (same underlying data).
  const info = roleInfo(myRoleCode!);
  const ability = primaryAbility(myRoleCode!)!;

  const toggleSelect = (playerId: string, eligible: boolean) => {
    if (!eligible || submitting) return;
    setSubmitError(null);
    triggerSelectHaptic();
    setSelected((current) => toggleTargetSelection(current, playerId, ability.pairTarget));
  };

  const nameFor = (playerId: string): string => roster?.find((p) => p.playerId === playerId)?.displayName ?? playerId;

  const handleConfirm = async () => {
    if (!gameId || !myPlayerId || !canConfirmSelection(ability, selected)) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await submitSelectedTarget(gameId, ability, selected);
      useGameStore.getState().applyActionSubmitted(response);
      triggerConfirmHaptic();
    } catch (error) {
      setSubmitError(describeNightActionError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const hasRoster = Boolean(roomCode && roster && myPlayerId);
  const selectedNames = selected.map(nameFor).join(', ');
  const confirmLabel = selected.length > 0 ? uz.night.confirmWithTarget(selectedNames) : uz.night.confirmButton;

  const footer = hasRoster ? (
    <Button disabled={!canConfirmSelection(ability, selected)} loading={submitting} onClick={() => void handleConfirm()}>
      {confirmLabel}
    </Button>
  ) : undefined;

  return (
    <InGameShell theme="night" phase={phase} round={round} phaseEndsAt={phaseEndsAt} myRoleCode={myRoleCode} roster={roster} footer={footer}>
      <Card>
        <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{info.name}</p>
        <p className="rm-hint">{info.ability}</p>

        {teammates.length > 0 && (
          <div>
            <p className="rm-hint" style={{ marginBottom: 'var(--rm-space-2)' }}>
              {uz.night.teammatesLabel}
            </p>
            <div className="rm-row" style={{ flexWrap: 'wrap' }}>
              {teammates.map((teammate) => (
                <div key={teammate.playerId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
                  <Avatar name={roleInfo(teammate.roleCode).name} size={36} />
                  <span className="rm-hint">{roleInfo(teammate.roleCode).name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {!roomCode && <Banner variant="error">{uz.night.rosterUnavailable}</Banner>}

      {roomCode && rosterLoading && !roster && <p className="rm-hint">{uz.night.rosterLoading}</p>}

      {roomCode && rosterError && !roster && <Banner variant="error">{uz.night.rosterError}</Banner>}

      {hasRoster && (
        <Card>
          <p style={{ fontWeight: 600, margin: 0 }}>{uz.night.targetsTitle}</p>
          {ability.pairTarget && <p className="rm-hint">{uz.night.pairTargetHint}</p>}

          <div className="rm-tile-grid">
            {buildTargetRows(ability, myPlayerId!, roster!, teammates).map((row) => (
              <PlayerTile
                key={row.playerId}
                name={row.displayName}
                isYou={row.isSelf}
                selected={selected.includes(row.playerId)}
                disabled={!row.eligible || submitting}
                caption={!row.eligible && row.reason ? REASON_LABEL[row.reason] : row.isSelf ? uz.night.youMarker : undefined}
                onClick={() => toggleSelect(row.playerId, row.eligible)}
              />
            ))}
          </div>
        </Card>
      )}

      {submitError && <Banner variant="error">{submitError}</Banner>}

      {mySubmittedAction && !submitError && (
        <Card>
          <p className="rm-hint">{uz.night.submittedLine(mySubmittedAction.targetPlayerId2 ? `${nameFor(mySubmittedAction.targetPlayerId)}, ${nameFor(mySubmittedAction.targetPlayerId2)}` : nameFor(mySubmittedAction.targetPlayerId))}</p>
          <Button variant="secondary" fullWidth={false} onClick={() => setSelected([])}>
            {uz.night.changeButton}
          </Button>
        </Card>
      )}
    </InGameShell>
  );
}

export default NightScreen;
