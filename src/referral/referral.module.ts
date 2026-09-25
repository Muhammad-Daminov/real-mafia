import { Module } from '@nestjs/common';

/**
 * Referral module (Master TZ §23–26).
 *
 * Intentionally empty: this is Phase 12+ work. The module exists now so the
 * import-boundary rule of §37.5 / invariant I-33 is enforced from the first
 * commit that adds real code here.
 *
 * INVARIANT I-33: this module MUST NOT import from `game-engine`, and
 * `game-engine` MUST NOT import from it. Gameplay and economy are separate
 * aggregates that never share a transaction or a lock (§7, I-39).
 */
@Module({})
export class ReferralModule {}
