import { resolveCorsOrigins } from './cors';

describe('resolveCorsOrigins', () => {
  const original = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = original;
    }
  });

  it('defaults to http://localhost:5173 only when CORS_ORIGINS is unset', () => {
    delete process.env.CORS_ORIGINS;
    expect(resolveCorsOrigins()).toEqual(['http://localhost:5173']);
  });

  it('defaults the same way when CORS_ORIGINS is set but empty/whitespace', () => {
    process.env.CORS_ORIGINS = '   ';
    expect(resolveCorsOrigins()).toEqual(['http://localhost:5173']);
  });

  it('splits a comma-separated list and trims whitespace around each origin', () => {
    process.env.CORS_ORIGINS = 'https://app.example.com, https://admin.example.com ,https://x.com';
    expect(resolveCorsOrigins()).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
      'https://x.com',
    ]);
  });

  it('drops empty entries from a trailing/double comma', () => {
    process.env.CORS_ORIGINS = 'https://app.example.com,,';
    expect(resolveCorsOrigins()).toEqual(['https://app.example.com']);
  });

  it('drops a literal "*" and falls back to the default instead of ever allowing a wildcard', () => {
    process.env.CORS_ORIGINS = '*';
    expect(resolveCorsOrigins()).toEqual(['http://localhost:5173']);
  });

  it('drops "*" out of a mixed list, keeping the real origins', () => {
    process.env.CORS_ORIGINS = 'https://app.example.com,*';
    expect(resolveCorsOrigins()).toEqual(['https://app.example.com']);
  });
});
