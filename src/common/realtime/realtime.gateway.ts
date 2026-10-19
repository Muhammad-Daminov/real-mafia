import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveCorsOrigins } from '../config/cors';

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
 *
 * B-H1: `connectionsByUser` caps concurrent sockets per user (task: "e.g.
 * 5"), checked in the same auth middleware so an over-limit connection
 * never completes its handshake, same as any other auth rejection. A
 * reconnect isn't broken by this: the old socket's own `disconnect` event
 * (fired by the client's own transport closing, Socket.IO's ping-timeout
 * detecting a dead one, or the server here) decrements the count, so a
 * brief overlap during a refresh/reconnect burst is exactly what the "e.g.
 * 5" headroom (rather than 1) is for. In-memory, per-process — the same
 * single-instance limitation `common/config/throttler.ts` already notes
 * for the HTTP rate limits (see OPEN_DECISIONS.md).
 */
// `origin` reuses the same CORS_ORIGINS allow-list as the HTTP API's
// `app.enableCors` (common/config/cors.ts) — evaluated once at decoration
// time (module load), which is fine here since env vars are already set by
// the process manager before Nest ever imports this file.
@WebSocketGateway({ namespace: '/game', cors: { origin: resolveCorsOrigins() } })
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly connectionsByUser = new Map<string, number>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private maxConnectionsPerUser(): number {
    return Number(process.env.SOCKET_MAX_CONNECTIONS_PER_USER) || 5;
  }

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
    // and resolved — `client.data.gameId`/`playerId`/`userId` are always
    // set here.
    void client.join(`game:${client.data.gameId}`);
    void client.join(`game:${client.data.gameId}:player:${client.data.playerId}`);

    client.on('disconnect', () => this.releaseConnectionSlot(client.data.userId as string));
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

    if (!this.claimConnectionSlot(payload.sub)) {
      throw new Error('too many concurrent connections for this user');
    }

    try {
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
    } catch (error) {
      // The slot was claimed above on the assumption auth would succeed —
      // release it on any later failure so a rejected connection never
      // permanently consumes part of this user's cap.
      this.releaseConnectionSlot(payload.sub);
      throw error;
    }
  }

  /** `true` and increments if under the cap; `false` (no state change)
   * once at it. */
  private claimConnectionSlot(userId: string): boolean {
    const current = this.connectionsByUser.get(userId) ?? 0;
    if (current >= this.maxConnectionsPerUser()) {
      return false;
    }
    this.connectionsByUser.set(userId, current + 1);
    return true;
  }

  private releaseConnectionSlot(userId: string | undefined): void {
    if (!userId) return;
    const current = this.connectionsByUser.get(userId) ?? 0;
    if (current <= 1) {
      this.connectionsByUser.delete(userId);
    } else {
      this.connectionsByUser.set(userId, current - 1);
    }
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
