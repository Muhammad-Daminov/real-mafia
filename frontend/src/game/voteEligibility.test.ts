import { describe, expect, it } from 'vitest';
import { evaluateVoteTarget } from './voteEligibility';

describe('evaluateVoteTarget', () => {
  it('is eligible for an alive non-self player', () => {
    expect(evaluateVoteTarget({ playerId: 'other', alive: true })).toEqual({ eligible: true, reason: null });
  });

  it('is eligible for self, when alive — OD-045 explicitly allows self-vote', () => {
    expect(evaluateVoteTarget({ playerId: 'me', alive: true })).toEqual({ eligible: true, reason: null });
  });

  it('is ineligible for a dead player, self or not', () => {
    expect(evaluateVoteTarget({ playerId: 'other', alive: false })).toEqual({ eligible: false, reason: 'DEAD' });
    expect(evaluateVoteTarget({ playerId: 'me', alive: false })).toEqual({ eligible: false, reason: 'DEAD' });
  });
});
