import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { teamColorVar, teamLabel, roleInfo } from '../game/labels';
import { returnHome } from '../game/returnHome';
import type { Team, WinnerTeam } from '../api/games';
import { Screen, Card, Button, Badge, Avatar, Banner } from '../ui';

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
 * F5/F5.1: GAME_OVER screen. `gameResult` (`gameStore.ts`) is populated via
 * EITHER the `GAME_FINISHED` socket event (provisional — `winnerTeam` only)
 * OR `GET /games/:gameId/state`'s `result` (authoritative — full role
 * reveal, backend 95a2908/OD-F5-001 resolved) — REST always wins if the two
 * disagree, see `gameStore.applyGameResult`. `gameResult.players` is `null`
 * until REST resolves, so the role-reveal list below renders nothing until
 * then (the banner/winner line can already show from the event alone).
 * Does NOT show who died in which round or why — OD-061 found
 * `diedInRound`/`deathCause` aren't derivable without a backend schema
 * change; `lifeStatus` (alive/dead) is all that's available per player.
 */
function GameEndScreen() {
  const gameResult = useGameStore((s) => s.gameResult);
  const myTeam = useGameStore((s) => s.myTeam);
  const myPlayerId = useGameStore((s) => s.myPlayerId);

  const didWin = resolvePersonalOutcome(myTeam, gameResult?.winnerTeam ?? null);

  const accent = gameResult?.winnerTeam ? teamColorVar(gameResult.winnerTeam) : undefined;

  return (
    <Screen title={uz.gameEnd.title} footer={<Button onClick={returnHome}>{uz.gameEnd.backHome}</Button>}>
      {!gameResult && <Banner variant="warn">{uz.gameEnd.resultUnavailable}</Banner>}

      {gameResult && (
        <Card raised style={accent ? { borderTop: `3px solid ${accent}` } : undefined}>
          <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {uz.gameEnd.winnerLine(teamLabel(gameResult.winnerTeam ?? 'DRAW'))}
          </p>
          {didWin !== null && <Badge variant={didWin ? 'ready' : 'dead'}>{didWin ? uz.gameEnd.youWon : uz.gameEnd.youLost}</Badge>}
        </Card>
      )}

      {gameResult?.players && (
        <Card>
          <p style={{ fontWeight: 700, margin: 0 }}>{uz.gameEnd.rolesTitle}</p>
          {gameResult.players.map((p) => (
            <div key={p.playerId} className="rm-row" style={{ alignItems: 'center' }}>
              <Avatar name={p.displayName} size={32} ring={p.playerId === myPlayerId ? 'you' : 'none'} />
              <span style={{ flex: 1 }}>
                {p.displayName}
                {p.playerId === myPlayerId ? ` ${uz.night.youMarker}` : ''}
                <br />
                <span className="rm-hint">
                  {roleInfo(p.roleCode).name} · {teamLabel(p.team)}
                </span>
              </span>
              <Badge variant={p.lifeStatus === 'ALIVE' ? 'alive' : 'dead'}>
                {p.lifeStatus === 'ALIVE' ? uz.gameEnd.aliveTag : uz.day.deadTag}
              </Badge>
            </div>
          ))}
        </Card>
      )}
    </Screen>
  );
}

export default GameEndScreen;
