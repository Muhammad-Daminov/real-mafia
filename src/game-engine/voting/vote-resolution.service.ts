import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GameLifecycleService } from '../game-lifecycle.service';
import { resolveVotes } from './vote-resolution';

export interface ResolveVotingRoundInput {
  gameId: string;
  /** id of the VOTING `GamePhase` row whose ballots are being resolved (already closed by the caller). */
  votingPhaseId: string;
}

export interface ResolveVotingRoundResult {
  executionOccurred: boolean;
}

/**
 * §16/§10.4: the I/O shell around `resolveVotes`'s pure tie-break decision.
 * Reads the round's `GameVote` rows, applies OD-018's plurality-with-tie
 * rule, and — if an execution occurs — applies the death immediately via
 * `GameLifecycleService.applyDeaths`, the same shared method
 * `NightResolutionService` uses.
 *
 * §10.4 is explicit that a player entering `LAST_WORD` already has
 * `life_status = DEAD` — the death is applied here, at `VOTE_RESOLUTION`,
 * before any `LAST_WORD`/`EXECUTION` transition, exactly mirroring how
 * `NightResolutionService` applies night deaths while closing `NIGHT` before
 * any night-side `LAST_WORD`. `EXECUTION` (the later transient phase) is a
 * pure pass-through in the phase graph — the death already happened by the
 * time it's reached — so no further write happens there.
 *
 * Always called from within `PhaseTransitionService.advancePhase`'s existing
 * `games` row lock/transaction — takes no lock of its own.
 */
@Injectable()
export class VoteResolutionService {
  constructor(private readonly gameLifecycle: GameLifecycleService) {}

  async resolveRound(
    tx: Prisma.TransactionClient,
    input: ResolveVotingRoundInput,
  ): Promise<ResolveVotingRoundResult> {
    const voteRows = await tx.gameVote.findMany({
      where: { gameId: input.gameId, phaseId: input.votingPhaseId },
    });

    const outcome = resolveVotes(
      voteRows.map((v) => ({ voterPlayerId: v.voterPlayerId, targetPlayerId: v.targetPlayerId })),
    );

    if (outcome.executionTarget !== null) {
      await this.gameLifecycle.applyDeaths(tx, input.gameId, [outcome.executionTarget]);
    }

    return { executionOccurred: outcome.executionTarget !== null };
  }
}
