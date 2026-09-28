/**
 * Local-only JWT payload decoding — NEVER a substitute for server-side
 * verification. `JwtStrategy` (../../../src/auth/strategies/jwt.strategy.ts)
 * is the actual authority: any tampered, expired, or otherwise invalid token
 * is rejected there regardless of what this module returns. This exists
 * solely to decide, client-side, whether a token found in `sessionStorage`
 * is worth sending at all before making a round trip — see OD-F1-003.
 */
export interface DecodedJwtPayload {
  /** `User.id` — matches `JwtStrategy.validate`'s `payload.sub`. */
  sub: string;
  telegramId: string;
  /** Seconds since epoch (standard JWT claim). Absent is treated as expired — fail closed. */
  exp?: number;
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

export function decodeJwtPayload(token: string): DecodedJwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(parts[1])) as DecodedJwtPayload;
  } catch {
    return null;
  }
}

/** Unparseable/no `exp` claim counts as expired — never treated as a usable token. */
export function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) {
    return true;
  }
  return Date.now() >= payload.exp * 1000;
}
