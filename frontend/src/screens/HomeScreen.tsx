import { useEffect, useState } from 'react';
import { uz } from '../messages/uz';
import { useAuthStore } from '../store/authStore';
import { useLobbyStore } from '../store/lobbyStore';
import { connectSocket } from '../socket/socketClient';
import { createRoom, joinRoom } from '../api/rooms';
import { describeRoomError } from '../errors/roomErrorMessages';

/**
 * Entry flow (F2): "Create room" and "Join by code", both lead to the
 * lobby. Room config (maxPlayers/rulesetMode) has no UI here — same
 * debug-default reasoning as the old debug screen's Create button
 * (`POST /rooms` requires both fields with no sensible single default) —
 * a room-config screen is out of this slice's scope.
 */
function HomeScreen() {
  const authStatus = useAuthStore((s) => s.status);
  const enterFromCreate = useLobbyStore((s) => s.enterFromCreate);
  const enterFromJoin = useLobbyStore((s) => s.enterFromJoin);
  const refetchSnapshot = useLobbyStore((s) => s.refetchSnapshot);
  const notice = useLobbyStore((s) => s.notice);
  const clearNotice = useLobbyStore((s) => s.clearNotice);

  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canAct = authStatus === 'authenticated';

  // F2.1: `lobbyStore.notice` is a one-shot message set when a snapshot
  // refetch finds `players` absent (kicked/removed/not-a-member) — shown
  // once here, then cleared so it doesn't reappear on a later visit.
  useEffect(() => {
    if (notice) clearNotice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const room = await createRoom({ maxPlayers: 8, rulesetMode: 'NORMAL' });
      enterFromCreate(room);
      connectSocket(room.gameId);
    } catch (err) {
      setError(describeRoomError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    setError(null);
    try {
      const room = await joinRoom(code);
      enterFromJoin(code, room);
      connectSocket(room.gameId);
      // `JoinedRoom` has no visibility/rulesetMode — fill them in right
      // away instead of waiting for the first socket (re)connect.
      void refetchSnapshot();
    } catch (err) {
      setError(describeRoomError(err));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="mafia-screen">
      <h1>{uz.home.title}</h1>

      {notice && <p className="mafia-banner mafia-banner--warn">{notice}</p>}

      <div className="mafia-card">
        <button className="mafia-button" onClick={() => void handleCreate()} disabled={!canAct || creating}>
          {creating ? uz.home.creating : uz.home.createRoom}
        </button>
      </div>

      <div className="mafia-card">
        <input
          className="mafia-input"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          placeholder={uz.home.codePlaceholder}
          disabled={!canAct}
        />
        <button
          className="mafia-button mafia-button--secondary"
          onClick={() => void handleJoin()}
          disabled={!canAct || joining || !codeInput.trim()}
        >
          {joining ? uz.home.joining : uz.home.joinByCode}
        </button>
      </div>

      {error && <p className="mafia-banner mafia-banner--error">{error}</p>}

      <a className="mafia-hint" href="?debug=1">
        {uz.home.debugLink}
      </a>
    </div>
  );
}

export default HomeScreen;
