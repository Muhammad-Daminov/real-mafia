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
 *
 * `code` is a second, distinct shape: `RoomException`
 * (../../../src/rooms/rooms.errors.ts) responds with `{ code, message }`
 * only — no `statusCode`/`error` fields — for every room command error
 * (`GAME_FULL`, `NOT_HOST`, `CONFIG_INVALID`, etc., §32's error table).
 * Both shapes are read from the same body here since a caller can't know in
 * advance which endpoint it's talking to.
 */
export interface ApiErrorBody {
  statusCode?: number;
  message: string | string[];
  error?: string;
  code?: string;
}
