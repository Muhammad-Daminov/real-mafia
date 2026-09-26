import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

/**
 * §19/OD-008/OD-043: generic scheduled-task worker infrastructure. Deliberately
 * a top-level `common/` module, not `game-engine/` — it is domain-agnostic
 * shared infra intended for reuse by the outbox dispatcher (§19/§25) as well
 * as the phase-transition engine, and must have zero knowledge of either
 * consumer's domain (see `scheduler.service.ts`'s docstring).
 *
 * Dependency direction: a consumer module (`game-engine`) imports this
 * module and calls `registerHandler`/`enqueue`; this module never imports a
 * consumer. Same one-directional discipline I-33 already enforces for
 * `game-engine <-> economy`, applied here to keep this module reusable by
 * more than one domain.
 */
@Module({
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulingModule {}
