import { resolveVotes } from './vote-resolution';

describe('resolveVotes (§16/OD-018 plurality-with-tie pipeline)', () => {
  it('a clear plurality target is executed', () => {
    const outcome = resolveVotes([
      { voterPlayerId: 'a', targetPlayerId: 'x' },
      { voterPlayerId: 'b', targetPlayerId: 'x' },
      { voterPlayerId: 'c', targetPlayerId: 'y' },
    ]);
    expect(outcome.executionTarget).toBe('x');
  });

  it('a single vote for an otherwise-unvoted target wins outright (no majority threshold)', () => {
    const outcome = resolveVotes([{ voterPlayerId: 'a', targetPlayerId: 'x' }]);
    expect(outcome.executionTarget).toBe('x');
  });

  it('an exact tie for the top spot produces no execution (OD-018: no revote, no random tiebreak)', () => {
    const outcome = resolveVotes([
      { voterPlayerId: 'a', targetPlayerId: 'x' },
      { voterPlayerId: 'b', targetPlayerId: 'y' },
    ]);
    expect(outcome.executionTarget).toBeNull();
  });

  it('a three-way tie for the top spot also produces no execution', () => {
    const outcome = resolveVotes([
      { voterPlayerId: 'a', targetPlayerId: 'x' },
      { voterPlayerId: 'b', targetPlayerId: 'y' },
      { voterPlayerId: 'c', targetPlayerId: 'z' },
    ]);
    expect(outcome.executionTarget).toBeNull();
  });

  it('a tie behind a clear leader still executes the leader (only the top spot matters)', () => {
    const outcome = resolveVotes([
      { voterPlayerId: 'a', targetPlayerId: 'x' },
      { voterPlayerId: 'b', targetPlayerId: 'x' },
      { voterPlayerId: 'c', targetPlayerId: 'y' },
      { voterPlayerId: 'd', targetPlayerId: 'z' },
    ]);
    expect(outcome.executionTarget).toBe('x');
  });

  it('no votes at all produces no execution', () => {
    expect(resolveVotes([]).executionTarget).toBeNull();
  });

  it('self-votes count toward the tally like any other vote (OD-045)', () => {
    const outcome = resolveVotes([
      { voterPlayerId: 'a', targetPlayerId: 'a' },
      { voterPlayerId: 'b', targetPlayerId: 'a' },
    ]);
    expect(outcome.executionTarget).toBe('a');
  });
});
