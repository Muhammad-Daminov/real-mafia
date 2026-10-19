import type { CSSProperties } from 'react';
import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { groupByTeam, teamColorVar, teamLabel, roleInfo } from '../game/labels';
import { returnHome } from '../game/returnHome';
import type { Team, WinnerTeam } from '../api/games';
import { Screen, Card, Button, Badge, Banner, PlayerTile } from '../ui';
import './GameEndScreen.css';

/**
 * Pure outcome decision, extracted for testing (no RTL in this project —
 * same convention as `NightScreen.tsx`'s `resolveNightScreenState`).
 * `null` means "no personal win/loss to show" — either the result isn't
 * known yet (OD-F5-001's reload gap) or the game ended in a `DRAW`, which
 * has no winning team to compare `myTeam` against. An unrecognized
 * `winnerTeam` string also falls through to `false` via the `===`
 * comparison below — never crashes, never guesses a result.
 */
export function resolvePersonalOutcome(myTeam: Team | null, winnerTeam: WinnerTeam | null): boolean | null {
  if (!myTeam || !winnerTeam || winnerTeam === 'DRAW') return null;
  return myTeam === winnerTeam;
}

/**
 * F5/F5.1/F7b: GAME_OVER screen. `gameResult` (`gameStore.ts`) is
 * populated via EITHER the `GAME_FINISHED` socket event (provisional —
 * `winnerTeam` only) OR `GET /games/:gameId/state`'s `result`
 * (authoritative — full role reveal, backend 95a2908/OD-F5-001 resolved)
 * — REST always wins if the two disagree, see `gameStore.applyGameResult`.
 * `gameResult.players` is `null` until REST resolves, so the role-reveal
 * list below renders nothing until then (the banner/winner line can
 * already show from the event alone). Does NOT show who died in which
 * round or why — OD-061 found `diedInRound`/`deathCause` aren't derivable
 * without a backend schema change; `lifeStatus` (alive/dead) is all that's
 * available per player. The winner banner's glow (`rm-end__banner--win`)
 * is a CSS-only celebration (task: "no confetti libraries") — a subtle
 * pulse, not an animated overlay, and disabled under
 * `prefers-reduced-motion` like every other emphasis animation this
 * slice adds.
 */
function GameEndScreen() {
  const gameResult = useGameStore((s) => s.gameResult);
  const myTeam = useGameStore((s) => s.myTeam);
  const myPlayerId = useGameStore((s) => s.myPlayerId);

  const didWin = resolvePersonalOutcome(myTeam, gameResult?.winnerTeam ?? null);

  const accent = gameResult?.winnerTeam ? teamColorVar(gameResult.winnerTeam) : undefined;
  const groups = gameResult?.players ? groupByTeam(gameResult.players) : [];

  return (
    <Screen title={uz.gameEnd.title} footer={<Button onClick={returnHome}>{uz.gameEnd.backHome}</Button>}>
      {!gameResult && <Banner variant="warn">{uz.gameEnd.resultUnavailable}</Banner>}

      {gameResult && (
        <Card
          raised
          className={didWin === true ? 'rm-end__banner rm-end__banner--win' : 'rm-end__banner'}
          style={accent ? ({ '--rm-end-accent': accent } as CSSProperties) : undefined}
        >
          <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {uz.gameEnd.winnerLine(teamLabel(gameResult.winnerTeam ?? 'DRAW'))}
          </p>
          {didWin !== null && <Badge variant={didWin ? 'ready' : 'dead'}>{didWin ? uz.gameEnd.youWon : uz.gameEnd.youLost}</Badge>}
        </Card>
      )}

      {groups.length > 0 && (
        <Card>
          <p style={{ fontWeight: 700, margin: 0 }}>{uz.gameEnd.rolesTitle}</p>
          {groups.map((group) => (
            <div key={group.team} className="rm-end__team-group">
              <p className="rm-hint" style={{ fontWeight: 700 }}>
                {teamLabel(group.team)}
              </p>
              {group.players.map((p) => (
                <PlayerTile
                  key={p.playerId}
                  layout="row"
                  name={p.displayName}
                  isYou={p.playerId === myPlayerId}
                  caption={roleInfo(p.roleCode).name}
                  trailing={
                    <Badge variant={p.lifeStatus === 'ALIVE' ? 'alive' : 'dead'}>
                      {p.lifeStatus === 'ALIVE' ? uz.gameEnd.aliveTag : uz.day.deadTag}
                    </Badge>
                  }
                />
              ))}
            </div>
          ))}
        </Card>
      )}
    </Screen>
  );
}

export default GameEndScreen;
