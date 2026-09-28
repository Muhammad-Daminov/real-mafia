import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, isTokenExpired } from './jwt';

function base64UrlEncode(json: unknown): string {
  const base64 = btoa(JSON.stringify(json));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(payload: Record<string, unknown>): string {
  const header = base64UrlEncode({ alg: 'HS256', typ: 'JWT' });
  const body = base64UrlEncode(payload);
  return `${header}.${body}.fake-signature`;
}

describe('decodeJwtPayload', () => {
  it('decodes a well-formed token payload', () => {
    const token = makeToken({ sub: 'user-1', telegramId: '123', exp: 9999999999 });
    expect(decodeJwtPayload(token)).toEqual({ sub: 'user-1', telegramId: '123', exp: 9999999999 });
  });

  it('returns null for a token with the wrong number of segments', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
    expect(decodeJwtPayload('a.b.c.d')).toBeNull();
  });

  it('returns null when the payload segment is not valid base64url JSON', () => {
    expect(decodeJwtPayload('header.%%%not-base64%%%.sig')).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('is false for a token whose exp is in the future', () => {
    const token = makeToken({ sub: 'u', telegramId: 't', exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('is true for a token whose exp is in the past', () => {
    const token = makeToken({ sub: 'u', telegramId: 't', exp: Math.floor(Date.now() / 1000) - 10 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('is true (fail closed) for a token with no exp claim at all', () => {
    const token = makeToken({ sub: 'u', telegramId: 't' });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('is true (fail closed) for a garbage/undecodable token', () => {
    expect(isTokenExpired('garbage')).toBe(true);
  });
});
