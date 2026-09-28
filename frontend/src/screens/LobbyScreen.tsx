import { useEffect, useState } from 'react';
import { uz } from '../messages/uz';
import { useSocketStore } from '../store/socketStore';
import { canStartGame, useLobbyStore } from '../store/lobbyStore';
import { disconnectSocket } from '../socket/socketClient';
import { leaveRoom, setReady, startGame, type RoomPlayerSummary } from '../api/rooms';
import { describeRoomError } from '../errors/roomErrorMessages';

const START_REASON_TEXT: Record<NonNullable<ReturnType<typeof canStartGame>['reasonKey']>, (state: {
  playerCount: number;
}) => string> = {
  NOT_HOST: () => uz.lobby.startReasonNotHost,
  NOT_ENOUGH_PLAYERS: (state) =>
    uz.lobby.startReasonNotEnoughPlayers(4, state.playerCount),
  NOT_IN_LOBBY: () => uz.lobby.startReasonNotInLobby,
};

interface PlayerRowProps {
  player: RoomPlayerSummary;
  isMe: boolean;
}

function PlayerRow({ player, isMe }: PlayerRowProps) {
  return (
    <div className="mafia-player-row">
      {player.avatarUrl ? (
        <img className="mafia-avatar" src={player.avatarUrl} alt="" width={36} height={36} />
      ) : (
        <div className="mafia-avatar">{player.displayName.slice(0, 1).toUpperCase()}</div>
      )}
      <div style={{ flex: 1, textAlign: 'left' }}>
        <div>
          {player.displayName}
          {isMe && <span className="mafia-hint" style={{ marginLeft: 6 }}>({uz.lobby.you})</span>}
          {player.isHost && (
            <span className="mafia-badge" style={{ marginLeft: 6 }}>
              {uz.lobby.host}
            </span>
          )}
        </div>
      </div>
      <span className={`mafia-badge ${player.isReady ? 'mafia-badge--ready' : ''}`}>
        {player.isReady ? uz.lobby.ready : uz.lobby.notReady}
      </span>
    </div>
  );
}

/**
 * Lobby screen (F2.1) — renders the real roster from `lobbyStore.players`
 * (backend commit 769618e / OD-055). `myIsReady`/`myIsHost` (and therefore
 * the Ready toggle label and Start button's gate) are derived entirely from
 * the roster entry matching `myPlayerId`, refreshed on every lobby realtime
 * event via a debounced snapshot refetch — see `lobbyStore.ts`. `App.tsx`
 * swaps this screen out for `GameStartedScreen` once `currentPhase` leaves
 * `LOBBY`.
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

  const gate = canStartGame({
    myIsHost: lobby.myIsHost,
    playerCount: lobby.playerCount,
    gameStatus: lobby.gameStatus,
  });

  return (
    <div className="mafia-screen">
      <h1>{uz.lobby.title}</h1>

      {socketStatus === 'disconnected' && (
        <p className="mafia-banner mafia-banner--warn">{uz.lobby.disconnectedBanner}</p>
      )}
      {socketStatus === 'connecting' && lobby.snapshotLoading && (
        <p className="mafia-banner mafia-banner--warn">{uz.lobby.reconnectedRefreshing}</p>
      )}

      <div className="mafia-card">
        <span className="mafia-hint">{uz.lobby.codeLabel}</span>
        <div className="mafia-code">
          <span>{lobby.code ?? '—'}</span>
          <button className="mafia-button mafia-button--secondary" onClick={() => void handleCopyCode()}>
            {copied ? uz.lobby.copied : uz.lobby.copyCode}
          </button>
        </div>
        <p className="mafia-hint">{uz.lobby.players(lobby.playerCount, lobby.maxPlayers ?? 0)}</p>
      </div>

      <div className="mafia-card">
        {lobby.players === null ? (
          <p className="mafia-hint">{uz.lobby.loadingRoster}</p>
        ) : (
          lobby.players.map((player) => (
            <PlayerRow key={player.playerId} player={player} isMe={player.playerId === lobby.myPlayerId} />
          ))
        )}
      </div>

      <div className="mafia-row">
        <button className="mafia-button mafia-button--secondary" onClick={() => void handleToggleReady()} disabled={readyBusy}>
          {readyBusy ? '…' : lobby.myIsReady ? uz.lobby.notReadyButton : uz.lobby.readyButton}
        </button>
        <button className="mafia-button mafia-button--secondary" onClick={() => void handleLeave()} disabled={leaveBusy}>
          {leaveBusy ? uz.lobby.leaving : uz.lobby.leaveButton}
        </button>
      </div>

      {lobby.myIsHost && (
        <div>
          <button className="mafia-button" onClick={() => void handleStart()} disabled={!gate.enabled || startBusy}>
            {startBusy ? uz.lobby.starting : uz.lobby.startButton}
          </button>
          {gate.reasonKey && (
            <p className="mafia-hint">{START_REASON_TEXT[gate.reasonKey]({ playerCount: lobby.playerCount })}</p>
          )}
        </div>
      )}

      {actionError && <p className="mafia-banner mafia-banner--error">{actionError}</p>}
    </div>
  );
}

export default LobbyScreen;
