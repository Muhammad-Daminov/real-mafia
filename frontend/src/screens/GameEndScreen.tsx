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
 * has no winning team to compare `myTeam` against.
 */
export function resolvePersonalOutcome(myTeam: Team | null, winnerTeam: WinnerTeam | null): boolean | null {
  if (!myTeam || !winnerTeam || winnerTeam === 'DRAW') return null;
  return myTeam === winnerTeam;
}

/**
 * F5: GAME_OVER screen. `gameResult` (`gameStore.ts`) is set ONLY by the
 * `GAME_FINISHED` socket event (`{winnerTeam}`) — OD-F5-001: no REST
 * endpoint returns the game result to a member after the fact, so a
 * reload that missed the event shows `resultUnavailable` instead of a
 * guessed outcome. There is no role-reveal list here, by construction —
 * `GAME_FINISHED`'s payload has never carried one (confirmed by reading
 * `PhaseTransitionService.advancePhase`'s own broadcast call), not a
 * frontend choice to hide one that exists.
 */
function GameEndScreen() {
  const gameResult = useGameStore((s) => s.gameResult);
  const myTeam = useGameStore((s) => s.myTeam);
  const myRoleCode = useGameStore((s) => s.myRoleCode);

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

      {myRoleCode && <p className="mafia-hint">{uz.roleReveal.roleChip(roleInfo(myRoleCode).name)}</p>}

      <button className="mafia-button" onClick={returnHome}>
        {uz.gameEnd.backHome}
      </button>
    </div>
  );
}

export default GameEndScreen;
