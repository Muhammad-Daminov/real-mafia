import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetReadyDto } from './set-ready.dto';

describe('SetReadyDto', () => {
  const check = async (plain: object) =>
    validate(plainToInstance(SetReadyDto, plain));

  it('accepts a valid payload', async () => {
    expect(
      await check({ clientRequestId: 'req-1', isReady: true }),
    ).toHaveLength(0);
  });

  it('accepts isReady: false', async () => {
    expect(
      await check({ clientRequestId: 'req-1', isReady: false }),
    ).toHaveLength(0);
  });

  it('rejects a missing clientRequestId', async () => {
    const errors = await check({ isReady: true });
    expect(errors.some((e) => e.property === 'clientRequestId')).toBe(true);
  });

  it('rejects a missing isReady', async () => {
    const errors = await check({ clientRequestId: 'req-1' });
    expect(errors.some((e) => e.property === 'isReady')).toBe(true);
  });

  it('rejects a non-boolean isReady', async () => {
    const errors = await check({ clientRequestId: 'req-1', isReady: 'yes' });
    expect(errors.some((e) => e.property === 'isReady')).toBe(true);
  });
});
