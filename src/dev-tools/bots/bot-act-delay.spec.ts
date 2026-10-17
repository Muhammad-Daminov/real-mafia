import { randomBotActDelayMs } from './bot-act-delay';

describe('randomBotActDelayMs', () => {
  it('returns a value in [1000, 4000] when there is no endsAt', () => {
    for (let i = 0; i < 30; i++) {
      const delay = randomBotActDelayMs(null);
      expect(delay).not.toBeNull();
      expect(delay!).toBeGreaterThanOrEqual(1000);
      expect(delay!).toBeLessThanOrEqual(4000);
    }
  });

  it('caps the delay so it always lands before endsAt, with a safety margin', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const endsAt = new Date(now.getTime() + 2000); // only 2s of runway
    for (let i = 0; i < 30; i++) {
      const delay = randomBotActDelayMs(endsAt, now);
      expect(delay).not.toBeNull();
      // 2000ms runway - 1000ms safety margin = at most 1000ms.
      expect(delay!).toBeLessThanOrEqual(1000);
      expect(delay!).toBeGreaterThan(0);
    }
  });

  it('returns null when there is no runway left at all', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const endsAt = new Date(now.getTime() + 500); // less than the safety margin
    expect(randomBotActDelayMs(endsAt, now)).toBeNull();
  });

  it('returns null when endsAt is already in the past', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const endsAt = new Date(now.getTime() - 1000);
    expect(randomBotActDelayMs(endsAt, now)).toBeNull();
  });
});
