import 'dotenv/config';
import { randomUUID } from 'crypto';
import { GamePhaseName, GameStatus, LifeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommandRequestService } from '../../common/command-requests/command-request.service';
import { VoteService } from './vote.service';
import { VoteErrorCode } from './vote.errors';
import { RealtimeEventService } from '../../common/realtime/realtime-event.service';

/**
 * §16/OD-018/OD-020: `VoteService` integration tests against real Postgres,
 * same style as `night-action.service.spec.ts`.
 */
describe('VoteService (integration)', () => {
  const prisma = new PrismaService();
  const realtime: { broadcastToGame: jest.Mock; sendToPlayer: jest.Mock } = {
    broadcastToGame: jest.fn(),
    sendToPlayer: jest.fn(),
  };
  const service = new VoteService(
    prisma,
    new CommandRequestService(),
    realtime as unknown as RealtimeEventService,
  );

  const TEST_TELEGRAM_PREFIX = 'vote-service-test-';
  let createdUserIds: string[] = [];
  let createdRoomIds: string[] = [];
  let createdGameIds: string[] = [];

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: { telegramId: `${TEST_TELEGRAM_PREFIX}${randomUUID()}`, firstName: 'Test' },
    });
    createdUserIds.push(user.id);
    return user;
  };

  interface SeedPlayerSpec {
    lifeStatus?: LifeStatus;
  }

  const seedVotingGame = async (players: SeedPlayerSpec[]) => {
    const host = await makeUser();
    const room = await prisma.room.create({
      data: { code: randomUUID().slice(0, 6).toUpperCase(), maxPlayers: 10, creatorUserId: host.id },
    });
    createdRoomIds.push(room.id);

    const game = await prisma.game.create({
      data: {
        roomId: room.id,
        status: GameStatus.RUNNING,
        currentPhase: GamePhaseName.VOTING,
        round: 1,
        rulesVersion: '6.0.0',
        configSnapshot: {} as unknown as Prisma.InputJsonValue,
      },
    });
    createdGameIds.push(game.id);

    await prisma.gamePhase.create({
      data: {
        gameId: game.id,
        phase: GamePhaseName.VOTING,
        round: 1,
        startedAt: new Date(Date.now() - 5_000),
        endsAt: new Date(Date.now() + 60_000),
      },
    });

    const gamePlayers: { id: string; userId: string }[] = [];
    for (const spec of players) {
      const user = await makeUser();
      const gp = await prisma.gamePlayer.create({
        data: { gameId: game.id, userId: user.id, lifeStatus: spec.lifeStatus ?? LifeStatus.ALIVE },
      });
      gamePlayers.push({ id: gp.id, userId: user.id });
    }

    return { game, gamePlayers };
  };

  afterEach(async () => {
    realtime.broadcastToGame.mockClear();
    realtime.sendToPlayer.mockClear();
    if (createdUserIds.length) {
      await prisma.commandRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
    }
    if (createdGameIds.length) {
      await prisma.gameVote.deleteMany({ where: { gameId: { in: createdGameIds } } });
      await prisma.gamePhase.deleteMany({ where: { gameId: { in: createdGameIds } } });
      await prisma.gamePlayer.deleteMany({ where: { gameId: { in: createdGameIds } } });
      await prisma.game.deleteMany({ where: { id: { in: createdGameIds } } });
    }
    if (createdRoomIds.length) {
      await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds = [];
    createdRoomIds = [];
    createdGameIds = [];
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accepts a valid vote and persists it against the active VOTING phase', async () => {
    const { game, gamePlayers } = await seedVotingGame([{}, {}]);
    const [voter, target] = gamePlayers;

    const response = await service.castVote({
      userId: voter.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      targetPlayerId: target.id,
    });

    expect(response.targetPlayerId).toBe(target.id);
    const saved = await prisma.gameVote.findUniqueOrThrow({ where: { id: response.voteId } });
    expect(saved.voterPlayerId).toBe(voter.id);
  });

  it('rejects a vote from a dead player', async () => {
    const { game, gamePlayers } = await seedVotingGame([{ lifeStatus: LifeStatus.DEAD }, {}]);
    const [voter, target] = gamePlayers;

    await expect(
      service.castVote({
        userId: voter.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        targetPlayerId: target.id,
      }),
    ).rejects.toMatchObject({ code: VoteErrorCode.PLAYER_NOT_ALIVE });
  });

  it('rejects a vote when the game is not in VOTING phase', async () => {
    const { game, gamePlayers } = await seedVotingGame([{}, {}]);
    await prisma.game.update({ where: { id: game.id }, data: { currentPhase: GamePhaseName.DISCUSSION } });
    const [voter, target] = gamePlayers;

    await expect(
      service.castVote({
        userId: voter.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        targetPlayerId: target.id,
      }),
    ).rejects.toMatchObject({ code: VoteErrorCode.GAME_NOT_IN_VOTING_PHASE });
  });

  it('rejects voting for a target not in the game', async () => {
    const { game, gamePlayers } = await seedVotingGame([{}]);
    const [voter] = gamePlayers;

    await expect(
      service.castVote({
        userId: voter.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        targetPlayerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: VoteErrorCode.INVALID_TARGET });
  });

  it('rejects voting for a dead target', async () => {
    const { game, gamePlayers } = await seedVotingGame([{}, { lifeStatus: LifeStatus.DEAD }]);
    const [voter, deadTarget] = gamePlayers;

    await expect(
      service.castVote({
        userId: voter.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        targetPlayerId: deadTarget.id,
      }),
    ).rejects.toMatchObject({ code: VoteErrorCode.INVALID_TARGET });
  });

  it('allows self-voting (OD-045)', async () => {
    const { game, gamePlayers } = await seedVotingGame([{}]);
    const [voter] = gamePlayers;

    const response = await service.castVote({
      userId: voter.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      targetPlayerId: voter.id,
    });

    expect(response.targetPlayerId).toBe(voter.id);
  });

  it('changing a vote updates the existing row in place (OD-020b)', async () => {
    const { game, gamePlayers } = await seedVotingGame([{}, {}, {}]);
    const [voter, firstTarget, secondTarget] = gamePlayers;

    const first = await service.castVote({
      userId: voter.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      targetPlayerId: firstTarget.id,
    });

    const second = await service.castVote({
      userId: voter.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      targetPlayerId: secondTarget.id,
    });

    expect(second.voteId).toBe(first.voteId);
    expect(second.targetPlayerId).toBe(secondTarget.id);

    const rows = await prisma.gameVote.findMany({ where: { gameId: game.id, voterPlayerId: voter.id } });
    expect(rows).toHaveLength(1);
  });

  it('replays an identical retried clientRequestId instead of double-casting', async () => {
    const { game, gamePlayers } = await seedVotingGame([{}, {}]);
    const [voter, target] = gamePlayers;
    const clientRequestId = randomUUID();

    const first = await service.castVote({
      userId: voter.userId,
      gameId: game.id,
      clientRequestId,
      targetPlayerId: target.id,
    });
    const replay = await service.castVote({
      userId: voter.userId,
      gameId: game.id,
      clientRequestId,
      targetPlayerId: target.id,
    });

    expect(replay).toEqual(first);
    const rows = await prisma.gameVote.findMany({ where: { gameId: game.id, voterPlayerId: voter.id } });
    expect(rows).toHaveLength(1);
  });

  it('two concurrent votes from different voters do not corrupt the round vote set', async () => {
    const { game, gamePlayers } = await seedVotingGame([{}, {}, {}]);
    const [voterA, voterB, target] = gamePlayers;

    await Promise.all([
      service.castVote({
        userId: voterA.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        targetPlayerId: target.id,
      }),
      service.castVote({
        userId: voterB.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        targetPlayerId: target.id,
      }),
    ]);

    const rows = await prisma.gameVote.findMany({ where: { gameId: game.id } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.voterPlayerId))).toEqual(new Set([voterA.id, voterB.id]));
  });

  it('getCurrentTally is public: it returns every current-round vote, not just the caller\'s own (OD-020a)', async () => {
    const { game, gamePlayers } = await seedVotingGame([{}, {}, {}]);
    const [voterA, voterB, target] = gamePlayers;

    await service.castVote({
      userId: voterA.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      targetPlayerId: target.id,
    });
    await service.castVote({
      userId: voterB.userId,
      gameId: game.id,
      clientRequestId: randomUUID(),
      targetPlayerId: target.id,
    });

    const tally = await service.getCurrentTally({ userId: voterA.userId, gameId: game.id });
    expect(tally).toHaveLength(2);
    expect(new Set(tally.map((t) => t.voterPlayerId))).toEqual(new Set([voterA.id, voterB.id]));
  });

  describe('VOTE_CAST realtime delivery (OD-020a/OD-047)', () => {
    it('broadcasts VOTE_CAST to the game after a fresh cast commits', async () => {
      const { game, gamePlayers } = await seedVotingGame([{}, {}]);
      const [voter, target] = gamePlayers;

      await service.castVote({
        userId: voter.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        targetPlayerId: target.id,
      });

      expect(realtime.broadcastToGame).toHaveBeenCalledWith(game.id, 'VOTE_CAST', {
        voterPlayerId: voter.id,
        targetPlayerId: target.id,
      });
    });

    it('broadcasts VOTE_CAST again when the vote changes (OD-020b)', async () => {
      const { game, gamePlayers } = await seedVotingGame([{}, {}, {}]);
      const [voter, firstTarget, secondTarget] = gamePlayers;

      await service.castVote({
        userId: voter.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        targetPlayerId: firstTarget.id,
      });
      await service.castVote({
        userId: voter.userId,
        gameId: game.id,
        clientRequestId: randomUUID(),
        targetPlayerId: secondTarget.id,
      });

      expect(realtime.broadcastToGame).toHaveBeenNthCalledWith(1, game.id, 'VOTE_CAST', {
        voterPlayerId: voter.id,
        targetPlayerId: firstTarget.id,
      });
      expect(realtime.broadcastToGame).toHaveBeenNthCalledWith(2, game.id, 'VOTE_CAST', {
        voterPlayerId: voter.id,
        targetPlayerId: secondTarget.id,
      });
    });

    it('does not broadcast VOTE_CAST on an idempotent replay of the same clientRequestId', async () => {
      const { game, gamePlayers } = await seedVotingGame([{}, {}]);
      const [voter, target] = gamePlayers;
      const clientRequestId = randomUUID();

      await service.castVote({ userId: voter.userId, gameId: game.id, clientRequestId, targetPlayerId: target.id });
      await service.castVote({ userId: voter.userId, gameId: game.id, clientRequestId, targetPlayerId: target.id });

      expect(realtime.broadcastToGame).toHaveBeenCalledTimes(1);
    });

    it('fires no VOTE_CAST when the transaction rolls back, even though the vote row was already written', async () => {
      const brokenCommandRequests = {
        findExisting: jest.fn().mockResolvedValue(null),
        record: jest.fn().mockRejectedValue(new Error('simulated failure after write')),
        recoverReplay: jest.fn().mockResolvedValue(null),
      } as unknown as CommandRequestService;

      const brokenService = new VoteService(
        prisma,
        brokenCommandRequests,
        realtime as unknown as RealtimeEventService,
      );

      const { game, gamePlayers } = await seedVotingGame([{}, {}]);
      const [voter, target] = gamePlayers;

      await expect(
        brokenService.castVote({
          userId: voter.userId,
          gameId: game.id,
          clientRequestId: randomUUID(),
          targetPlayerId: target.id,
        }),
      ).rejects.toThrow('simulated failure after write');

      const rows = await prisma.gameVote.findMany({ where: { gameId: game.id, voterPlayerId: voter.id } });
      expect(rows).toHaveLength(0); // the GameVote write never survived the rollback

      expect(realtime.broadcastToGame).not.toHaveBeenCalled();
    });
  });
});
