import { describe, expect, it } from 'vitest';
import { MAX_EVENT_LOG_ENTRIES, pushEventLogEntry, type SocketEventLogEntry } from './eventLog';

const entry = (name: string, receivedAt = 0): SocketEventLogEntry => ({
  name,
  payload: { name },
  receivedAt,
});

describe('pushEventLogEntry', () => {
  it('prepends the new entry — newest first', () => {
    const log = pushEventLogEntry([entry('PHASE_CHANGED')], entry('PLAYER_JOINED'));
    expect(log.map((e) => e.name)).toEqual(['PLAYER_JOINED', 'PHASE_CHANGED']);
  });

  it('starts from an empty log', () => {
    const log = pushEventLogEntry([], entry('GAME_FINISHED'));
    expect(log).toEqual([entry('GAME_FINISHED')]);
  });

  it('preserves the payload and receivedAt on the new entry', () => {
    const e = entry('MULTIPLE_DEATHS', 12345);
    const log = pushEventLogEntry([], e);
    expect(log[0]).toEqual(e);
  });

  it('does not mutate the input array', () => {
    const original = [entry('A'), entry('B')];
    const snapshot = [...original];
    pushEventLogEntry(original, entry('C'));
    expect(original).toEqual(snapshot);
  });

  it('caps the log at MAX_EVENT_LOG_ENTRIES, dropping the oldest', () => {
    const full = Array.from({ length: MAX_EVENT_LOG_ENTRIES }, (_, i) => entry(`E${i}`));
    const log = pushEventLogEntry(full, entry('NEW'));

    expect(log).toHaveLength(MAX_EVENT_LOG_ENTRIES);
    expect(log[0]?.name).toBe('NEW');
    expect(log.at(-1)?.name).toBe(`E${MAX_EVENT_LOG_ENTRIES - 2}`); // oldest (E49) dropped
    expect(log.some((e) => e.name === `E${MAX_EVENT_LOG_ENTRIES - 1}`)).toBe(false);
  });

  it('never exceeds the cap across repeated pushes', () => {
    let log: SocketEventLogEntry[] = [];
    for (let i = 0; i < MAX_EVENT_LOG_ENTRIES + 20; i++) {
      log = pushEventLogEntry(log, entry(`E${i}`));
    }
    expect(log).toHaveLength(MAX_EVENT_LOG_ENTRIES);
    expect(log[0]?.name).toBe(`E${MAX_EVENT_LOG_ENTRIES + 19}`); // most recent push
  });
});
