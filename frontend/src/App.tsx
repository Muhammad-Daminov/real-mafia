import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useLobbyStore } from './store/lobbyStore';
import { bindTelegramTheme } from './telegram/theme';
import { uz } from './messages/uz';
import DebugScreen from './screens/DebugScreen';
import HomeScreen from './screens/HomeScreen';
import LobbyScreen from './screens/LobbyScreen';
import GameStartedScreen from './screens/GameStartedScreen';
import './styles/mafia.css';

/**
 * F2: thin router/shell. `?debug=1` keeps the F1/F1.5/F1.6 debug screen
 * reachable unchanged (`screens/DebugScreen.tsx`); otherwise the view is
 * derived from `lobbyStore`'s state — no router library, just three
 * mutually-exclusive screens (home / lobby / started) driven by whether a
 * room is active and, once active, its `currentPhase`.
 */
function App() {
  const authStatus = useAuthStore((s) => s.status);
  const authError = useAuthStore((s) => s.error);
  const authenticate = useAuthStore((s) => s.authenticate);
  const roomId = useLobbyStore((s) => s.roomId);
  const currentPhase = useLobbyStore((s) => s.currentPhase);

  useEffect(() => {
    bindTelegramTheme();
    void authenticate();
  }, [authenticate]);

  const isDebug = new URLSearchParams(window.location.search).get('debug') === '1';

  if (isDebug) {
    return <DebugScreen />;
  }

  if (authStatus === 'not_in_telegram' || authStatus === 'session_expired' || authStatus === 'error') {
    return (
      <div className="mafia-screen">
        <h1>{uz.home.title}</h1>
        <p className="mafia-banner mafia-banner--error">
          {authStatus === 'not_in_telegram' && uz.auth.notInTelegram}
          {authStatus === 'session_expired' && uz.auth.sessionExpired}
          {authStatus === 'error' && (authError ?? uz.errors.generic)}
        </p>
        {authStatus === 'error' && (
          <button className="mafia-button" onClick={() => void authenticate()}>
            {uz.auth.retry}
          </button>
        )}
      </div>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <div className="mafia-screen">
        <h1>{uz.home.title}</h1>
        <p className="mafia-hint">{uz.auth.authenticating}</p>
      </div>
    );
  }

  if (roomId && currentPhase && currentPhase !== 'LOBBY') {
    return <GameStartedScreen />;
  }

  if (roomId) {
    return <LobbyScreen />;
  }

  return <HomeScreen />;
}

export default App;
