import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TransferHostDto } from './transfer-host.dto';

describe('TransferHostDto', () => {
  const check = async (plain: object) =>
    validate(plainToInstance(TransferHostDto, plain));

  it('accepts a valid payload', async () => {
    expect(
      await check({ clientRequestId: 'req-1', targetPlayerId: 'player-1' }),
    ).toHaveLength(0);
  });

  it('rejects a missing clientRequestId', async () => {
    const errors = await check({ targetPlayerId: 'player-1' });
    expect(errors.some((e) => e.property === 'clientRequestId')).toBe(true);
  });

  it('rejects a missing targetPlayerId', async () => {
    const errors = await check({ clientRequestId: 'req-1' });
    expect(errors.some((e) => e.property === 'targetPlayerId')).toBe(true);
  });

  it('rejects an empty-string targetPlayerId', async () => {
    const errors = await check({
      clientRequestId: 'req-1',
      targetPlayerId: '',
    });
    expect(errors.some((e) => e.property === 'targetPlayerId')).toBe(true);
  });
});
