import { useEffect, useState } from 'react';
import { uz } from '../messages/uz';
import { useSocketStore } from '../store/socketStore';
import { canStartGame, useLobbyStore } from '../store/lobbyStore';
import { disconnectSocket } from '../socket/socketClient';
import { leaveRoom, setReady, startGame, type RoomPlayerSummary } from '../api/rooms';
import { fillBots } from '../api/devTools';
import { ApiError } from '../api/client';
import { describeRoomError } from '../errors/roomErrorMessages';
import { isDevMode } from '../debugFlags';
import { Screen, Card, Button, Banner, Avatar, Badge } from '../ui';
import './LobbyScreen.css';

interface DevBotsPanelProps {
  code: string;
}

/**
 * Dev-only (`?dev=1`, or `?debug=1`'s standalone `DebugScreen` never
 * reaches this component at all — see `debugFlags.ts`) control for
 * `POST /dev/rooms/:code/fill-bots`
 * (../../../src/dev-tools/dev-tools.controller.ts, B-D1, backend commit
 * f7d95e2). Deliberately plain English, no `uz` strings — this panel never
 * appears for a real user. After a successful call this does nothing else:
 * the bots join through `RoomsService.joinRoom`/`setReady` for real, which
 * broadcasts the same `PLAYER_JOINED`/`PLAYER_READY_CHANGED` events any
 * other join does — `socketClient.ts`'s existing handler already schedules
 * the debounced roster refetch for those, so a second manual refetch here
 * would just be a redundant duplicate request. F7a: collapsed behind a
 * `<details>` so it never competes with the real UI for space, even while
 * `?dev=1` is on.
 */
function DevBotsPanel({ code }: DevBotsPanelProps) {
  const [count, setCount] = useState(3);
  const [ready, setReadyChecked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFill = async () => {
    setBusy(true);
    setError(null);
    try {
      await fillBots(code, count, ready);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setError('Dev tools are disabled on the backend (DEV_TOOLS_ENABLED)');
        } else if (err.status === 403) {
          setError(err.message || 'You are not a member of this room.');
        } else {
          setError(`${err.status}${err.code ? ` ${err.code}` : ''}: ${err.message}`);
        }
      } else {
        setError('Network error.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="rm-lobby__dev">
      <summary>{uz.lobby.devSectionTitle}</summary>
      <Card>
        <div className="rm-lobby__dev-row">
          <input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 60 }}
            aria-label="Bot count"
          />
          <label>
            <input type="checkbox" checked={ready} onChange={(e) => setReadyChecked(e.target.checked)} /> Ready
          </label>
          <Button variant="secondary" fullWidth={false} onClick={() => void handleFill()} disabled={busy}>
            {busy ? '…' : 'Fill with bots'}
          </Button>
        </div>
        {error && <Banner variant="error">{error}</Banner>}
      </Card>
    </details>
  );
}

const START_REASON_TEXT: Record<NonNullable<ReturnType<typeof canStartGame>['reasonKey']>, (state: {
  playerCount: number;
}) => string> = {
  NOT_HOST: () => uz.lobby.startReasonNotHost,
  NOT_ENOUGH_PLAYERS: (state) =>
    uz.lobby.startReasonNotEnoughPlayers(4, state.playerCount),
  NOT_IN_LOBBY: () => uz.lobby.startReasonNotInLobby,
};

interface PlayerTileProps {
  player: RoomPlayerSummary;
  isMe: boolean;
}

function PlayerTile({ player, isMe }: PlayerTileProps) {
  return (
    <div className="rm-lobby__tile">
      <Avatar imageUrl={player.avatarUrl} name={player.displayName} ring={player.isHost ? 'host' : isMe ? 'you' : 'none'} />
      <span className="rm-lobby__tile-name">
        {player.displayName}
        {isMe && <span className="rm-lobby__tile-you"> ({uz.lobby.you})</span>}
      </span>
      <div className="rm-lobby__tile-badges">
        {player.isHost && <Badge variant="host">{uz.lobby.host}</Badge>}
        <Badge variant={player.isReady ? 'ready' : 'neutral'}>{player.isReady ? uz.lobby.ready : uz.lobby.notReady}</Badge>
      </div>
    </div>
  );
}

function EmptySlotTile() {
  return (
    <div className="rm-lobby__tile rm-lobby__tile--empty">
      <span className="rm-lobby__empty-avatar" aria-hidden="true" />
      <span className="rm-lobby__tile-name rm-lobby__tile-name--empty">{uz.lobby.emptySlot}</span>
    </div>
  );
}

/**
 * Lobby screen (F2.1, redesigned F7a) — renders the real roster from
 * `lobbyStore.players` (backend commit 769618e / OD-055). `myIsReady`/
 * `myIsHost` (and therefore the Ready toggle label and Start button's
 * gate) are derived entirely from the roster entry matching `myPlayerId`,
 * refreshed on every lobby realtime event via a debounced snapshot
 * refetch — see `lobbyStore.ts`. `App.tsx` swaps this screen out for
 * `GameStartedScreen` once `currentPhase` leaves `LOBBY`.
 */
