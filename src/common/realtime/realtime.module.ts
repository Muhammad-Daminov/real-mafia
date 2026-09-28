import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeEventService } from './realtime-event.service';

/**
 * §20: Socket.IO realtime delivery — shared infra, not a game-engine concept,
 * the same "domain-agnostic, consumers import it, it never imports a
 * consumer" shape already established for `common/scheduling` (see that
 * module's own docstring). `game-engine` (and later `rooms`/chat) import
 * this module and call `RealtimeEventService`; this module has zero
 * knowledge of phase transitions, night actions, votes, or any other domain
 * concept — only `gameId`/`playerId`/opaque event name+payload.
 *
 * `JwtModule.register` here is a deliberate structural duplicate of
 * `AuthModule`'s own registration (same `JWT_SECRET`, same default options),
 * not a shared import — the same "duplicate the shape, don't import the
 * domain module" precedent `GameLifecycleService.PhaseDurationsSec` already
 * set to avoid `game-engine` depending on `rooms`. Importing `AuthModule`
 * here instead would pull in `ThrottlerModule`/`AuthController`/Telegram
 * replay-guard machinery this module has no use for.
 */
@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
  providers: [RealtimeGateway, RealtimeEventService],
  exports: [RealtimeEventService],
})
export class RealtimeModule {}
