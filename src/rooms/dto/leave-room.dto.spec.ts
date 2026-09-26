import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LeaveRoomDto } from './leave-room.dto';

describe('LeaveRoomDto', () => {
  const check = async (plain: object) =>
    validate(plainToInstance(LeaveRoomDto, plain));

  it('accepts a valid payload', async () => {
    expect(await check({ clientRequestId: 'req-1' })).toHaveLength(0);
  });

  it('rejects a missing clientRequestId', async () => {
    const errors = await check({});
    expect(errors.some((e) => e.property === 'clientRequestId')).toBe(true);
  });

  it('rejects an empty-string clientRequestId', async () => {
    const errors = await check({ clientRequestId: '' });
    expect(errors.some((e) => e.property === 'clientRequestId')).toBe(true);
  });
});
