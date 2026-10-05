/**
 * F3/OD-F3-001: the active in-game `gameId`, persisted the same way
 * OD-F1-003 persists the JWT — `sessionStorage`, not `localStorage`, not
 * memory-only. Without this, a page reload mid-game has no way to recover
 * which game the player was in at all (`lobbyStore` carries `gameId` but is
 * never persisted — a reload loses it along with `roomId`/`code`). This is
 * a client-only addition; the backend was not modified (task constraint) —
 * see OD-F3-001 for the cross-device/new-tab limitation this does not
 * solve (no backend "my active game" lookup exists to fall back to).
 *
 * Written only once a game is confirmed genuinely active (`gameStore`'s
 * own successful `initGame`, not speculatively) and cleared on a definitive
 * "not a member" (404) response or an explicit return to Home — never on a
 * transient/network failure, so a reload during a brief connectivity blip
 * doesn't lose the ability to retry.
 */
const STORAGE_KEY = 'real-mafia:activeGameId';

export function readStoredGameId(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredGameId(gameId: string | null): void {
  try {
    if (gameId) {
      sessionStorage.setItem(STORAGE_KEY, gameId);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // best-effort, same degrade-to-memory-only precedent as tokenStorage.ts
  }
}
