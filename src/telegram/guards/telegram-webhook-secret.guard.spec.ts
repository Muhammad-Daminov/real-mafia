import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TelegramWebhookSecretGuard } from './telegram-webhook-secret.guard';

function buildContext(headers: Record<string, string>): ExecutionContext {
  const request = {
    header: (name: string) => headers[name.toLowerCase()],
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('TelegramWebhookSecretGuard', () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const guard = new TelegramWebhookSecretGuard();

  afterEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
  });

  it('401s (throws UnauthorizedException) when TELEGRAM_WEBHOOK_SECRET is unset — fails closed', () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    expect(() => guard.canActivate(buildContext({ 'x-telegram-bot-api-secret-token': 'anything' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('401s when the header is missing entirely', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'correct-secret';

    expect(() => guard.canActivate(buildContext({}))).toThrow(UnauthorizedException);
  });

  it('401s when the header value is wrong', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'correct-secret';

    expect(() =>
      guard.canActivate(buildContext({ 'x-telegram-bot-api-secret-token': 'wrong-secret' })),
    ).toThrow(UnauthorizedException);
  });

  it('401s on a different-length value (would otherwise throw inside timingSafeEqual)', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'correct-secret';

    expect(() =>
      guard.canActivate(buildContext({ 'x-telegram-bot-api-secret-token': 'short' })),
    ).toThrow(UnauthorizedException);
  });

  it('allows the request through when the header exactly matches', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'correct-secret';

    expect(guard.canActivate(buildContext({ 'x-telegram-bot-api-secret-token': 'correct-secret' }))).toBe(true);
  });
});
