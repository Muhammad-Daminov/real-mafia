import { useLobbyStore } from '../store/lobbyStore';
import { useGameStore } from '../store/gameStore';
import { disconnectSocket } from '../socket/socketClient';

/**
 * Disconnects the socket and resets both `lobbyStore` and `gameStore` —
 * `gameStore.reset()`/`lobbyStore.reset()` already clear every in-game
 * field (gameId, roomCode, role, roster, vote, result, everything) and
 * their `sessionStorage` persistence, so this leaves zero leftover state:
 * a new room can be created immediately afterward. Shared by every
 * "back to Home" button in the game-started flow (`GameStartedScreen`'s
 * generic fallback, `GameEndScreen`'s "Bosh sahifa") rather than
 * duplicating the same three lines in each.
 */
export function returnHome(): void {
  disconnectSocket();
  useLobbyStore.getState().reset();
  useGameStore.getState().reset();
}
