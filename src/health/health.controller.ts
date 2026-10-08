import { Controller, Get } from '@nestjs/common';

/**
 * Render (and any other platform health check) needs a route that never
 * requires auth and never touches the DB/Redis — just "is the process up
 * and serving HTTP." Deliberately has no `@UseGuards` (this app has no
 * global guard — every other controller opts in to `JwtGuard` itself, see
 * `app.module.ts`), so this stays public with zero extra wiring.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
