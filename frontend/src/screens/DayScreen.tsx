import { useState } from 'react';
import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { phaseLabel, roleInfo } from '../game/labels';
import { useCountdown } from '../game/useCountdown';
import { nightResultMessage } from '../game/nightResultMessage';
import { buildVoteRows, submitSelectedVote, summarizeTally } from '../game/voteTargets';
import { describeVoteError } from '../errors/voteErrorMessages';
import { returnHome } from '../game/returnHome';

/**
 * F5: the day-phase screen (MORNING/DISCUSSION/VOTING/LAST_WORD/and the
 * transient resolution phases, should one ever be observed long enough to
 * render) — `GameStartedScreen` routes here for everything that isn't
 * NIGHT or GAME_OVER.
 *
 * `lastDeaths` (`gameStore.ts`, `game/deathDiff.ts`) is the only signal
 * for "who died" — OD-F5-001: no backend event names a single night death
 * (`MULTIPLE_DEATHS` only fires for >1) or a vote execution's target at
 * all, so this is a roster-snapshot diff, not a dedicated announcement
 * payload.
 */
function DayScreen() {
  const phase = useGameStore((s) => s.phase);
  const round = useGameStore((s) => s.round);
  const phaseEndsAt = useGameStore((s) => s.phaseEndsAt);
  const myRoleCode = useGameStore((s) => s.myRoleCode);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const myLifeStatus = useGameStore((s) => s.myLifeStatus);
  const stateError = useGameStore((s) => s.stateError);
  const nightResult = useGameStore((s) => s.nightResult);
  const lastDeaths = useGameStore((s) => s.lastDeaths);
  const roomCode = useGameStore((s) => s.roomCode);
  const roster = useGameStore((s) => s.roster);
  const rosterLoading = useGameStore((s) => s.rosterLoading);
  const myVote = useGameStore((s) => s.myVote);
  const voteTally = useGameStore((s) => s.voteTally);
  const gameId = useGameStore((s) => s.gameId);
  const countdown = useCountdown(phaseEndsAt);

  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isAlive = myLifeStatus === 'ALIVE';
  const isVoting = phase === 'VOTING';

  const nameFor = (playerId: string): string => roster?.find((p) => p.playerId === playerId)?.displayName ?? playerId;

  const handleConfirmVote = async () => {
    if (!gameId || !selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await submitSelectedVote(gameId, selected);
      useGameStore.getState().applyVoteSubmitted(response);
    } catch (error) {
      setSubmitError(describeVoteError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mafia-screen">
      <h1>{phaseLabel(phase ?? '')}</h1>

      {stateError && <p className="mafia-banner mafia-banner--error">{uz.gameScreen.stateError}</p>}

      {lastDeaths && (
        <div className="mafia-card">
          <p style={{ fontWeight: 600, margin: 0 }}>
            {lastDeaths.context === 'VOTE' ? uz.day.voteResultTitle : uz.day.morningTitle}
          </p>
          {lastDeaths.playerIds.map((id) => (
            <p key={id} className="mafia-hint" style={{ margin: 0 }}>
              {uz.day.diedLine(nameFor(id))}
            </p>
          ))}
        </div>
      )}

      <div className="mafia-card">
        <p className="mafia-hint" style={{ margin: 0 }}>
          {uz.gameScreen.round(round)}
        </p>
        <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>{countdown ?? uz.gameScreen.noDeadline}</p>
        {myRoleCode && <span className="mafia-badge">{uz.roleReveal.roleChip(roleInfo(myRoleCode).name)}</span>}
      </div>

      {nightResult && (
        <div className="mafia-card">
          <p style={{ fontWeight: 600, margin: 0 }}>{uz.nightResults.title}</p>
          <p className="mafia-hint" style={{ margin: 0 }}>
            {nightResultMessage(nightResult.event, nightResult.payload)}
          </p>
        </div>
      )}

      <div className="mafia-card">
        <p style={{ fontWeight: 600, margin: 0 }}>{uz.day.rosterTitle}</p>
        {!roomCode && <p className="mafia-hint">{uz.night.rosterUnavailable}</p>}
        {roomCode && rosterLoading && !roster && <p className="mafia-hint">{uz.night.rosterLoading}</p>}
        {roster?.map((player) => (
          <p
            key={player.playerId}
            className="mafia-hint"
            style={{ margin: 0, opacity: player.lifeStatus === 'ALIVE' ? 1 : 0.5 }}
          >
            {player.displayName}
            {player.playerId === myPlayerId && ` ${uz.night.youMarker}`}
            {player.lifeStatus !== 'ALIVE' && ` — ${uz.day.deadTag}`}
          </p>
        ))}
      </div>

      {isVoting && isAlive && roster && myPlayerId && (
        <div className="mafia-card">
          <p style={{ fontWeight: 600, margin: 0 }}>{uz.day.voteTitle}</p>

          {buildVoteRows(myPlayerId, roster).map((row) => {
            const isSelected = selected === row.playerId;
            return (
              <button
                key={row.playerId}
                type="button"
                className={`mafia-button ${isSelected ? '' : 'mafia-button--secondary'}`}
                disabled={!row.eligible || submitting}
                onClick={() => row.eligible && setSelected(row.playerId)}
              >
                {row.displayName}
                {row.isSelf && ` ${uz.night.youMarker}`}
                {!row.eligible && ` — ${uz.night.reasonDead}`}
              </button>
            );
          })}

          {submitError && <p className="mafia-banner mafia-banner--error">{submitError}</p>}
          {myVote && !submitError && <p className="mafia-hint">{uz.day.voteSubmitted(nameFor(myVote))}</p>}

          <button className="mafia-button" disabled={!selected || submitting} onClick={() => void handleConfirmVote()}>
            {submitting ? uz.night.submitting : myVote ? uz.day.changeVoteButton : uz.day.confirmVoteButton}
          </button>

          {voteTally && voteTally.length > 0 && (
            <div>
              <p className="mafia-hint" style={{ margin: '8px 0 4px' }}>
                {uz.day.liveTallyTitle}
              </p>
              {summarizeTally(voteTally).map(({ targetPlayerId, count }) => (
                <p key={targetPlayerId} className="mafia-hint" style={{ margin: 0 }}>
                  {nameFor(targetPlayerId)}: {count}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {isVoting && !isAlive && <p className="mafia-hint">{uz.day.spectatorNote}</p>}

      <button className="mafia-button mafia-button--secondary" onClick={returnHome}>
        {uz.started.backHome}
      </button>
    </div>
  );
}

export default DayScreen;
