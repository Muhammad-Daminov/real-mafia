/**
 * `VITE_API_URL` is required — there is no sane default backend origin.
 * Resolved lazily (not thrown at module import time) so a missing/misconfigured
 * env surfaces as a normal error through the same auth-store error path the
 * debug screen already renders, instead of a separate blank-screen crash.
 */
export function requireApiUrl(): string {
  const raw = import.meta.env.VITE_API_URL;

  if (!raw) {
    throw new Error(
      'VITE_API_URL is not set. Copy .env.example to .env and point it at the backend origin.',
    );
  }

  return raw.replace(/\/+$/, '');
}

/**
 * The backend origin's host only (e.g. `api.example.com`) — for the debug
 * screen's env-visibility panel. Never throws: an unset/malformed
 * `VITE_API_URL` renders as `'—'` there rather than crashing the screen
 * that exists specifically to diagnose a misconfigured env.
 */
export function apiUrlHost(): string {
  try {
    return new URL(requireApiUrl()).host;
  } catch {
    return '—';
  }
}
