/**
 * B-T2: the small slice of Telegram's `Update` object this webhook reads —
 * every other field (edited_message, channel_post, callback_query, etc.)
 * is deliberately untyped here and never accessed. These are plain
 * `interface`s, not classes, on purpose: Nest's global `ValidationPipe`
 * (`whitelist`/`forbidNonWhitelisted`, `main.ts`) only runs class-validator
 * against a `@Body()` parameter whose reflected type is an actual class —
 * a param typed as a plain interface erases to `Object` at runtime and the
 * pipe skips it entirely (confirmed by reading
 * `node_modules/@nestjs/common/pipes/validation.pipe.js`'s `toValidate`).
 * That's required here: Telegram's real `Update` payload carries many
 * fields no DTO in this slice models, and `forbidNonWhitelisted` would
 * otherwise 400 on every one of them.
 */
export interface TelegramUser {
  id: number;
  is_bot?: boolean;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  /** Unix seconds — Telegram's own send time, used for the "ignore stale
   * updates" window (task item 4). */
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
