/**
 * OD-F1-003: `sessionStorage`, not `localStorage` and not in-memory-only —
 * see frontend/docs/OPEN_DECISIONS.md for the full reasoning. Wrapped in
 * try/catch since `sessionStorage` can throw in rare cases (e.g. some
 * privacy modes disable it entirely) — a storage failure degrades to
 * "behaves like memory-only", not a crash.
 */
const STORAGE_KEY = 'real-mafia:accessToken';

export function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // best-effort — the in-memory token (api/client.ts) still works for
    // the rest of this tab's lifetime even if persistence itself fails.
  }
}
