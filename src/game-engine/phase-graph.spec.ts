import { GamePhaseName } from '@prisma/client';
import { computeNextPhase, isTransientPhase, TRANSIENT_PHASES } from './phase-graph';

const trivialCtx = {
  lastWordEnabled: true,
  deathsOccurred: false,
  executionOccurred: false,
  triggeredByVote: false,
  hasWinner: false,
};

describe('phase-graph (§10.2 pure state machine)', () => {
  it('classifies exactly the four transient phases named in §10.1', () => {
    expect([...TRANSIENT_PHASES].sort()).toEqual(
      [
        GamePhaseName.NIGHT_RESOLUTION,
        GamePhaseName.VOTE_RESOLUTION,
        GamePhaseName.EXECUTION,
        GamePhaseName.WIN_CHECK,
      ].sort(),
    );
    expect(isTransientPhase(GamePhaseName.NIGHT)).toBe(false);
    expect(isTransientPhase(GamePhaseName.WIN_CHECK)).toBe(true);
  });

  it('ROLE_REVEAL -> NIGHT, incrementing round (OD-042)', () => {
    expect(computeNextPhase(GamePhaseName.ROLE_REVEAL, trivialCtx)).toEqual({
      phase: GamePhaseName.NIGHT,
      incrementsRound: true,
    });
  });

  it('walks the entire "nothing happened this round" cycle back to a new NIGHT', () => {
    // This is the only cycle reachable today: night-action resolution,
    // vote-counting, and the win evaluator (which alone could produce
    // deathsOccurred/executionOccurred/hasWinner=true) are separate,
    // out-of-scope-for-this-slice systems.
    const path: GamePhaseName[] = [
      GamePhaseName.NIGHT,
      GamePhaseName.NIGHT_RESOLUTION,
      GamePhaseName.MORNING,
      GamePhaseName.DISCUSSION,
      GamePhaseName.VOTING,
      GamePhaseName.VOTE_RESOLUTION,
      GamePhaseName.WIN_CHECK,
    ];

    let current = path[0];
    for (const expectedNext of path.slice(1)) {
      const next = computeNextPhase(current, trivialCtx);
      expect(next.phase).toBe(expectedNext);
      expect(next.incrementsRound).toBe(false);
      current = next.phase;
    }

    const backToNight = computeNextPhase(current, trivialCtx);
    expect(backToNight).toEqual({ phase: GamePhaseName.NIGHT, incrementsRound: true });
  });

  it('NIGHT_RESOLUTION routes to LAST_WORD only when deaths occurred and lastWordEnabled', () => {
    expect(
      computeNextPhase(GamePhaseName.NIGHT_RESOLUTION, {
        ...trivialCtx,
        deathsOccurred: true,
        lastWordEnabled: true,
      }).phase,
    ).toBe(GamePhaseName.LAST_WORD);

    expect(
      computeNextPhase(GamePhaseName.NIGHT_RESOLUTION, {
        ...trivialCtx,
        deathsOccurred: true,
        lastWordEnabled: false,
      }).phase,
    ).toBe(GamePhaseName.MORNING);

    expect(
      computeNextPhase(GamePhaseName.NIGHT_RESOLUTION, {
        ...trivialCtx,
        deathsOccurred: false,
        lastWordEnabled: true,
      }).phase,
    ).toBe(GamePhaseName.MORNING);
  });

  it('NIGHT_RESOLUTION -> GAME_OVER when a winner is already determined', () => {
    expect(
      computeNextPhase(GamePhaseName.NIGHT_RESOLUTION, { ...trivialCtx, hasWinner: true }).phase,
    ).toBe(GamePhaseName.GAME_OVER);
  });

  it('LAST_WORD routes to EXECUTION only when triggered by a vote, else MORNING', () => {
    expect(
      computeNextPhase(GamePhaseName.LAST_WORD, { ...trivialCtx, triggeredByVote: true }).phase,
    ).toBe(GamePhaseName.EXECUTION);
    expect(
      computeNextPhase(GamePhaseName.LAST_WORD, { ...trivialCtx, triggeredByVote: false }).phase,
    ).toBe(GamePhaseName.MORNING);
  });

  it('VOTE_RESOLUTION branches on executionOccurred and lastWordEnabled', () => {
    expect(
      computeNextPhase(GamePhaseName.VOTE_RESOLUTION, {
        ...trivialCtx,
        executionOccurred: true,
        lastWordEnabled: true,
      }).phase,
    ).toBe(GamePhaseName.LAST_WORD);

    expect(
      computeNextPhase(GamePhaseName.VOTE_RESOLUTION, {
        ...trivialCtx,
        executionOccurred: true,
        lastWordEnabled: false,
      }).phase,
    ).toBe(GamePhaseName.EXECUTION);

    expect(
      computeNextPhase(GamePhaseName.VOTE_RESOLUTION, { ...trivialCtx, executionOccurred: false })
        .phase,
    ).toBe(GamePhaseName.WIN_CHECK);
  });

  it('EXECUTION -> WIN_CHECK always', () => {
    expect(computeNextPhase(GamePhaseName.EXECUTION, trivialCtx).phase).toBe(
      GamePhaseName.WIN_CHECK,
    );
  });

  it('WIN_CHECK -> GAME_OVER when there is a winner, else NIGHT with round increment', () => {
    expect(
      computeNextPhase(GamePhaseName.WIN_CHECK, { ...trivialCtx, hasWinner: true }),
    ).toEqual({ phase: GamePhaseName.GAME_OVER, incrementsRound: false });

    expect(
      computeNextPhase(GamePhaseName.WIN_CHECK, { ...trivialCtx, hasWinner: false }),
    ).toEqual({ phase: GamePhaseName.NIGHT, incrementsRound: true });
  });

  it('LOBBY and GAME_OVER have no engine-driven outgoing edge', () => {
    expect(() => computeNextPhase(GamePhaseName.LOBBY, trivialCtx)).toThrow();
    expect(() => computeNextPhase(GamePhaseName.GAME_OVER, trivialCtx)).toThrow();
  });
});
