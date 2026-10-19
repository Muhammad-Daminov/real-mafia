import { useEffect, useState } from 'react';
import { uz } from '../messages/uz';
import { useAuthStore } from '../store/authStore';
import { useLobbyStore } from '../store/lobbyStore';
import { connectSocket } from '../socket/socketClient';
import { createRoom, joinRoom } from '../api/rooms';
import { describeRoomError } from '../errors/roomErrorMessages';
import { Screen, Card, Button, Banner } from '../ui';
import './HomeScreen.css';

/**
 * Entry flow (F2, redesigned F7a): "Create room" and "Join by code", both
 * lead to the lobby. Room config (maxPlayers/rulesetMode) has no UI here —
 * same debug-default reasoning as the old debug screen's Create button
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
    <Screen>
      <div className="rm-home__hero">
        <div className="rm-home__logo" aria-hidden="true">
          🎭
        </div>
        <h1 className="rm-home__title">{uz.home.title}</h1>
        <p className="rm-home__tagline">{uz.home.tagline}</p>
      </div>

      {notice && <Banner variant="warn">{notice}</Banner>}

      <Card>
        <Button onClick={() => void handleCreate()} loading={creating} disabled={!canAct}>
          {uz.home.createRoom}
        </Button>
        <p className="rm-home__helper">{uz.home.createHelper}</p>
      </Card>

      <Card>
        <p className="rm-home__section-title">{uz.home.joinSectionTitle}</p>
        <input
          className="rm-home__code-input"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          placeholder={uz.home.codePlaceholder}
          maxLength={6}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          disabled={!canAct}
          aria-label={uz.home.codePlaceholder}
        />
        <Button
          variant="secondary"
          onClick={() => void handleJoin()}
          loading={joining}
          disabled={!canAct || !codeInput.trim()}
        >
          {uz.home.joinByCode}
        </Button>
        <p className="rm-home__helper">{uz.home.joinHelper}</p>
      </Card>

      {error && <Banner variant="error">{error}</Banner>}

      <a className="rm-home__debug-link" href="?debug=1">
        {uz.home.debugLink}
      </a>
    </Screen>
  );
}

export default HomeScreen;
