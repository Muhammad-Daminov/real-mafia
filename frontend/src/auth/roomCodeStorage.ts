/**
 * F4.1: the active game's room code, persisted the same way
 * `gameIdStorage.ts` persists `gameId` (OD-F3-002) — `sessionStorage`, not
 * `localStorage`, not memory-only. Needed because the night/vote roster
 * read (`GET /rooms/:code`) is keyed by **code**, not `gameId`, and there is
 * no `GET /rooms/by-game/:gameId` lookup to go the other way (confirmed
 * absent, same as OD-F3-002 already noted) — without this, a page reload
 * mid-game recovers `gameId` (and therefore role/phase state) but has no way
 * to recover the roster at all.
 *
 * Written only when `gameStore.setRoomCode` is called (i.e. once a game is
 * confirmed started and its room code is known from `lobbyStore`), cleared
 * on `gameStore.reset()` — same lifecycle as `gameIdStorage.ts`.
 */
const STORAGE_KEY = 'real-mafia:activeRoomCode';

export function readStoredRoomCode(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredRoomCode(code: string | null): void {
  try {
    if (code) {
      sessionStorage.setItem(STORAGE_KEY, code);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // best-effort, same degrade-to-memory-only precedent as tokenStorage.ts
  }
}
