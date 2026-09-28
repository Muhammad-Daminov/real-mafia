import { Injectable } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Thin emit facade (§20) — every consumer (game-engine, later rooms/chat)
 * calls `broadcastToGame`/`sendToPlayer` instead of reaching into
 * Socket.IO/the gateway directly, so the transport stays swappable and the
 * call sites in domain services stay one line each.
 *
 * MUST be called only after the underlying write has committed — see
 * `PhaseTransitionService.advancePhase`'s docstring for why (a `$transaction`
 * callback that later rolls back must never have already fired an event).
 * This service has no way to enforce that itself (it doesn't see
 * transactions); it is a plain fire-and-forget emit, so "post-commit only"
 * is a discipline each call site owns, the same way every other §10.3
 * restricted-write caller already owns holding the right lock.
 */
@Injectable()
export class RealtimeEventService {
  constructor(private readonly gateway: RealtimeGateway) {}

  broadcastToGame(gameId: string, event: string, payload: unknown): void {
    this.gateway.server?.to(`game:${gameId}`).emit(event, payload);
  }

  sendToPlayer(gameId: string, playerId: string, event: string, payload: unknown): void {
    this.gateway.server?.to(`game:${gameId}:player:${playerId}`).emit(event, payload);
  }
}