function LobbyScreen() {
  const socketStatus = useSocketStore((s) => s.status);
  const lobby = useLobbyStore();

  const [readyBusy, setReadyBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Task requirement: "On every socket (re)connect, refetch the snapshot" —
  // `socketClient.ts`'s own `connect` handler already does this
  // unconditionally when a lobby is active (no event-replay on the
  // backend), so this effect only covers first mount (in case the socket
  // was already connected before this screen rendered, e.g. coming back
  // from the started-game placeholder).
  useEffect(() => {
    void lobby.refetchSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleReady = async () => {
    if (!lobby.roomId) return;
    setReadyBusy(true);
    setActionError(null);
    try {
      await setReady(lobby.roomId, !lobby.myIsReady);
      // No optimistic local write — the roster (source of truth for
      // myIsReady/myIsHost) is refreshed by the PLAYER_READY_CHANGED
      // broadcast this call triggers, same as every other lobby member.
      void lobby.refetchSnapshot();
    } catch (err) {
      setActionError(describeRoomError(err));
    } finally {
      setReadyBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!lobby.roomId) return;
    setLeaveBusy(true);
    setActionError(null);
    try {
      await leaveRoom(lobby.roomId);
      disconnectSocket();
      lobby.reset();
    } catch (err) {
      setActionError(describeRoomError(err));
    } finally {
      setLeaveBusy(false);
    }
  };

  const handleStart = async () => {
    if (!lobby.roomId) return;
    setStartBusy(true);
    setActionError(null);
    try {
      await startGame(lobby.roomId);
      // No local phase write here — `PHASE_CHANGED` (broadcast to
      // everyone including the caller) is the single source of truth for
      // the transition, applied by `socketClient.ts`'s event handler.
    } catch (err) {
      setActionError(describeRoomError(err));
    } finally {
      setStartBusy(false);
    }
  };

  const handleCopyCode = async () => {
    if (!lobby.code) return;
    try {
      await navigator.clipboard.writeText(lobby.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (permissions/non-secure context) — the
      // code is still visible on screen to copy by hand.
    }
  };

  const handleShare = async () => {
    if (!lobby.code) return;
    try {
      if (navigator.share) {
        await navigator.share({ text: lobby.code });
      } else {
        await handleCopyCode();
      }
    } catch {
      // User cancelled the share sheet, or it's unavailable — the code is
      // still visible on screen either way.
    }
  };

  const gate = canStartGame({
    myIsHost: lobby.myIsHost,
    playerCount: lobby.playerCount,
    gameStatus: lobby.gameStatus,
  });

  const emptySlots = Math.max(0, (lobby.maxPlayers ?? 0) - lobby.playerCount);
  const progressPct = lobby.maxPlayers ? Math.min(100, (lobby.playerCount / lobby.maxPlayers) * 100) : 0;

  const footer = (
    <>
      {lobby.myIsHost ? (
        <>
          <Button onClick={() => void handleStart()} loading={startBusy} disabled={!gate.enabled}>
            {uz.lobby.startButton}
          </Button>
          {gate.reasonKey && (
            <p className="rm-lobby__start-reason">{START_REASON_TEXT[gate.reasonKey]({ playerCount: lobby.playerCount })}</p>
          )}
        </>
      ) : (
        <Button onClick={() => void handleToggleReady()} loading={readyBusy}>
          {lobby.myIsReady ? uz.lobby.notReadyButton : uz.lobby.readyButton}
        </Button>
      )}
      <Button variant="danger" onClick={() => void handleLeave()} loading={leaveBusy}>
        {uz.lobby.leaveButton}
      </Button>
    </>
  );

  return (
    <Screen title={uz.lobby.title} footer={footer}>
      {socketStatus === 'disconnected' && <Banner variant="warn">{uz.lobby.disconnectedBanner}</Banner>}
      {socketStatus === 'connecting' && lobby.snapshotLoading && (
        <Banner variant="warn">{uz.lobby.reconnectedRefreshing}</Banner>
      )}

      <Card>
        <span className="rm-lobby__code-label">{uz.lobby.codeLabel}</span>
        <div className="rm-lobby__code">{lobby.code ?? '—'}</div>
        <div className="rm-lobby__code-actions">
          <Button variant="secondary" fullWidth onClick={() => void handleCopyCode()}>
            {copied ? uz.lobby.copied : uz.lobby.copyCode}
          </Button>
          <Button variant="secondary" fullWidth onClick={() => void handleShare()}>
            {uz.lobby.shareLink}
          </Button>
        </div>
        <div className="rm-lobby__progress">
          <div className="rm-lobby__progress-bar">
            <div className="rm-lobby__progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="rm-lobby__progress-label">{uz.lobby.players(lobby.playerCount, lobby.maxPlayers ?? 0)}</span>
        </div>
      </Card>

      <Card>
        {lobby.players === null ? (
          <p className="rm-lobby__hint">{uz.lobby.loadingRoster}</p>
        ) : (
          <div className="rm-lobby__grid">
            {lobby.players.map((player) => (
              <PlayerTile key={player.playerId} player={player} isMe={player.playerId === lobby.myPlayerId} />
            ))}
            {Array.from({ length: emptySlots }, (_, i) => <EmptySlotTile key={i} />)}
          </div>
        )}
      </Card>

      {actionError && <Banner variant="error">{actionError}</Banner>}

      {isDevMode(window.location.search) && lobby.code && <DevBotsPanel code={lobby.code} />}
    </Screen>
  );
}

export default LobbyScreen;
