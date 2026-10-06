import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useLobbyStore } from './store/lobbyStore';
import { useGameStore } from './store/gameStore';
import { bindTelegramTheme } from './telegram/theme';
import { isDebugMode, persistDevModeFromUrl } from './debugFlags';
import { readStoredGameId } from './auth/gameIdStorage';
import { readStoredRoomCode } from './auth/roomCodeStorage';
import { connectSocket } from './socket/socketClient';
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
 * room is active and, once active, its `currentPhase`. `?debug=1` and
 * `?dev=1` are independent (`debugFlags.ts`) — `?dev=1` leaves this normal
 * routing alone and only gates `LobbyScreen`'s dev-bots panel, specifically
 * so it can be reached (unlike `?debug=1`, which routes away from Lobby
 * entirely).
 */
function App() {
  const authStatus = useAuthStore((s) => s.status);
  const authError = useAuthStore((s) => s.error);
  const authenticate = useAuthStore((s) => s.authenticate);
  const roomId = useLobbyStore((s) => s.roomId);
  const gameId = useLobbyStore((s) => s.gameId);
  const currentPhase = useLobbyStore((s) => s.currentPhase);
  const gameStoreGameId = useGameStore((s) => s.gameId);

  useEffect(() => {
    bindTelegramTheme();
    // ?dev=1 at load persists for the rest of this session (sessionStorage)
    // so later in-app navigation, which drops the query string, still shows
    // dev-only UI (the Lobby's dev-bots panel) — see debugFlags.ts.
    persistDevModeFromUrl(window.location.search);
    void authenticate();
  }, [authenticate]);

  // F3: once the game has left LOBBY, fetch the "my role + state" snapshot
  // (GET /games/:gameId/state, OD-059) the game screen needs — a one-time
  // init per gameId, not on every render.
  useEffect(() => {
    if (gameId && currentPhase && currentPhase !== 'LOBBY' && gameStoreGameId !== gameId) {
      // `initFromGameId` resets gameStore to its initial state synchronously
      // before its first `await` (see gameStore.ts) — `setRoomCode` runs
      // right after, in the same tick, so it is never clobbered by that
      // reset. F4.1: lobbyStore.code is already known at this point (set at
      // room creation/join, well before game start).
      void useGameStore.getState().initFromGameId(gameId);
      const code = useLobbyStore.getState().code;
      if (code) {
        useGameStore.getState().setRoomCode(code);
      }
    }
  }, [gameId, currentPhase, gameStoreGameId]);

  // OD-F3-002: reload recovery. `lobbyStore` never persists `roomId`/
  // `gameId` (only the JWT does, OD-F1-003) — a plain page reload loses
  // both, so this is the one path that can rediscover an in-progress game:
  // `auth/gameIdStorage.ts`'s persisted `gameId`, written by `gameStore`
  // itself on every successful `GET /games/:gameId/state`. Only attempted
  // once authenticated and only when nothing else (lobby or game) is
  // already active, so it never fights a fresh create/join flow.
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    if (roomId || gameStoreGameId) return;

    const stored = readStoredGameId();
    if (!stored) return;

    void (async () => {
      await useGameStore.getState().initFromGameId(stored);
      const s = useGameStore.getState();
      if (s.gameId === stored && !s.stateError) {
        // F4.1/OD-F4-002: recover the roster's room code the same way —
        // `auth/roomCodeStorage.ts`, written by `setRoomCode` at the same
        // moment `gameId` was originally persisted. Absent only for a
        // session whose `gameId` was persisted before this code shipped;
        // `gameStore.roomCode` staying `null` is then the documented,
        // honest fallback (NightScreen shows it plainly, no roster fetch
        // is attempted).
        const storedCode = readStoredRoomCode();
        if (storedCode) {
          useGameStore.getState().setRoomCode(storedCode);
        }
        connectSocket(stored);
      }
    })();
  }, [authStatus, roomId, gameStoreGameId]);

  if (isDebugMode(window.location.search)) {
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

  // `gameStoreGameId` alone (no `roomId`) covers the reload-recovery path
  // above — `lobbyStore` never got a chance to populate, so routing can't
  // wait on it.
  if ((roomId && currentPhase && currentPhase !== 'LOBBY') || gameStoreGameId) {
    return <GameStartedScreen />;
  }

  if (roomId) {
    return <LobbyScreen />;
  }

  return <HomeScreen />;
}

export default App;
