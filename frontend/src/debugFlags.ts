/**
 * Query-flag helpers shared by `App.tsx` (`?debug=1` routing) and
 * `LobbyScreen.tsx` (`?dev=1` dev-bots-panel gate). Previously each had its
 * own inline/duplicated `new URLSearchParams(...).get(...) === '1'` check
 * (`App.tsx`'s own `isDebug` constant, `LobbyScreen.tsx`'s `isDebugMode`) —
 * consolidated here into one low-level `hasQueryFlag` both build on.
 *
 * The two flags are deliberately independent and serve different purposes:
 * `?debug=1` routes the whole app to the old standalone `DebugScreen`
 * (F1/F1.5/F1.6), so the normal Home/Lobby/Game screens — and therefore the
 * dev-bots panel inside Lobby — are never reachable while it's set.
 * `?dev=1` leaves normal routing alone and only gates the dev-bots panel.
 */
function hasQueryFlag(search: string, flag: string): boolean {
  return new URLSearchParams(search).get(flag) === '1';
}

/** `?debug=1` -> the old standalone debug screen (`App.tsx`). Same
 * behavior as before this consolidation. */
export function isDebugMode(search: string): boolean {
  return hasQueryFlag(search, 'debug');
}

const DEV_MODE_STORAGE_KEY = 'real-mafia:devMode';

/**
 * Call once, at app start (`App.tsx`) — if the URL has `?dev=1`, remembers
 * it in `sessionStorage` for the rest of this session, so later in-app
 * navigation (which drops the query string entirely — this app has no
 * router) still shows dev-only UI. A no-op when `?dev=1` isn't present;
 * never clears an already-persisted flag (there is no `?dev=0` "turn it
 * back off" case in scope here).
 */
export function persistDevModeFromUrl(search: string): void {
  if (!hasQueryFlag(search, 'dev')) return;
  try {
    sessionStorage.setItem(DEV_MODE_STORAGE_KEY, '1');
  } catch {
    // best-effort — dev tooling, not a critical path.
  }
}

/**
 * The dev-bots panel's actual visibility gate (`LobbyScreen.tsx`): true if
 * `?dev=1` is in the current URL, or was persisted earlier this session via
 * `persistDevModeFromUrl`. Independent of `isDebugMode`/`?debug=1`.
 */
export function isDevMode(search: string): boolean {
  if (hasQueryFlag(search, 'dev')) return true;
  try {
    return sessionStorage.getItem(DEV_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
