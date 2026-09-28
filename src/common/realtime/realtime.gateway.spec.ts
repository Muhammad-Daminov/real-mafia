import 'dotenv/config';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { RealtimeModule } from './realtime.module';
import { RealtimeEventService } from './realtime-event.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * §20/OD-047: connection-time auth and room scoping, against a real
 * Socket.IO server/client pair (not a mocked gateway) — the auth/scoping
 * guarantees this slice exists for are exactly the things a mock would paper
 * over.
 */
describe('RealtimeGateway (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let realtime: RealtimeEventService;
  let baseUrl: string;

  const TEST_TELEGRAM_PREFIX = 'realtime-gateway-test-';
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

  const makeGameWithPlayer = async (userId: string) => {
    const host = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const room = await prisma.room.create({
      data: { code: randomUUID().slice(0, 6).toUpperCase(), maxPlayers: 10, creatorUserId: host.id },
    });
    createdRoomIds.push(room.id);

    const game = await prisma.game.create({ data: { roomId: room.id } });
    createdGameIds.push(game.id);

    const gamePlayer = await prisma.gamePlayer.create({ data: { gameId: game.id, userId } });

    return { game, gamePlayer };
  };

  const token = (userId: string, telegramId: string) => jwt.sign({ sub: userId, telegramId });

  const connect = (auth: Record<string, unknown>): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}/game`, { auth, transports: ['websocket'], forceNew: true });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, RealtimeModule],
    }).compile();

    app = moduleRef.createNestApplication();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    realtime = moduleRef.get(RealtimeEventService);

    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    if (createdGameIds.length) {
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

  it('accepts a connection with a valid token and a real game membership, joining the game room', async () => {
    const user = await makeUser();
    const { game } = await makeGameWithPlayer(user.id);

    const socket = await connect({ token: token(user.id, user.telegramId), gameId: game.id });
    expect(socket.connected).toBe(true);

    const received = new Promise((resolve) => socket.on('PING_TEST', resolve));
    realtime.broadcastToGame(game.id, 'PING_TEST', { ok: true });
    await expect(received).resolves.toEqual({ ok: true });

    socket.disconnect();
  });

  it('rejects a connection with an invalid token', async () => {
    const user = await makeUser();
    const { game } = await makeGameWithPlayer(user.id);

    await expect(connect({ token: 'not-a-real-jwt', gameId: game.id })).rejects.toBeDefined();
  });

  it('rejects a connection with a valid token but no gameId', async () => {
    const user = await makeUser();
    await expect(connect({ token: token(user.id, user.telegramId) })).rejects.toBeDefined();
  });

  it("rejects a connection when the token's user has no GamePlayer row for the claimed game", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const { game } = await makeGameWithPlayer(other.id); // `user` is NOT seated in this game

    await expect(connect({ token: token(user.id, user.telegramId), gameId: game.id })).rejects.toBeDefined();
  });

  it('scopes a broadcast to game:{gameId}: a socket in a different game never receives it', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const { game: gameA } = await makeGameWithPlayer(userA.id);
    const { game: gameB } = await makeGameWithPlayer(userB.id);

    const socketA = await connect({ token: token(userA.id, userA.telegramId), gameId: gameA.id });
    const socketB = await connect({ token: token(userB.id, userB.telegramId), gameId: gameB.id });

    const receivedByA: unknown[] = [];
    const receivedByB: unknown[] = [];
    socketA.on('SCOPE_TEST', (payload) => receivedByA.push(payload));
    socketB.on('SCOPE_TEST', (payload) => receivedByB.push(payload));

    realtime.broadcastToGame(gameA.id, 'SCOPE_TEST', { for: 'gameA' });

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(receivedByA).toEqual([{ for: 'gameA' }]);
    expect(receivedByB).toEqual([]);

    socketA.disconnect();
    socketB.disconnect();
  });

  it('scopes a private event to game:{gameId}:player:{playerId}: another player in the same game never receives it', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const { game, gamePlayer: playerA } = await makeGameWithPlayer(userA.id);
    await prisma.gamePlayer.create({ data: { gameId: game.id, userId: userB.id } });

    const socketA = await connect({ token: token(userA.id, userA.telegramId), gameId: game.id });
    const socketB = await connect({ token: token(userB.id, userB.telegramId), gameId: game.id });

    const receivedByA: unknown[] = [];
    const receivedByB: unknown[] = [];
    socketA.on('PRIVATE_TEST', (payload) => receivedByA.push(payload));
    socketB.on('PRIVATE_TEST', (payload) => receivedByB.push(payload));

    realtime.sendToPlayer(game.id, playerA.id, 'PRIVATE_TEST', { secret: 42 });

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(receivedByA).toEqual([{ secret: 42 }]);
    expect(receivedByB).toEqual([]);

    socketA.disconnect();
    socketB.disconnect();
  });
});
