import { describe, expect, it } from 'vitest';
import { computeDeathDiff } from './deathDiff';
import type { RoomPlayerSummary } from '../api/rooms';

function player(id: string, lifeStatus: RoomPlayerSummary['lifeStatus']): RoomPlayerSummary {
  return { playerId: id, displayName: id, avatarUrl: null, isReady: true, isHost: false, joinedAt: 't', lifeStatus };
}

describe('computeDeathDiff', () => {
  it('returns null when there is no previous roster to diff against (first-ever fetch)', () => {
    expect(computeDeathDiff(null, [player('p1', 'ALIVE')], 'NIGHT')).toBeNull();
  });

  it('returns null when nothing changed', () => {
    const before = [player('p1', 'ALIVE'), player('p2', 'ALIVE')];
    const after = [player('p1', 'ALIVE'), player('p2', 'ALIVE')];
    expect(computeDeathDiff(before, after, 'NIGHT')).toBeNull();
  });

  it('finds a single newly-dead player, tagged NIGHT', () => {
    const before = [player('p1', 'ALIVE'), player('p2', 'ALIVE')];
    const after = [player('p1', 'ALIVE'), player('p2', 'DEAD')];
    expect(computeDeathDiff(before, after, 'NIGHT')).toEqual({ playerIds: ['p2'], context: 'NIGHT' });
  });

  it('finds a newly-dead player tagged VOTE when the transition left VOTING', () => {
    const before = [player('p1', 'ALIVE'), player('p2', 'ALIVE')];
    const after = [player('p1', 'DEAD'), player('p2', 'ALIVE')];
    expect(computeDeathDiff(before, after, 'VOTING')).toEqual({ playerIds: ['p1'], context: 'VOTE' });
  });

  it('tags null context when the transition is neither NIGHT nor VOTING (e.g. a reconnect refetch)', () => {
    const before = [player('p1', 'ALIVE')];
    const after = [player('p1', 'DEAD')];
    expect(computeDeathDiff(before, after, null)).toEqual({ playerIds: ['p1'], context: null });
  });

  it('finds more than one newly-dead player (multi-death night)', () => {
    const before = [player('p1', 'ALIVE'), player('p2', 'ALIVE'), player('p3', 'ALIVE')];
    const after = [player('p1', 'DEAD'), player('p2', 'DEAD'), player('p3', 'ALIVE')];
    const diff = computeDeathDiff(before, after, 'NIGHT')!;
    expect(diff.playerIds.sort()).toEqual(['p1', 'p2']);
  });

  it('never reports a player who was already dead in the previous snapshot', () => {
    const before = [player('p1', 'DEAD'), player('p2', 'ALIVE')];
    const after = [player('p1', 'DEAD'), player('p2', 'DEAD')];
    expect(computeDeathDiff(before, after, 'NIGHT')).toEqual({ playerIds: ['p2'], context: 'NIGHT' });
  });
});
