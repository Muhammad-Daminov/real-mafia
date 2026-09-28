import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommandRequestService } from '../../common/command-requests/command-request.service';
import { RealtimeEventService } from '../../common/realtime/realtime-event.service';
import { VoteErrorCode, VoteException } from './vote.errors';

const ENDPOINT_CAST_VOTE = 'POST /games/:gameId/votes';

export interface CastVoteInput {
  userId: string;
  gameId: string;
  clientRequestId: string;
  targetPlayerId: string;
}

export interface CastVoteResponse {
  voteId: string;
  gameId: string;
  phaseId: string;
  voterPlayerId: string;
  targetPlayerId: string;
}

export interface VoteTallyEntry {
  voterPlayerId: string;
  targetPlayerId: string;
}

/**
 * §16/OD-018/OD-020: day-vote submission. `game_votes` is not in §10.3's
 * restricted-field list, same reasoning as `game_actions` last slice — it's
 * a brand new table, not a write to any restricted field — so this service
 * writes it directly under its own `games` row lock, no need to route
 * through `GameLifecycleService`.
 *
 * OD-020(b): changing a vote before the deadline is an UPDATE of the same
 * `(game, phase, voter)` row, not a new insert — mirrors OD-028's
 * update-in-place mechanism for night actions exactly, just without a
 * per-role slot (every voter has exactly one vote per round, no analogue to
 * Don's two-ability slot split).
 *
 * OD-020(a)/OD-047's pattern: `VOTE_CAST` is broadcast to `game:{gameId}`
 * only *after* `castVoteTransaction`'s own `$transaction` call has resolved
 * — never from inside its callback — and only for an actual write (a fresh
 * cast or a genuine change), never for either replay path (an idempotent
 * retry of the same `clientRequestId`, or `recoverReplay`'s post-collision
 * re-read of a concurrent winner's response): nothing changed on this call,
 * so nothing new to announce.
 */
@Injectable()
export class VoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandRequests: CommandRequestService,
    private readonly realtime: RealtimeEventService,
  ) {}

  async castVote(input: CastVoteInput): Promise<CastVoteResponse> {
    const key = {
      userId: input.userId,
      endpoint: ENDPOINT_CAST_VOTE,
      clientRequestId: input.clientRequestId,
    };

    try {
      const { response, isNewWrite } = await this.castVoteTransaction(input, key);

      if (isNewWrite) {
        this.realtime.broadcastToGame(input.gameId, 'VOTE_CAST', {
          voterPlayerId: response.voterPlayerId,
          targetPlayerId: response.targetPlayerId,
        });
      }

      return response;
    } catch (error) {
      const replay = await this.commandRequests.recoverReplay(this.prisma, key, error);

      if (replay) {
        return replay.body as unknown as CastVoteResponse;
      }

      throw error;
    }
  }

  private async castVoteTransaction(
    input: CastVoteInput,
    key: { userId: string; endpoint: string; clientRequestId: string },
  ): Promise<{ response: CastVoteResponse; isNewWrite: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM games WHERE id = ${input.gameId}::uuid FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new VoteException(VoteErrorCode.GAME_NOT_FOUND, 'O‘yin topilmadi');
      }

      const replay = await this.commandRequests.findExisting(tx, key);
      if (replay) {
        return { response: replay.body as unknown as CastVoteResponse, isNewWrite: false };
      }

      const game = await tx.game.findUniqueOrThrow({
        where: { id: input.gameId },
        select: { status: true, currentPhase: true },
      });

      if (game.status !== 'RUNNING' || game.currentPhase !== 'VOTING') {
        throw new VoteException(
          VoteErrorCode.GAME_NOT_IN_VOTING_PHASE,
          'Hozir ovoz berib bo‘lmaydi',
        );
      }

      const voter = await tx.gamePlayer.findUnique({
        where: { gameId_userId: { gameId: input.gameId, userId: input.userId } },
        select: { id: true, lifeStatus: true },
      });

      if (!voter) {
        throw new VoteException(VoteErrorCode.PLAYER_NOT_IN_GAME, 'Siz bu o‘yinda emassiz');
      }

      if (voter.lifeStatus !== 'ALIVE') {
        throw new VoteException(VoteErrorCode.PLAYER_NOT_ALIVE, 'O‘lik o‘yinchi ovoz bera olmaydi');
      }

      // §17.3-style IDOR-safe target lookup (OD-045: self-vote allowed, so
      // targetPlayerId === voter.id is a valid, ordinary case here).
      const target = await tx.gamePlayer.findFirst({
        where: { id: input.targetPlayerId, gameId: input.gameId },
        select: { id: true, lifeStatus: true },
      });

      if (!target) {
        throw new VoteException(VoteErrorCode.INVALID_TARGET, 'Nishon bu o‘yinda topilmadi');
      }

      if (target.lifeStatus !== 'ALIVE') {
        throw new VoteException(VoteErrorCode.INVALID_TARGET, 'Nishon tirik bo‘lishi kerak');
      }

      const activePhase = await tx.gamePhase.findFirstOrThrow({
        where: { gameId: input.gameId, endedAt: null },
      });

      const existing = await tx.gameVote.findUnique({
        where: {
          gameId_phaseId_voterPlayerId: {
            gameId: input.gameId,
            phaseId: activePhase.id,
            voterPlayerId: voter.id,
          },
        },
      });

      const saved = existing
        ? await tx.gameVote.update({
            where: { id: existing.id },
            data: { targetPlayerId: input.targetPlayerId },
          })
        : await tx.gameVote.create({
            data: {
              gameId: input.gameId,
              phaseId: activePhase.id,
              voterPlayerId: voter.id,
              targetPlayerId: input.targetPlayerId,
            },
          });

      const response: CastVoteResponse = {
        voteId: saved.id,
        gameId: input.gameId,
        phaseId: activePhase.id,
        voterPlayerId: saved.voterPlayerId,
        targetPlayerId: saved.targetPlayerId,
      };

      await this.commandRequests.record(tx, key, {
        status: 200,
        body: response as unknown as Prisma.InputJsonValue,
      });

      return { response, isNewWrite: true };
    });
  }

  /**
   * OD-020(a): votes are PUBLIC in real time — unlike night actions, this
   * returns every current-round vote, not just the requesting player's own.
   * Membership in the game is still required to call it at all (same IDOR
   * posture as every other per-game read in this codebase), but the payload
   * itself is not filtered down to the caller's own vote.
   */
  async getCurrentTally(input: { userId: string; gameId: string }): Promise<VoteTallyEntry[]> {
    const requester = await this.prisma.gamePlayer.findUnique({
      where: { gameId_userId: { gameId: input.gameId, userId: input.userId } },
      select: { id: true },
    });

    if (!requester) {
      throw new VoteException(VoteErrorCode.PLAYER_NOT_IN_GAME, 'Siz bu o‘yinda emassiz');
    }

    const activePhase = await this.prisma.gamePhase.findFirst({
      where: { gameId: input.gameId, endedAt: null },
    });

    if (!activePhase) {
      return [];
    }

    const votes = await this.prisma.gameVote.findMany({
      where: { gameId: input.gameId, phaseId: activePhase.id },
      orderBy: { updatedAt: 'asc' },
    });

    return votes.map((v) => ({ voterPlayerId: v.voterPlayerId, targetPlayerId: v.targetPlayerId }));
  }
}
