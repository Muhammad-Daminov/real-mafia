import { uz } from '../messages/uz';
import { useLobbyStore } from '../store/lobbyStore';
import { disconnectSocket } from '../socket/socketClient';

/** Placeholder for item 4: "show a simple placeholder screen 'Game started
 * - phase: X'" — real game screens (role reveal, night, voting) are a later
 * slice's scope, explicitly excluded here. */
function GameStartedScreen() {
  const currentPhase = useLobbyStore((s) => s.currentPhase);

  const handleBackHome = () => {
    disconnectSocket();
    useLobbyStore.getState().reset();
  };

  return (
    <div className="mafia-screen">
      <h1>{uz.started.title}</h1>
      <div className="mafia-card">
        <p>{uz.started.phase(currentPhase ?? '—')}</p>
        <p className="mafia-hint">{uz.started.note}</p>
      </div>
      <button className="mafia-button mafia-button--secondary" onClick={handleBackHome}>
        {uz.started.backHome}
      </button>
    </div>
  );
}

export default GameStartedScreen;
