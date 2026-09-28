/**
 * One entry per Socket.IO event received on the `/game` namespace, used by
 * the debug screen to prove realtime delivery (`PHASE_CHANGED`,
 * `PLAYER_JOINED`, etc. — see ../../../src/common/realtime/realtime-event.service.ts
 * for the full catalog this is meant to surface, whichever of them actually
 * fire in a given session).
 */
export interface SocketEventLogEntry {
  name: string;
  payload: unknown;
  receivedAt: number;
}

export const MAX_EVENT_LOG_ENTRIES = 50;

/**
 * Pure reducer: prepends the new entry (newest first) and caps the list at
 * `MAX_EVENT_LOG_ENTRIES`, dropping the oldest. Kept separate from the
 * zustand store so cap/ordering behavior is directly unit-testable without
 * touching store plumbing.
 */
export function pushEventLogEntry(
  log: SocketEventLogEntry[],
  entry: SocketEventLogEntry,
): SocketEventLogEntry[] {
  return [entry, ...log].slice(0, MAX_EVENT_LOG_ENTRIES);
}
