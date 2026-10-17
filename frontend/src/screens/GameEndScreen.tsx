import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { teamLabel, roleInfo } from '../game/labels';
import { returnHome } from '../game/returnHome';
import type { Team, WinnerTeam } from '../api/games';

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

  return (
    <div className="mafia-screen">
      <h1>{uz.gameEnd.title}</h1>

      {!gameResult && <p className="mafia-banner mafia-banner--warn">{uz.gameEnd.resultUnavailable}</p>}

      {gameResult && (
        <div className="mafia-card">
          <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {uz.gameEnd.winnerLine(teamLabel(gameResult.winnerTeam ?? 'DRAW'))}
          </p>
          {didWin !== null && (
            <span className={`mafia-badge ${didWin ? 'mafia-badge--ready' : ''}`}>
              {didWin ? uz.gameEnd.youWon : uz.gameEnd.youLost}
            </span>
          )}
        </div>
      )}

      {gameResult?.players && (
        <div className="mafia-card">
          <p style={{ fontWeight: 700, margin: 0 }}>{uz.gameEnd.rolesTitle}</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {gameResult.players.map((p) => (
              <li key={p.playerId}>
                {p.displayName}
                {p.playerId === myPlayerId ? ` ${uz.night.youMarker}` : ''}
                {` — ${roleInfo(p.roleCode).name} (${teamLabel(p.team)})`}
                {p.lifeStatus !== 'ALIVE' ? ` · ${uz.day.deadTag}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="mafia-button" onClick={returnHome}>
        {uz.gameEnd.backHome}
      </button>
    </div>
  );
}

export default GameEndScreen;
