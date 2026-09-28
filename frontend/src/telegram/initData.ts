import { init, retrieveRawInitData } from '@telegram-apps/sdk';

/**
 * Thrown when the app isn't running inside a Telegram WebView at all
 * (`retrieveRawInitData` finds no launch params in the URL) or Telegram
 * supplied no `initData` (WebApp opened without user auth context, e.g. via
 * a bare browser tab). Both are the same "dev fallback" case from the task:
 * a clear, typed error the caller shows to the user — never a silent bypass.
 */
export class NotInTelegramError extends Error {
  constructor(cause?: unknown) {
    super('Not running inside Telegram — no initData available.');
    this.name = 'NotInTelegramError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

let initialized = false;

/**
 * Initializes the `@telegram-apps/sdk` bridge (idempotent — safe to call
 * more than once) and returns the raw `initData` string Telegram signed.
 * Never returns an empty/undefined value: both cases become
 * `NotInTelegramError` so callers have exactly one failure mode to handle.
 */
export function getRawInitData(): string {
  if (!initialized) {
    try {
      init();
      initialized = true;
    } catch (error) {
      throw new NotInTelegramError(error);
    }
  }

  let raw: string | undefined;
  try {
    raw = retrieveRawInitData();
  } catch (error) {
    throw new NotInTelegramError(error);
  }

  if (!raw) {
    throw new NotInTelegramError();
  }

  return raw;
}
