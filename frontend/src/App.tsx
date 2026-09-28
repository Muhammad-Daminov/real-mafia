import { useEffect, useState } from 'react';
import { useAuthStore } from './store/authStore';
import { useSocketStore } from './store/socketStore';
import { connectSocket, disconnectSocket } from './socket/socketClient';
import { ApiError } from './api/client';
import { createRoom, type CreatedRoom } from './api/rooms';

/**
 * Slice F1/F1.5's entire UI: a debug screen proving the auth + socket
 * plumbing works, nothing else (no lobby, no game screens — see the
 * slice's stated non-goals). "Create room" uses hardcoded debug defaults
 * (8 players, NORMAL ruleset) since there's no room-config UI in scope —
 * `POST /rooms` requires both fields (../../src/rooms/dto/create-room.dto.ts)
 * with no sensible single default for either, unlike `visibility`.
 */
function App() {
  const { status: authStatus, user, error: authError, authenticate } = useAuthStore();
  const { status: socketStatus, lastError: socketError, eventLog } = useSocketStore();
  const [gameIdInput, setGameIdInput] = useState('');
  const [connectedGameId, setConnectedGameId] = useState<string | null>(null);
  const [createdRoom, setCreatedRoom] = useState<CreatedRoom | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomError, setRoomError] = useState<ApiError | Error | null>(null);

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

  const handleCreateRoom = async () => {
    setCreatingRoom(true);
    setRoomError(null);
    try {
      const room = await createRoom({ maxPlayers: 8, rulesetMode: 'NORMAL' });
      setCreatedRoom(room);
      setGameIdInput(room.gameId);
      setConnectedGameId(room.gameId);
      connectSocket(room.gameId);
    } catch (error) {
      setRoomError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setCreatingRoom(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0b0b0b', color: '#fff', padding: '20px', fontFamily: 'monospace' }}>
      <h1 style={{ fontSize: '20px' }}>REAL MAFIA — debug screen</h1>

      <section style={{ marginTop: '24px', padding: '12px', border: '1px solid #333', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '16px', marginTop: 0 }}>Auth</h2>
        <p>status: {authStatus}</p>
        <p>user id: {user?.id ?? '—'}</p>
        {authStatus === 'not_in_telegram' && (
          <p style={{ color: '#f87171' }}>
            Not running inside Telegram — open this Mini App via the bot, not a plain browser tab.
          </p>
        )}
        {authStatus === 'session_expired' && (
          <p style={{ color: '#f87171' }}>
            Session expired. Close the Mini App and reopen it from the bot menu.
          </p>
        )}
        {authStatus === 'error' && authError && <p style={{ color: '#f87171' }}>error: {authError}</p>}
        {authStatus === 'error' && (
          <button onClick={() => void authenticate()}>Retry auth</button>
        )}
      </section>

      <section style={{ marginTop: '16px', padding: '12px', border: '1px solid #333', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '16px', marginTop: 0 }}>Create room</h2>
        <button onClick={() => void handleCreateRoom()} disabled={authStatus !== 'authenticated' || creatingRoom}>
          {creatingRoom ? 'Creating…' : 'Create room'}
        </button>
        {createdRoom && (
          <p style={{ color: '#4ade80' }}>
            code: {createdRoom.code} · gameId: {createdRoom.gameId}
          </p>
        )}
        {roomError && (
          <p style={{ color: '#f87171' }}>
            error:{' '}
            {roomError instanceof ApiError
              ? `status ${roomError.status}${roomError.code ? ` · code ${roomError.code}` : ''} · ${roomError.message}`
              : roomError.message}
          </p>
        )}
      </section>

      <section style={{ marginTop: '16px', padding: '12px', border: '1px solid #333', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '16px', marginTop: 0 }}>Socket (/game)</h2>
        <p>status: {socketStatus}</p>
        {socketError && <p style={{ color: '#f87171' }}>last error/reason: {socketError}</p>}

        <input
          value={gameIdInput}
          onChange={(e) => setGameIdInput(e.target.value)}
          placeholder="gameId (manual, or auto-filled by Create room)"
          disabled={authStatus !== 'authenticated'}
          style={{ marginRight: '8px' }}
        />
        <button onClick={handleConnect} disabled={authStatus !== 'authenticated' || !gameIdInput.trim()}>
          Connect
        </button>
        <button onClick={handleDisconnect} disabled={!connectedGameId} style={{ marginLeft: '8px' }}>
          Disconnect
        </button>

        <h3 style={{ fontSize: '14px', marginTop: '16px', marginBottom: '4px' }}>
          Event log (newest first, max 50)
        </h3>
        <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid #222', borderRadius: '4px', padding: '8px' }}>
          {eventLog.length === 0 && <p style={{ color: '#666', margin: 0 }}>—</p>}
          {eventLog.map((entry, i) => (
            <div key={`${entry.receivedAt}-${i}`} style={{ marginBottom: '6px', fontSize: '12px' }}>
              <span style={{ color: '#60a5fa' }}>{entry.name}</span>{' '}
              <span style={{ color: '#999' }}>{JSON.stringify(entry.payload)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
