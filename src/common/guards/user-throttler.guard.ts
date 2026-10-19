import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * B-H1: the command-endpoint throttle tracks by authenticated user, not by
 * IP (task: "60/min per user") — several players behind the same NAT/
 * mobile carrier sharing one IP must not share one budget. Requires
 * `JwtGuard` to have already run and set `req.user` — every controller
 * this guard is applied to lists `JwtGuard` first in `@UseGuards(...)`,
 * so `req.user` is always populated by the time `getTracker` runs here.
 * Falls back to IP only for the (currently unreached, since this guard is
 * never applied to an unauthenticated route) case where it isn't.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = (req.user as { userId?: string } | undefined)?.userId;
    if (userId) {
      return `user:${userId}`;
    }
    return super.getTracker(req);
  }
}
