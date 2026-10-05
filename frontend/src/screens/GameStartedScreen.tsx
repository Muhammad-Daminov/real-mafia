import { uz } from '../messages/uz';
import { useLobbyStore } from '../store/lobbyStore';
import { useGameStore } from '../store/gameStore';
import { disconnectSocket } from '../socket/socketClient';
import { phaseLabel, roleInfo } from '../game/labels';
import { useCountdown } from '../game/useCountdown';
import RoleRevealScreen from './RoleRevealScreen';

/**
 * F3: replaces the placeholder "Game started - phase: X" screen with the
 * minimal in-game phase screen — uz phase label, round number, countdown
 * from `phaseEndsAt` (OD-F3-001: plain local-clock countdown, no
 * server-time-offset mechanism exists in this codebase). Shows
 * `RoleRevealScreen` first if the caller's role is known and not yet
 * dismissed; afterwards a small "My role" chip stays visible here. Night/
 * voting/chat screens are a later slice's scope.
 */
function GameStartedScreen() {
  const phase = useGameStore((s) => s.phase);
  const round = useGameStore((s) => s.round);
  const phaseEndsAt = useGameStore((s) => s.phaseEndsAt);
  const myRoleCode = useGameStore((s) => s.myRoleCode);
  const roleRevealDismissed = useGameStore((s) => s.roleRevealDismissed);
  const stateError = useGameStore((s) => s.stateError);
  const countdown = useCountdown(phaseEndsAt);

  const handleBackHome = () => {
    disconnectSocket();
    useLobbyStore.getState().reset();
    useGameStore.getState().reset();
  };

  if (myRoleCode && !roleRevealDismissed) {
    return <RoleRevealScreen />;
  }

  return (
    <div className="mafia-screen">
      <h1>{uz.started.title}</h1>

      {stateError && <p className="mafia-banner mafia-banner--error">{uz.gameScreen.stateError}</p>}

      <div className="mafia-card">
        <p style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{phaseLabel(phase ?? '')}</p>
        <p className="mafia-hint" style={{ margin: 0 }}>{uz.gameScreen.round(round)}</p>
        <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>{countdown ?? uz.gameScreen.noDeadline}</p>
        {myRoleCode && <span className="mafia-badge">{uz.roleReveal.roleChip(roleInfo(myRoleCode).name)}</span>}
      </div>

      <button className="mafia-button mafia-button--secondary" onClick={handleBackHome}>
        {uz.started.backHome}
      </button>
    </div>
  );
}

export default GameStartedScreen;
