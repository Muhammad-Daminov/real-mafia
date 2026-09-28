import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  telegramId: string;
}

/**
 * §20: "Unchanged transport and handshake from v5.0 §26.1–26.2 — Socket.IO,
 * `/game` namespace, server-side-only room joins, JWT handshake auth,
 * GamePlayer resolution before any room join." OD-047(3) makes the connect
 * protocol concrete: the client supplies both a bearer JWT
 * (`handshake.auth.token`, the same token `/auth/telegram` issues and
 * `JwtStrategy` verifies for the HTTP API — one auth scheme, not two) and a
 * `gameId` (`handshake.auth.gameId`). The server verifies the JWT, resolves
 * `GamePlayer(gameId, userId)`, and only *then* joins rooms — "server-side-
 * only" in the sense that the client never tells the server which room to
 * join directly, only which game it claims membership in; room membership
 * itself is a server decision gated on that DB resolution succeeding.
 *
 * Auth runs as Socket.IO **namespace middleware** (`server.use`), not inside
 * `handleConnection`: middleware runs *before* the Engine.IO handshake
 * completes, so a rejection (`next(error)`) surfaces to the client as a
 * `connect_error` and the connection is never established at all. Doing the
 * same check inside `handleConnection` instead would let the handshake
 * finish first (the client would briefly observe `connect`) and only then
 * get disconnected — a real behavioral difference, not just a client-visible
 * cosmetic one, so middleware is the only placement that matches "GamePlayer
 * resolution before any room join" literally (no room is ever joined for a
 * connection that never completes).
 *
 * `game:{gameId}` is the public-broadcast room (§20's naming scheme);
 * `game:{gameId}:player:{playerId}` is this player's private room. Both are
 * joined together once the middleware has already authenticated the socket —
 * this slice has no event that uses the private room yet (deferred, see
 * OPEN_DECISIONS.md OD-047), but the join happens now so a later slice's
 * `sendToPlayer` calls need no gateway change.
 */
@WebSocketGateway({ namespace: '/game', cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server): void {
    server.use((client, next) => {
      this.authenticate(client as Socket)
        .then(() => next())
        .catch((error: unknown) => {
          this.logger.debug(`rejecting socket connection: ${(error as Error).message}`);
          next(error instanceof Error ? error : new Error('unauthorized'));
        });
    });
  }

  handleConnection(client: Socket): void {
    // Reached only for a socket the middleware above already authenticated
    // and resolved — `client.data.gameId`/`playerId` are always set here.
    void client.join(`game:${client.data.gameId}`);
    void client.join(`game:${client.data.gameId}:player:${client.data.playerId}`);
  }

  private async authenticate(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    const gameId = this.extractGameId(client);

    if (!token || !gameId) {
      throw new Error('missing token or gameId');
    }

    const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
      secret: process.env.JWT_SECRET,
    });

    const player = await this.prisma.gamePlayer.findUnique({
      where: { gameId_userId: { gameId, userId: payload.sub } },
      select: { id: true },
    });

    if (!player) {
      throw new Error('not a player in this game');
    }

    client.data.userId = payload.sub;
    client.data.gameId = gameId;
    client.data.playerId = player.id;
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    if (fromAuth) return fromAuth;

    const header = client.handshake.headers?.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }

    return null;
  }

  private extractGameId(client: Socket): string | null {
    const gameId = client.handshake.auth?.gameId as string | undefined;
    return gameId ?? null;
  }
}
