import { describe, expect, it } from 'vitest';
import { resolveDayAnnouncement } from './dayAnnouncement';

describe('resolveDayAnnouncement (F7b)', () => {
  it('reports deaths with their context when lastDeaths is set', () => {
    expect(resolveDayAnnouncement({ playerIds: ['p1'], context: 'NIGHT' }, 'NIGHT')).toEqual({
      kind: 'deaths',
      context: 'NIGHT',
      playerIds: ['p1'],
    });
  });

  it('reports a quiet night when nothing died leaving NIGHT', () => {
    expect(resolveDayAnnouncement(null, 'NIGHT')).toEqual({ kind: 'quiet', context: 'NIGHT' });
  });

  it('reports a quiet vote when nothing died leaving VOTING', () => {
    expect(resolveDayAnnouncement(null, 'VOTING')).toEqual({ kind: 'quiet', context: 'VOTE' });
  });

  it('reports none when there is no death and no relevant transition (e.g. a reconnect refetch)', () => {
    expect(resolveDayAnnouncement(null, null)).toEqual({ kind: 'none' });
    expect(resolveDayAnnouncement(null, 'DISCUSSION')).toEqual({ kind: 'none' });
  });

  it('deaths take priority over a stale lastPhaseFrom', () => {
    expect(resolveDayAnnouncement({ playerIds: ['p1'], context: null }, 'DISCUSSION')).toEqual({
      kind: 'deaths',
      context: null,
      playerIds: ['p1'],
    });
  });
});
