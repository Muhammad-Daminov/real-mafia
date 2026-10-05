import { Module } from '@nestjs/common';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

/**
 * §31/OD-059: owns the `GET /games/:gameId/state` reconnect-snapshot read.
 * Deliberately has no `imports` — `PrismaModule` is `@Global()`, and
 * `teamForRole` (`game-engine/roles.ts`) is a plain pure-function import,
 * not a provider, so no module wiring is needed to reach it. `games ->
 * game-engine` is a permitted I-33 direction (same as the already-
 * established `rooms -> game-engine`, OD-041 point 1) — nothing here
 * imports `economy`/`store`/`payments`/`referral`.
 */
@Module({
  controllers: [GamesController],
  providers: [GamesService],
})
export class GamesModule {}
