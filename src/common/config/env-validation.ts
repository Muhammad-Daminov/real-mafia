/**
 * B-H1: boot-time environment validation. A pure function over an env-like
 * object (never reads `process.env` itself) so it's unit-testable without
 * mutating real process state — `main.ts` is the one real caller, passing
 * `process.env` directly.
 *
 * Every message below names the VARIABLE, never its value — "fail fast with
 * a clear message listing missing/invalid variable names, never values" is
 * this slice's own literal instruction, and a misconfigured secret is
 * exactly the kind of value that must never end up in a boot log.
 */
export interface EnvIssue {
  variable: string;
  message: string;
}

export interface EnvValidationResult {
  /** Non-empty means the process must refuse to start. */
  errors: EnvIssue[];
  /** Logged, never fatal. */
  warnings: EnvIssue[];
}

export const JWT_SECRET_MIN_LENGTH = 32;

/** Always required, in every environment — the app cannot function at all
 * without these (DB, replay-guard/rate-limit storage, Telegram auth, JWT
 * signing). */
const ALWAYS_REQUIRED = ['DATABASE_URL', 'REDIS_URL', 'BOT_TOKEN', 'JWT_SECRET'] as const;

/** Not required anywhere, but every running environment should have them
 * configured — a missing one degrades a specific feature (the /start
 * webhook reply, mainly) rather than the whole app, so this is a warning,
 * not a boot failure. */
const WARN_IF_MISSING = ['TELEGRAM_WEBHOOK_SECRET', 'MINI_APP_URL', 'PUBLIC_API_URL'] as const;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

export function validateEnv(env: NodeJS.ProcessEnv): EnvValidationResult {
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];

  for (const variable of ALWAYS_REQUIRED) {
    if (isBlank(env[variable])) {
      errors.push({ variable, message: 'is required but not set' });
    }
  }

  // Only meaningful once JWT_SECRET is actually present — the "missing"
  // error above already covers the unset case, this adds a second,
  // distinct error for "set, but too weak" rather than conflating the two.
  if (!isBlank(env.JWT_SECRET) && env.JWT_SECRET!.length < JWT_SECRET_MIN_LENGTH) {
    errors.push({
      variable: 'JWT_SECRET',
      message: `must be at least ${JWT_SECRET_MIN_LENGTH} characters`,
    });
  }

  if (env.NODE_ENV === 'production') {
    if (isBlank(env.CORS_ORIGINS)) {
      errors.push({ variable: 'CORS_ORIGINS', message: 'is required in production' });
    } else {
      const origins = env.CORS_ORIGINS!.split(',').map((origin) => origin.trim());
      if (origins.includes('*')) {
        errors.push({
          variable: 'CORS_ORIGINS',
          message: 'must not contain the wildcard "*" in production',
        });
      }
    }

    // Mirrors `dev-tools/dev-tools.config.ts`'s own synchronous throw (which
    // runs earlier, at AppModule decoration time, and is NOT removed or
    // replaced by this check) — included here too so the full set of
    // production invariants is visible and testable from one pure function,
    // not split across two enforcement points with no single place that
    // documents both.
    if (env.DEV_TOOLS_ENABLED !== undefined) {
      errors.push({
        variable: 'DEV_TOOLS_ENABLED',
        message: 'must be unset in production',
      });
    }
  }

  for (const variable of WARN_IF_MISSING) {
    if (isBlank(env[variable])) {
      warnings.push({ variable, message: 'is not set — see .env.example for what this disables' });
    }
  }

  return { errors, warnings };
}

export function formatEnvIssues(issues: EnvIssue[]): string {
  return issues.map((issue) => `  - ${issue.variable}: ${issue.message}`).join('\n');
}
