/**
 * `POST /auth/telegram`'s response shape, read verbatim from
 * `AuthService.loginWithTelegram` (../../../src/auth/auth.service.ts) — the
 * `user` object is the raw Prisma `User` row, `roomId` is present only when
 * a `launchToken` was consumed and resolved to a room.
 *
 * Note: the Master TZ's §22.2 sequence diagram names a `refreshToken` field
 * here (`API->>MA: { accessToken, refreshToken, roomId? }`), but the current
 * implementation returns no such field — see docs/OPEN_DECISIONS.md (this
 * project) OD-F1-001.
 */
export interface TelegramUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  accessToken: string;
  user: TelegramUser;
  roomId?: string;
}

/**
 * Nest's default `HttpExceptionFilter` shape for a thrown `HttpException`
 * (e.g. `BadRequestException` from `AuthService`) — `message` may be a
 * string or a string array (class-validator's shape for DTO failures).
 */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}
