import { useEffect, useState } from 'react';
import { useAuthStore } from './store/authStore';
import { useSocketStore } from './store/socketStore';
import { connectSocket, disconnectSocket } from './socket/socketClient';

/**
 * Slice F1's entire UI: a debug screen proving the auth + socket plumbing
 * works, nothing else (no lobby, no game screens — see the slice's stated
 * non-goals). `gameId` is a manual text input because there is no
 * room/lobby flow yet to source one from — the realtime gateway requires it
 * at handshake time regardless (see socketClient.ts's docstring).
 */
function App() {
  const { status: authStatus, user, error: authError, authenticate } = useAuthStore();
  const { status: socketStatus, lastError: socketError, lastEventName } = useSocketStore();
  const [gameIdInput, setGameIdInput] = useState('');
  const [connectedGameId, setConnectedGameId] = useState<string | null>(null);

  useEffect(() => {
    void authenticate();
  }, [authenticate]);

  useEffect(() => {
    return () => disconnectSocket();
  }, []);

  const handleConnect = () => {
    const gameId = gameIdInput.trim();
    if (!gameId) return;
    setConnectedGameId(gameId);
    connectSocket(gameId);
  };

  const handleDisconnect = () => {
    disconnectSocket();
    setConnectedGameId(null);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0b0b0b', color: '#fff', padding: '20px', fontFamily: 'monospace' }}>
      <h1 style={{ fontSize: '20px' }}>REAL MAFIA — F1 debug screen</h1>

      <section style={{ marginTop: '24px', padding: '12px', border: '1px solid #333', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '16px', marginTop: 0 }}>Auth</h2>
        <p>status: {authStatus}</p>
        <p>user id: {user?.id ?? '—'}</p>
        {authStatus === 'not_in_telegram' && (
          <p style={{ color: '#f87171' }}>
            Not running inside Telegram — open this Mini App via the bot, not a plain browser tab.
          </p>
        )}
        {authStatus === 'error' && authError && <p style={{ color: '#f87171' }}>error: {authError}</p>}
        {authStatus === 'error' && (
          <button onClick={() => void authenticate()}>Retry auth</button>
        )}
      </section>

      <section style={{ marginTop: '16px', padding: '12px', border: '1px solid #333', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '16px', marginTop: 0 }}>Socket (/game)</h2>
        <p>status: {socketStatus}</p>
        <p>last event: {lastEventName ?? '—'}</p>
        {socketError && <p style={{ color: '#f87171' }}>last error/reason: {socketError}</p>}

        <input
          value={gameIdInput}
          onChange={(e) => setGameIdInput(e.target.value)}
          placeholder="gameId (manual — no lobby yet)"
          disabled={authStatus !== 'authenticated'}
          style={{ marginRight: '8px' }}
        />
        <button onClick={handleConnect} disabled={authStatus !== 'authenticated' || !gameIdInput.trim()}>
          Connect
        </button>
        <button onClick={handleDisconnect} disabled={!connectedGameId} style={{ marginLeft: '8px' }}>
          Disconnect
        </button>
      </section>
    </div>
  );
}

export default App;
