import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginTelegramDto } from './login-telegram.dto';

/**
 * Master TZ §30.1: POST /auth/telegram's body is validated by this DTO under
 * the app-wide ValidationPipe (whitelist + forbidNonWhitelisted + transform,
 * src/main.ts) — the whole reason for a DTO instead of raw @Body() field
 * access is that these rules actually apply to it.
 */
describe('LoginTelegramDto', () => {
  const check = async (plain: object) =>
    validate(plainToInstance(LoginTelegramDto, plain));

  it('accepts initData alone', async () => {
    const errors = await check({ initData: 'auth_date=1&hash=abc' });
    expect(errors).toHaveLength(0);
  });

  it('accepts initData with launchToken', async () => {
    const errors = await check({
      initData: 'auth_date=1&hash=abc',
      launchToken: 'a-token',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing initData', async () => {
    const errors = await check({});
    expect(errors.some((e) => e.property === 'initData')).toBe(true);
  });

  it('rejects an empty-string initData', async () => {
    const errors = await check({ initData: '' });
    expect(errors.some((e) => e.property === 'initData')).toBe(true);
  });

  it('rejects an empty-string launchToken', async () => {
    const errors = await check({
      initData: 'auth_date=1&hash=abc',
      launchToken: '',
    });
    expect(errors.some((e) => e.property === 'launchToken')).toBe(true);
  });

  it('rejects a non-string launchToken', async () => {
    const errors = await check({
      initData: 'auth_date=1&hash=abc',
      launchToken: 12345,
    });
    expect(errors.some((e) => e.property === 'launchToken')).toBe(true);
  });
});
