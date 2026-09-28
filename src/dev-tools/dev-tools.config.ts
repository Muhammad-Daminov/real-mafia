import type { Type } from '@nestjs/common';
import { DevToolsModule } from './dev-tools.module';

/**
 * B-D1: `DevToolsModule` (`POST /dev/rooms/:code/fill-bots`) exists in
 * `AppModule`'s route table ONLY when `DEV_TOOLS_ENABLED === 'true'` AND
 * `NODE_ENV !== 'production'`. Called once, in `app.module.ts`'s top-level
 * `imports` array — evaluated at module-decoration time (when Node first
 * `require`s `app.module.ts`, before `main.ts`'s `bootstrap()` runs), the
 * same timing `common/config/cors.ts`'s `resolveCorsOrigins()` already
 * relies on, safe because env vars are set (dotenv/deployment env) before
 * Nest's module graph is ever built.
 *
 * If `NODE_ENV=production` and `DEV_TOOLS_ENABLED` is set **at all** — any
 * value, not just `'true'` — this throws synchronously, crashing the
 * process before `app.listen()` is ever reached ("fail fast at boot"). A
 * typo'd-but-truthy-looking value (`'1'`, `'TRUE'`, even an accidental
 * `'false'` left over from copy-pasting a dev `.env` into production) is
 * exactly the dangerous case this is meant to catch — not just the literal
 * `'true'` string.
 */
export function resolveDevToolsImports(): Type[] {
  const isProduction = process.env.NODE_ENV === 'production';
  const devToolsEnabledRaw = process.env.DEV_TOOLS_ENABLED;

  if (isProduction && devToolsEnabledRaw !== undefined) {
    throw new Error(
      `DEV_TOOLS_ENABLED must never be set when NODE_ENV=production ` +
        `(got ${JSON.stringify(devToolsEnabledRaw)}) — refusing to boot.`,
    );
  }

  return devToolsEnabledRaw === 'true' && !isProduction ? [DevToolsModule] : [];
}
