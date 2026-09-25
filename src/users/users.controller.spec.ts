import { NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import type { RequestWithUser } from '../auth/types/authenticated-user';

/**
 * F-01 (docs/audit/GAP_REPORT.md): `GET /users` used to return the entire user
 * table to any authenticated caller. These tests pin the fixed behaviour:
 * the endpoint is scoped to the caller's own record, resolved from the verified
 * JWT identity rather than any client-supplied id (Master TZ §29).
 */
describe('UsersController', () => {
  // Ids are UUIDs since the Phase 2 uuid conversion.
  const OWN_ID = '11111111-1111-4111-8111-111111111111';
  const OTHER_ID = '22222222-2222-4222-8222-222222222222';

  const buildRequest = (userId: string): RequestWithUser => ({
    user: { userId, telegramId: `tg-${userId}` },
  });

  const buildController = (findById: jest.Mock) =>
    new UsersController({ findById } as unknown as UsersService);

  it('returns only the caller\'s own profile', async () => {
    const ownProfile = { id: OWN_ID, telegramId: 'tg-own', firstName: 'Ali' };
    const findById = jest.fn().mockResolvedValue(ownProfile);

    const result = await buildController(findById).findMe(buildRequest(OWN_ID));

    expect(result).toBe(ownProfile);
    expect(findById).toHaveBeenCalledWith(OWN_ID);
  });

  it('resolves the id from the JWT identity, never from the request body or params', async () => {
    const findById = jest.fn().mockResolvedValue({ id: OWN_ID });

    // A caller who tries to smuggle another id alongside their token must still
    // only ever reach their own record.
    const request = {
      ...buildRequest(OWN_ID),
      params: { id: OTHER_ID },
      body: { userId: OTHER_ID },
      query: { userId: OTHER_ID },
    } as unknown as RequestWithUser;

    await buildController(findById).findMe(request);

    expect(findById).toHaveBeenCalledTimes(1);
    expect(findById).toHaveBeenCalledWith(OWN_ID);
  });

  it('throws 404 rather than returning null when the user no longer exists', async () => {
    const findById = jest.fn().mockResolvedValue(null);

    await expect(
      buildController(findById).findMe(buildRequest(OTHER_ID)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exposes no list-all capability on the controller or the service', () => {
    // The vulnerability was a `findAll` that returned every row. Assert the
    // regression cannot quietly come back.
    expect(
      (UsersController.prototype as unknown as Record<string, unknown>).findAll,
    ).toBeUndefined();
    expect(
      (UsersService.prototype as unknown as Record<string, unknown>).findAll,
    ).toBeUndefined();
  });
});
