import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRoomDto } from './create-room.dto';

/** Master TZ §15.1: maxPlayers 4-24, rulesetMode NORMAL|FAST, clientRequestId required. */
describe('CreateRoomDto', () => {
  const check = async (plain: object) =>
    validate(plainToInstance(CreateRoomDto, plain));

  const valid = {
    clientRequestId: 'req-1',
    maxPlayers: 8,
    rulesetMode: 'NORMAL',
  };

  it('accepts a valid payload', async () => {
    expect(await check(valid)).toHaveLength(0);
  });

  it('rejects a missing clientRequestId', async () => {
    const { clientRequestId, ...rest } = valid;
    const errors = await check(rest);
    expect(errors.some((e) => e.property === 'clientRequestId')).toBe(true);
  });

  it.each([3, 25])('rejects maxPlayers out of the 4-24 range (%d)', async (maxPlayers) => {
    const errors = await check({ ...valid, maxPlayers });
    expect(errors.some((e) => e.property === 'maxPlayers')).toBe(true);
  });

  it.each([4, 24])('accepts the boundary values (%d)', async (maxPlayers) => {
    expect(await check({ ...valid, maxPlayers })).toHaveLength(0);
  });

  it('rejects a non-integer maxPlayers', async () => {
    const errors = await check({ ...valid, maxPlayers: 8.5 });
    expect(errors.some((e) => e.property === 'maxPlayers')).toBe(true);
  });

  it('rejects a rulesetMode outside NORMAL|FAST', async () => {
    const errors = await check({ ...valid, rulesetMode: 'CHAOS' });
    expect(errors.some((e) => e.property === 'rulesetMode')).toBe(true);
  });

  it('defaults visibility to PRIVATE when omitted (OD-039)', async () => {
    const errors = await check(valid);
    expect(errors).toHaveLength(0);

    const instance = plainToInstance(CreateRoomDto, valid);
    expect(instance.visibility).toBe('PRIVATE');
  });

  it('accepts an explicit PUBLIC visibility', async () => {
    const errors = await check({ ...valid, visibility: 'PUBLIC' });
    expect(errors).toHaveLength(0);

    const instance = plainToInstance(CreateRoomDto, {
      ...valid,
      visibility: 'PUBLIC',
    });
    expect(instance.visibility).toBe('PUBLIC');
  });

  it('accepts an explicit PRIVATE visibility', async () => {
    const errors = await check({ ...valid, visibility: 'PRIVATE' });
    expect(errors).toHaveLength(0);
  });

  it('rejects a visibility outside PRIVATE|PUBLIC', async () => {
    const errors = await check({ ...valid, visibility: 'UNLISTED' });
    expect(errors.some((e) => e.property === 'visibility')).toBe(true);
  });
});
