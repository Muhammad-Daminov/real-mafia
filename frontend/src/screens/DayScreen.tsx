import { useState } from 'react';
import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { roleInfo } from '../game/labels';
import { nightResultMessage } from '../game/nightResultMessage';
import { buildVoteRows, submitSelectedVote, summarizeTally } from '../game/voteTargets';
import { resolveDayAnnouncement } from '../game/dayAnnouncement';
import { describeVoteError } from '../errors/voteErrorMessages';
import { returnHome } from '../game/returnHome';
import { triggerConfirmHaptic, triggerSelectHaptic } from '../telegram/haptics';
import { InGameShell, Card, Button, Badge, Banner, PlayerTile } from '../ui';
import './DayScreen.css';

/**
 * F5/F7b: the day-phase screen (MORNING/DISCUSSION/VOTING/LAST_WORD/and
 * the transient resolution phases) — `GameStartedScreen` routes here for
 * everything that isn't NIGHT or GAME_OVER. Shelled by `InGameShell`,
 * themed `vote` (a tenser red-amber) during VOTING specifically, `day`
 * otherwise.
 *
 * `lastDeaths`/`lastPhaseFrom` (`gameStore.ts`) feed `resolveDayAnnouncement`
 * for the morning/vote-result card — OD-F5-001: no backend event names a
 * single night death (`MULTIPLE_DEATHS` only fires for >1) or a vote
 * execution's target at all, so this is a roster-snapshot diff, not a
 * dedicated announcement payload. The vote-result card's emphasis
 * animation is pure CSS (`rm-announce--pulse`) — it never gates rendering
 * of anything below it; the next phase's own `PHASE_CHANGED` arrives and
 * re-renders this screen on its own schedule regardless of whether the
 * animation has finished playing.
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
  const lastPhaseFrom = useGameStore((s) => s.lastPhaseFrom);
  const roomCode = useGameStore((s) => s.roomCode);
  const roster = useGameStore((s) => s.roster);
  const rosterLoading = useGameStore((s) => s.rosterLoading);
  const myVote = useGameStore((s) => s.myVote);
  const voteTally = useGameStore((s) => s.voteTally);
  const gameId = useGameStore((s) => s.gameId);

  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isAlive = myLifeStatus === 'ALIVE';
  const isVoting = phase === 'VOTING';
  const theme = isVoting ? 'vote' : 'day';

  const nameFor = (playerId: string): string => roster?.find((p) => p.playerId === playerId)?.displayName ?? playerId;

  const handleSelect = (playerId: string, eligible: boolean) => {
    if (!eligible || submitting) return;
    triggerSelectHaptic();
    setSelected(playerId);
  };

  const handleConfirmVote = async () => {
    if (!gameId || !selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await submitSelectedVote(gameId, selected);
      useGameStore.getState().applyVoteSubmitted(response);
      triggerConfirmHaptic();
    } catch (error) {
      setSubmitError(describeVoteError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const hasVotableRoster = isVoting && isAlive && roster && myPlayerId;
  const voteLabel = selected ? uz.day.confirmVoteWithTarget(nameFor(selected)) : myVote ? uz.day.changeVoteButton : uz.day.confirmVoteButton;

  const announcement = resolveDayAnnouncement(lastDeaths, lastPhaseFrom);

  const footer = (
    <>
      {hasVotableRoster && (
        <Button disabled={!selected} loading={submitting} onClick={() => void handleConfirmVote()}>
          {voteLabel}
        </Button>
      )}
      <Button variant="secondary" onClick={returnHome}>
        {uz.started.backHome}
      </Button>
    </>
  );

  return (
    <InGameShell theme={theme} phase={phase} round={round} phaseEndsAt={phaseEndsAt} myRoleCode={myRoleCode} roster={roster} footer={footer}>
      {stateError && <Banner variant="error">{uz.gameScreen.stateError}</Banner>}

      {announcement.kind === 'deaths' && (
        <Card raised className={announcement.context === 'VOTE' ? 'rm-announce--pulse' : undefined}>
          <p style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>
            {announcement.context === 'VOTE' ? uz.day.voteResultTitle : uz.day.morningTitle}
          </p>
          {announcement.playerIds.map((id) =>
            announcement.context === 'VOTE' ? (
              <p key={id} className="rm-hint">
                {uz.day.voteResultEliminatedLine(nameFor(id))}
              </p>
            ) : (
              <p key={id} className="rm-hint">
                {uz.day.diedLine(nameFor(id))}
              </p>
            ),
          )}
        </Card>
      )}

      {announcement.kind === 'quiet' && announcement.context === 'NIGHT' && (
        <Card>
          <p style={{ fontWeight: 700, margin: 0 }}>{uz.day.quietNightTitle}</p>
          <p className="rm-hint">{uz.day.quietNightLine}</p>
        </Card>
      )}

      {announcement.kind === 'quiet' && announcement.context === 'VOTE' && (
        <Card raised className="rm-announce--pulse">
          <p style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>{uz.day.voteResultTitle}</p>
          <p className="rm-hint">{uz.day.voteResultNoOneLine}</p>
        </Card>
      )}

      {nightResult && (
        <Card>
          <p style={{ fontWeight: 600, margin: 0 }}>{uz.nightResults.title}</p>
          <p className="rm-hint">{nightResultMessage(nightResult.event, nightResult.payload)}</p>
        </Card>
      )}

      {!isAlive && (
        <Banner variant="info">{uz.spectator.banner}</Banner>
      )}

      <Card>
        <p style={{ fontWeight: 600, margin: 0 }}>{uz.day.rosterTitle}</p>
        {!roomCode && <p className="rm-hint">{uz.night.rosterUnavailable}</p>}
        {roomCode && rosterLoading && !roster && <p className="rm-hint">{uz.night.rosterLoading}</p>}
        <div className="rm-day__roster">
          {roster?.map((player) => (
            <PlayerTile
              key={player.playerId}
              layout="row"
              name={player.displayName}
              isYou={player.playerId === myPlayerId}
              trailing={<Badge variant={player.lifeStatus === 'ALIVE' ? 'alive' : 'dead'}>{player.lifeStatus === 'ALIVE' ? uz.gameEnd.aliveTag : uz.day.deadTag}</Badge>}
            />
          ))}
        </div>
      </Card>

      {hasVotableRoster && (
        <Card>
          <p style={{ fontWeight: 600, margin: 0 }}>{uz.day.voteTitle}</p>

          <div className="rm-tile-grid">
            {buildVoteRows(myPlayerId, roster).map((row) => (
              <PlayerTile
                key={row.playerId}
                name={row.displayName}
                isYou={row.isSelf}
                selected={selected === row.playerId}
                disabled={!row.eligible || submitting}
                caption={!row.eligible ? uz.night.reasonDead : row.isSelf ? uz.night.youMarker : undefined}
                onClick={() => handleSelect(row.playerId, row.eligible)}
              />
            ))}
          </div>

          {submitError && <Banner variant="error">{submitError}</Banner>}
          {myVote && !submitError && <p className="rm-hint">{uz.day.voteSubmitted(nameFor(myVote))}</p>}

          {voteTally && voteTally.length > 0 && (
            <div>
              <p className="rm-hint" style={{ marginBottom: 'var(--rm-space-1)' }}>
                {uz.day.liveTallyTitle}
              </p>
              {summarizeTally(voteTally).map(({ targetPlayerId, count }) => (
                <p key={targetPlayerId} className="rm-hint">
                  {nameFor(targetPlayerId)}: {count}
                </p>
              ))}
            </div>
          )}
        </Card>
      )}

      {myRoleCode && (
        <p className="rm-hint">{uz.roleReveal.roleChip(roleInfo(myRoleCode).name)}</p>
      )}
    </InGameShell>
  );
}

export default DayScreen;
