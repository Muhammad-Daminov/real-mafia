import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramReplayGuardService } from './telegram-replay-guard.service';
import { JwtService } from '@nestjs/jwt';
import { INIT_DATA_FRESHNESS_WINDOW_SECONDS } from './auth.constants';

const BOT_TOKEN = 'test-bot-token';

/**
 * F-03 (docs/audit/GAP_REPORT.md): end-to-end behaviour of the replay guard
 * inside the auth flow — Master TZ §22.2 requires HMAC + freshness + replay
 * cache together, and the replay check must run only once the HMAC has proven
 * the payload really came from Telegram.
 */
describe('AuthService — initData replay protection', () => {
  const signInitData = (
    fields: Record<string, string>,
    botToken = BOT_TOKEN,
  ): string => {
    const dataCheckString = Object.entries(fields)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const hash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return new URLSearchParams({ ...fields, hash }).toString();
  };

  const validInitData = (authDate = Math.floor(Date.now() / 1000)) =>
    signInitData({
      auth_date: String(authDate),
      user: JSON.stringify({ id: 12345, first_name: 'Ali' }),
    });

  let claim: jest.Mock;
  let upsert: jest.Mock;
  let service: AuthService;

  beforeEach(() => {
    process.env.BOT_TOKEN = BOT_TOKEN;

    claim = jest.fn().mockResolvedValue(true);
    upsert = jest.fn().mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      telegramId: '12345',
    });

    service = new AuthService(
      { user: { upsert } } as unknown as PrismaService,
      { signAsync: jest.fn().mockResolvedValue('jwt-token') } as unknown as JwtService,
      { claim } as unknown as TelegramReplayGuardService,
    );
  });

  it('accepts a valid, first-use initData', async () => {
    const result = await service.loginWithTelegram(validInitData());

    expect(result.accessToken).toBe('jwt-token');
    expect(claim).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects a replayed initData even though its HMAC and freshness are still valid', async () => {
    const initData = validInitData();

    // First use is claimed successfully, second use is not.
    claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(service.loginWithTelegram(initData)).resolves.toBeDefined();
    await expect(service.loginWithTelegram(initData)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // The replayed request must not have touched the user table.
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('claims the hash from initData, and pins the TTL to the freshness window', async () => {
    const authDate = Math.floor(Date.now() / 1000);
    const initData = validInitData(authDate);
    const expectedHash = new URLSearchParams(initData).get('hash');

    await service.loginWithTelegram(initData);

    const [claimedHash, expiresAt] = claim.mock.calls[0];
    expect(claimedHash).toBe(expectedHash);
    expect((expiresAt as Date).getTime()).toBe(
      (authDate + INIT_DATA_FRESHNESS_WINDOW_SECONDS) * 1000,
    );
  });

  it('does not consume the replay guard when the HMAC is invalid', async () => {
    const forged = signInitData(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 999, first_name: 'Mallory' }),
      },
      'wrong-bot-token',
    );

    await expect(service.loginWithTelegram(forged)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(claim).not.toHaveBeenCalled();
  });

  it('does not consume the replay guard when initData is stale', async () => {
    const stale = validInitData(
      Math.floor(Date.now() / 1000) - (INIT_DATA_FRESHNESS_WINDOW_SECONDS + 60),
    );

    await expect(service.loginWithTelegram(stale)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(claim).not.toHaveBeenCalled();
  });
});
