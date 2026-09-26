import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListPublicRoomsDto } from './list-public-rooms.dto';

describe('ListPublicRoomsDto', () => {
  const check = async (plain: object) => {
    const instance = plainToInstance(ListPublicRoomsDto, plain);
    return { instance, errors: await validate(instance) };
  };

  it('defaults page to 1 and limit to 20 when omitted', async () => {
    const { instance, errors } = await check({});
    expect(errors).toHaveLength(0);
    expect(instance.page).toBe(1);
    expect(instance.limit).toBe(20);
  });

  it('accepts explicit page and limit as query strings', async () => {
    const { instance, errors } = await check({ page: '3', limit: '10' });
    expect(errors).toHaveLength(0);
    expect(instance.page).toBe(3);
    expect(instance.limit).toBe(10);
  });

  it('rejects page < 1', async () => {
    const { errors } = await check({ page: '0' });
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });

  it('rejects limit > 50', async () => {
    const { errors } = await check({ limit: '51' });
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects limit < 1', async () => {
    const { errors } = await check({ limit: '0' });
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects a non-integer page', async () => {
    const { errors } = await check({ page: '1.5' });
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });
});
