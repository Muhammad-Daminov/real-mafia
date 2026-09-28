import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TelegramNotificationService } from './telegram-notification.service';

/**
 * §19/§25 (v5.0)/OD-051: the outbox dispatcher, deliberately a top-level
 * `common/` module like `SchedulingModule` itself — a future `economy`/
 * `payments`/`referral` producer of `WALLET_CREDIT`/`STARS_REFUND`/
 * `REFERRAL_REWARD_NOTIFY` (§19/§25) only needs `SchedulerService.enqueue`
 * with its own `kind`, never a dependency on this module or on
 * `game-engine`. This module never imports a producer — same one-directional
 * discipline as `SchedulingModule`.
 */
@Module({
  imports: [SchedulingModule],
  providers: [TelegramNotificationService],
  exports: [TelegramNotificationService],
})
export class OutboxModule {}
