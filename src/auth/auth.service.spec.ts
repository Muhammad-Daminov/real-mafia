import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramReplayGuardService } from './telegram-replay-guard.service';
import { LaunchTokenService } from './launch-token.service';
import {
  LaunchTokenErrorCode,
  LaunchTokenException,
} from './launch-token.errors';
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
      { consume: jest.fn() } as unknown as LaunchTokenService,
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

/**
 * F-04 (docs/audit/GAP_REPORT.md) / Master TZ §22.2, §30.1: wiring the
 * launch-token protocol into POST /auth/telegram. initData verification
 * (HMAC, freshness, replay) is unchanged and already covered above — these
 * tests exercise only the token-binding step layered on top of it.
 */
describe('AuthService — launch token binding', () => {
  const BOT_TOKEN_2 = 'test-bot-token-2';
  const RESOLVED_USER_ID = '33333333-3333-4333-8333-333333333333';

  const signInitData = (
    fields: Record<string, string>,
    botToken = BOT_TOKEN_2,
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

  const validInitData = () =>
    signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 67890, first_name: 'Vito' }),
    });

  let consume: jest.Mock;
  let upsert: jest.Mock;
  let service: AuthService;

  beforeEach(() => {
    process.env.BOT_TOKEN = BOT_TOKEN_2;

    consume = jest.fn();
    upsert = jest.fn().mockResolvedValue({
      id: RESOLVED_USER_ID,
      telegramId: '67890',
    });

    service = new AuthService(
      { user: { upsert } } as unknown as PrismaService,
      { signAsync: jest.fn().mockResolvedValue('jwt-token') } as unknown as JwtService,
      { claim: jest.fn().mockResolvedValue(true) } as unknown as TelegramReplayGuardService,
      { consume } as unknown as LaunchTokenService,
    );
  });

  it('does not call the launch-token service when launchToken is absent (no regression)', async () => {
    const result = await service.loginWithTelegram(validInitData());

    expect(consume).not.toHaveBeenCalled();
    expect(result).toEqual({ accessToken: 'jwt-token', user: expect.any(Object) });
    expect(result).not.toHaveProperty('roomId');
  });

  it('consumes the token after the user is resolved and binds the resulting roomId', async () => {
    const roomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    consume.mockResolvedValue({ roomId });

    const result = await service.loginWithTelegram(validInitData(), 'a-token');

    expect(consume).toHaveBeenCalledWith({
      token: 'a-token',
      userId: RESOLVED_USER_ID,
    });
    // Called after the user upsert resolved, not before.
    expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(
      consume.mock.invocationCallOrder[0],
    );
    expect(result.roomId).toBe(roomId);
  });

  it('omits roomId when an unbound (public-browser) token is consumed', async () => {
    consume.mockResolvedValue({ roomId: null });

    const result = await service.loginWithTelegram(validInitData(), 'a-token');

    expect(result).not.toHaveProperty('roomId');
  });

  it.each([
    LaunchTokenErrorCode.NOT_FOUND,
    LaunchTokenErrorCode.EXPIRED,
    LaunchTokenErrorCode.ALREADY_USED,
    LaunchTokenErrorCode.ROOM_MISMATCH,
  ])(
    'surfaces %s from the launch-token service without swallowing it into a generic auth error',
    async (code) => {
      consume.mockRejectedValue(new LaunchTokenException(code, 'boom'));

      const attempt = service.loginWithTelegram(validInitData(), 'a-token');

      await expect(attempt).rejects.toBeInstanceOf(LaunchTokenException);
      await expect(attempt).rejects.toMatchObject({ code });
    },
  );

  it('rejects a token reused across two separate login calls, not just within one', async () => {
    consume
      .mockResolvedValueOnce({ roomId: null })
      .mockRejectedValueOnce(
        new LaunchTokenException(
          LaunchTokenErrorCode.ALREADY_USED,
          'already used',
        ),
      );

    const first = await service.loginWithTelegram(validInitData(), 'reused-token');
    expect(first).not.toHaveProperty('roomId');

    await expect(
      service.loginWithTelegram(validInitData(), 'reused-token'),
    ).rejects.toMatchObject({ code: LaunchTokenErrorCode.ALREADY_USED });

    // Every login call must re-invoke consume() itself — the service must
    // never cache or short-circuit a prior result for the same token string.
    expect(consume).toHaveBeenCalledTimes(2);
  });
});
