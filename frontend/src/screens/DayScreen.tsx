import { useState } from 'react';
import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { phaseLabel, roleInfo } from '../game/labels';
import { useCountdown } from '../game/useCountdown';
import { nightResultMessage } from '../game/nightResultMessage';
import { buildVoteRows, submitSelectedVote, summarizeTally } from '../game/voteTargets';
import { describeVoteError } from '../errors/voteErrorMessages';
import { returnHome } from '../game/returnHome';
import { Screen, Card, Button, Badge, Chip, Banner } from '../ui';

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

  const footer = (
    <Button variant="secondary" onClick={returnHome}>
      {uz.started.backHome}
    </Button>
  );

  return (
    <Screen theme="day" title={phaseLabel(phase ?? '')} footer={footer}>
      {stateError && <Banner variant="error">{uz.gameScreen.stateError}</Banner>}

      {lastDeaths && (
        <Card>
          <p style={{ fontWeight: 600, margin: 0 }}>
            {lastDeaths.context === 'VOTE' ? uz.day.voteResultTitle : uz.day.morningTitle}
          </p>
          {lastDeaths.playerIds.map((id) => (
            <p key={id} className="rm-hint">
              {uz.day.diedLine(nameFor(id))}
            </p>
          ))}
        </Card>
      )}

      <Card>
        <p className="rm-hint">{uz.gameScreen.round(round)}</p>
        <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>{countdown ?? uz.gameScreen.noDeadline}</p>
        {myRoleCode && <Badge>{uz.roleReveal.roleChip(roleInfo(myRoleCode).name)}</Badge>}
      </Card>

      {nightResult && (
        <Card>
          <p style={{ fontWeight: 600, margin: 0 }}>{uz.nightResults.title}</p>
          <p className="rm-hint">{nightResultMessage(nightResult.event, nightResult.payload)}</p>
        </Card>
      )}

      <Card>
        <p style={{ fontWeight: 600, margin: 0 }}>{uz.day.rosterTitle}</p>
        {!roomCode && <p className="rm-hint">{uz.night.rosterUnavailable}</p>}
        {roomCode && rosterLoading && !roster && <p className="rm-hint">{uz.night.rosterLoading}</p>}
        {roster?.map((player) => (
          <p key={player.playerId} className="rm-hint" style={{ opacity: player.lifeStatus === 'ALIVE' ? 1 : 0.5 }}>
            {player.displayName}
            {player.playerId === myPlayerId && ` ${uz.night.youMarker}`}
            {player.lifeStatus !== 'ALIVE' && ` — ${uz.day.deadTag}`}
          </p>
        ))}
      </Card>

      {isVoting && isAlive && roster && myPlayerId && (
        <Card>
          <p style={{ fontWeight: 600, margin: 0 }}>{uz.day.voteTitle}</p>

          {buildVoteRows(myPlayerId, roster).map((row) => {
            const isSelected = selected === row.playerId;
            return (
              <Chip
                key={row.playerId}
                selected={isSelected}
                disabled={!row.eligible || submitting}
                onClick={() => row.eligible && setSelected(row.playerId)}
              >
                {row.displayName}
                {row.isSelf && ` ${uz.night.youMarker}`}
                {!row.eligible && ` — ${uz.night.reasonDead}`}
              </Chip>
            );
          })}

          {submitError && <Banner variant="error">{submitError}</Banner>}
          {myVote && !submitError && <p className="rm-hint">{uz.day.voteSubmitted(nameFor(myVote))}</p>}

          <Button disabled={!selected} loading={submitting} onClick={() => void handleConfirmVote()}>
            {myVote ? uz.day.changeVoteButton : uz.day.confirmVoteButton}
          </Button>

          {voteTally && voteTally.length > 0 && (
            <div>
              <p className="rm-hint" style={{ margin: '8px 0 4px' }}>
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

      {isVoting && !isAlive && <p className="rm-hint">{uz.day.spectatorNote}</p>}
    </Screen>
  );
}

export default DayScreen;
