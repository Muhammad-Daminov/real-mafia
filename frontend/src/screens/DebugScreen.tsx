import { useEffect, useState } from 'react';
import { useAuthStore, describeAuthFailure } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import { connectSocket, disconnectSocket } from '../socket/socketClient';
import { ApiError, getStoredToken } from '../api/client';
import { createRoom, joinRoom, leaveRoom, setReady, type CreatedRoom } from '../api/rooms';
import { getRawInitData } from '../telegram/initData';
import { apiUrlHost } from '../config/env';

/** `initData`'s length only, never its content (it carries the user's
 * Telegram profile fields) — `null` if unavailable (not in Telegram, or no
 * initData at all). Read once, not on every render: `getRawInitData()`
 * runs the `@telegram-apps/sdk` bridge's `init()`, which is idempotent but
 * still a real side effect, not worth repeating per render. */
function readInitDataLength(): number | null {
  try {
    return getRawInitData().length;
  } catch {
    return null;
  }
}

/**
 * Slices F1/F1.5/F1.6's debug screen, unchanged by F2 other than moving out
 * of `App.tsx` (now a thin router — see `App.tsx`'s docstring) into its own
 * component, reachable at `?debug=1`. `currentRoomId` is the **room** id,
 * not the game id — Ready/Leave are room-id-keyed endpoints
 * (`LeaveRoomDto`/`SetReadyDto`'s own docstrings: "the room id is a route
 * param, not body"), a real, easy-to-miss distinction from the gameId the
 * socket connects with.
 */
function DebugScreen() {
  const { status: authStatus, user, error: authError, failure: authFailure, authenticate } = useAuthStore();
  const { status: socketStatus, lastError: socketError, eventLog } = useSocketStore();
  const [initDataLength] = useState<number | null>(() => readInitDataLength());
  const [gameIdInput, setGameIdInput] = useState('');
  const [connectedGameId, setConnectedGameId] = useState<string | null>(null);
  const [createdRoom, setCreatedRoom] = useState<CreatedRoom | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomError, setRoomError] = useState<ApiError | Error | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [settingReady, setSettingReady] = useState(false);
  const [leavingRoom, setLeavingRoom] = useState(false);

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
      setCurrentRoomId(room.roomId);
      setGameIdInput(room.gameId);
      setConnectedGameId(room.gameId);
      connectSocket(room.gameId);
    } catch (error) {
      setRoomError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleJoinRoom = async () => {
    const code = joinCodeInput.trim();
    if (!code) return;
    setJoiningRoom(true);
    setRoomError(null);
    try {
      const room = await joinRoom(code);
      setCreatedRoom(null);
      setCurrentRoomId(room.roomId);
      setGameIdInput(room.gameId);
      setConnectedGameId(room.gameId);
      connectSocket(room.gameId);
    } catch (error) {
      setRoomError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setJoiningRoom(false);
    }
  };

  const handleSetReady = async () => {
    if (!currentRoomId) return;
    setSettingReady(true);
    setRoomError(null);
    try {
      await setReady(currentRoomId, true);
    } catch (error) {
      setRoomError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setSettingReady(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (!currentRoomId) return;
    setLeavingRoom(true);
    setRoomError(null);
    try {
      await leaveRoom(currentRoomId);
      setCurrentRoomId(null);
      setCreatedRoom(null);
    } catch (error) {
      setRoomError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLeavingRoom(false);
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
        {/* Real cause, plain English — e.g. "POST /auth/telegram -> 400
            INIT_DATA_INVALID" or "network error (request never reached the
            server)". Debug-only; normal users never see this (App.tsx's uz
            messages are unchanged). */}
        {authFailure && (
          <p style={{ color: '#fbbf24' }}>detail: {describeAuthFailure(authFailure)}</p>
        )}
        {authStatus === 'error' && (
          <button onClick={() => void authenticate()}>Retry auth</button>
        )}

        <p style={{ marginTop: '12px', color: '#999' }}>
          stored token found: {String(getStoredToken() !== null)} · initData length: {initDataLength ?? 'n/a'} ·
          VITE_API_URL host: {apiUrlHost()}
        </p>
      </section>

      <section style={{ marginTop: '16px', padding: '12px', border: '1px solid #333', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '16px', marginTop: 0 }}>Room</h2>
        <button onClick={() => void handleCreateRoom()} disabled={authStatus !== 'authenticated' || creatingRoom}>
          {creatingRoom ? 'Creating…' : 'Create room'}
        </button>
        {createdRoom && (
          <p style={{ color: '#4ade80' }}>
            code: {createdRoom.code} · gameId: {createdRoom.gameId}
          </p>
        )}

        <div style={{ marginTop: '12px' }}>
          <input
            value={joinCodeInput}
            onChange={(e) => setJoinCodeInput(e.target.value)}
            placeholder="room code"
            disabled={authStatus !== 'authenticated'}
            style={{ marginRight: '8px' }}
          />
          <button
            onClick={() => void handleJoinRoom()}
            disabled={authStatus !== 'authenticated' || joiningRoom || !joinCodeInput.trim()}
          >
            {joiningRoom ? 'Joining…' : 'Join room'}
          </button>
        </div>

        <div style={{ marginTop: '12px' }}>
          <button onClick={() => void handleSetReady()} disabled={!currentRoomId || settingReady}>
            {settingReady ? 'Setting ready…' : 'Ready'}
          </button>
          <button
            onClick={() => void handleLeaveRoom()}
            disabled={!currentRoomId || leavingRoom}
            style={{ marginLeft: '8px' }}
          >
            {leavingRoom ? 'Leaving…' : 'Leave'}
          </button>
        </div>

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

export default DebugScreen;
