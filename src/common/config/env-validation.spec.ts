import { formatEnvIssues, validateEnv } from './env-validation';

function baseEnv(overrides: Partial<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    BOT_TOKEN: 'test-bot-token',
    JWT_SECRET: 'a'.repeat(32),
    NODE_ENV: 'development',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('validateEnv', () => {
  it('passes with no errors or warnings when everything required is set correctly', () => {
    const result = validateEnv(
      baseEnv({ TELEGRAM_WEBHOOK_SECRET: 'x', MINI_APP_URL: 'https://x', PUBLIC_API_URL: 'https://y' }),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'BOT_TOKEN', 'JWT_SECRET'])(
    'fails when %s is missing',
    (variable) => {
      const env = baseEnv();
      delete env[variable];
      const result = validateEnv(env);
      expect(result.errors.map((e) => e.variable)).toContain(variable);
    },
  );

  it.each(['DATABASE_URL', 'REDIS_URL', 'BOT_TOKEN', 'JWT_SECRET'])(
    'fails when %s is set to an empty/whitespace string, not just when unset',
    (variable) => {
      const result = validateEnv(baseEnv({ [variable]: '   ' }));
      expect(result.errors.map((e) => e.variable)).toContain(variable);
    },
  );

  it('fails when JWT_SECRET is set but shorter than 32 characters', () => {
    const result = validateEnv(baseEnv({ JWT_SECRET: 'too-short' }));
    expect(result.errors).toContainEqual({
      variable: 'JWT_SECRET',
      message: expect.stringContaining('32'),
    });
  });

  it('never includes the actual value of any variable in an error or warning message', () => {
    const secretValue = 'super-secret-value-that-must-never-leak-12345';
    const result = validateEnv(baseEnv({ JWT_SECRET: secretValue }));
    const allMessages = JSON.stringify(result);
    expect(allMessages).not.toContain(secretValue);
  });

  it('is silent about CORS_ORIGINS/DEV_TOOLS_ENABLED outside production', () => {
    const result = validateEnv(baseEnv({ NODE_ENV: 'development', DEV_TOOLS_ENABLED: 'true' }));
    expect(result.errors).toEqual([]);
  });

  it('fails when CORS_ORIGINS is missing in production', () => {
    const result = validateEnv(baseEnv({ NODE_ENV: 'production' }));
    expect(result.errors.map((e) => e.variable)).toContain('CORS_ORIGINS');
  });

  it('fails when CORS_ORIGINS contains the literal wildcard in production', () => {
    const result = validateEnv(baseEnv({ NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example.com,*' }));
    expect(result.errors.map((e) => e.variable)).toContain('CORS_ORIGINS');
  });

  it('passes CORS_ORIGINS in production when set to a real, non-wildcard origin', () => {
    const result = validateEnv(baseEnv({ NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example.com' }));
    expect(result.errors).toEqual([]);
  });

  it('fails when DEV_TOOLS_ENABLED is set at all in production, even to "false"', () => {
    const result = validateEnv(
      baseEnv({ NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example.com', DEV_TOOLS_ENABLED: 'false' }),
    );
    expect(result.errors.map((e) => e.variable)).toContain('DEV_TOOLS_ENABLED');
  });

  it.each(['TELEGRAM_WEBHOOK_SECRET', 'MINI_APP_URL', 'PUBLIC_API_URL'])(
    'warns (not fails) when %s is missing',
    (variable) => {
      const result = validateEnv(baseEnv());
      expect(result.warnings.map((w) => w.variable)).toContain(variable);
      expect(result.errors).toEqual([]);
    },
  );
});

describe('formatEnvIssues', () => {
  it('renders one indented line per issue, with the variable name and message', () => {
    const formatted = formatEnvIssues([
      { variable: 'FOO', message: 'is required but not set' },
      { variable: 'BAR', message: 'is invalid' },
    ]);
    expect(formatted).toBe('  - FOO: is required but not set\n  - BAR: is invalid');
  });

  it('is an empty string for no issues', () => {
    expect(formatEnvIssues([])).toBe('');
  });
});
