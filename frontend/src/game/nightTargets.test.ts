import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTargetRows, canConfirmSelection, isAlivePlayer } from './nightTargets';
import { primaryAbility } from './nightAbility';
import type { RoomPlayerSummary } from '../api/rooms';

const submitNightActionMock = vi.fn();

vi.mock('../api/nightActions', async () => {
  const actual = await vi.importActual<typeof import('../api/nightActions')>('../api/nightActions');
  return { ...actual, submitNightAction: (...args: unknown[]) => submitNightActionMock(...args) };
});

beforeEach(() => {
  submitNightActionMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

function roster(overrides: Partial<RoomPlayerSummary>[] = []): RoomPlayerSummary[] {
  const base: RoomPlayerSummary[] = [
    { playerId: 'me', displayName: 'Me', avatarUrl: null, isReady: true, isHost: true, joinedAt: 't', lifeStatus: 'ALIVE' },
    { playerId: 'teammate', displayName: 'Teammate', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't', lifeStatus: 'ALIVE' },
    { playerId: 'town-alive', displayName: 'Town Alive', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't', lifeStatus: 'ALIVE' },
    { playerId: 'town-dead', displayName: 'Town Dead', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't', lifeStatus: 'DEAD' },
    { playerId: 'town-waiting', displayName: 'Town Waiting', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't', lifeStatus: 'WAITING' },
    { playerId: 'town-unknown', displayName: 'Town Unknown', avatarUrl: null, isReady: true, isHost: false, joinedAt: 't' },
  ];
  return overrides.length ? [...base, ...(overrides as RoomPlayerSummary[])] : base;
}

describe('isAlivePlayer', () => {
  it('is true only for an exact ALIVE lifeStatus', () => {
    expect(isAlivePlayer({ lifeStatus: 'ALIVE' })).toBe(true);
    expect(isAlivePlayer({ lifeStatus: 'DEAD' })).toBe(false);
    expect(isAlivePlayer({ lifeStatus: 'WAITING' })).toBe(false);
    expect(isAlivePlayer({ lifeStatus: undefined })).toBe(false);
    expect(isAlivePlayer({ lifeStatus: 'SOME_FUTURE_VALUE' as never })).toBe(false);
  });
});

describe('buildTargetRows — per role against a roster fixture', () => {
  it("Detective: self ineligible (SELF), dead/waiting/unknown-life-status ineligible (DEAD), alive town eligible", () => {
    const rows = buildTargetRows(primaryAbility('DETECTIVE')!, 'me', roster(), []);
    const byId = new Map(rows.map((r) => [r.playerId, r]));

    expect(byId.get('me')).toMatchObject({ eligible: false, reason: 'SELF', isSelf: true });
    expect(byId.get('town-alive')).toMatchObject({ eligible: true, reason: null });
    expect(byId.get('town-dead')).toMatchObject({ eligible: false, reason: 'DEAD' });
    expect(byId.get('town-waiting')).toMatchObject({ eligible: false, reason: 'DEAD' });
    expect(byId.get('town-unknown')).toMatchObject({ eligible: false, reason: 'DEAD' });
  });

  it("Doctor: self IS eligible (allowSelfTarget)", () => {
    const rows = buildTargetRows(primaryAbility('DOCTOR')!, 'me', roster(), []);
    expect(rows.find((r) => r.playerId === 'me')).toMatchObject({ eligible: true, reason: null, isSelf: true });
  });

  it("Mafia: a known MAFIA-team teammate is excluded (EXCLUDED_TEAM), a plain town player is not", () => {
    const rows = buildTargetRows(primaryAbility('MAFIA')!, 'me', roster(), [{ playerId: 'teammate', roleCode: 'DON' }]);
    const byId = new Map(rows.map((r) => [r.playerId, r]));

    expect(byId.get('teammate')).toMatchObject({ eligible: false, reason: 'EXCLUDED_TEAM' });
    expect(byId.get('town-alive')).toMatchObject({ eligible: true, reason: null });
  });

  it("Maniac: no team exclusion — even a known teammate is a valid target if alive", () => {
    const rows = buildTargetRows(primaryAbility('MANIAC')!, 'me', roster(), [{ playerId: 'teammate', roleCode: 'DON' }]);
    expect(rows.find((r) => r.playerId === 'teammate')).toMatchObject({ eligible: true, reason: null });
  });

  it('marks isSelf correctly for every row', () => {
    const rows = buildTargetRows(primaryAbility('SHERIFF')!, 'me', roster(), []);
    expect(rows.find((r) => r.playerId === 'me')!.isSelf).toBe(true);
    expect(rows.find((r) => r.playerId === 'town-alive')!.isSelf).toBe(false);
  });
});

describe('canConfirmSelection', () => {
  it('a single-target ability needs exactly one selected id', () => {
    const ability = primaryAbility('SHERIFF')!;
    expect(canConfirmSelection(ability, [])).toBe(false);
    expect(canConfirmSelection(ability, ['a'])).toBe(true);
    expect(canConfirmSelection(ability, ['a', 'b'])).toBe(false);
  });

  it("Journalist's pair-target ability needs exactly two distinct selected ids", () => {
    const ability = primaryAbility('JOURNALIST')!;
    expect(canConfirmSelection(ability, ['a'])).toBe(false);
    expect(canConfirmSelection(ability, ['a', 'b'])).toBe(true);
    expect(canConfirmSelection(ability, ['a', 'a'])).toBe(false);
  });
});

describe('submitSelectedTarget', () => {
  it('builds a single-target request and submits it', async () => {
    const { submitSelectedTarget } = await import('./nightTargets');
    submitNightActionMock.mockResolvedValue({
      actionId: 'a1',
      gameId: 'game-1',
      phaseId: 'phase-1',
      actionType: 'SHOOT',
      actionSlot: 0,
      targetPlayerId: 'town-alive',
      targetPlayerId2: null,
    });

    await submitSelectedTarget('game-1', primaryAbility('SHERIFF')!, ['town-alive']);

    expect(submitNightActionMock).toHaveBeenCalledWith('game-1', { actionType: 'SHOOT', targetPlayerId: 'town-alive' });
  });

  it("builds a pair-target request with targetPlayerId2 for Journalist", async () => {
    const { submitSelectedTarget } = await import('./nightTargets');
    submitNightActionMock.mockResolvedValue({
      actionId: 'a1',
      gameId: 'game-1',
      phaseId: 'phase-1',
      actionType: 'INVESTIGATE_PAIR',
      actionSlot: 0,
      targetPlayerId: 'p1',
      targetPlayerId2: 'p2',
    });

    await submitSelectedTarget('game-1', primaryAbility('JOURNALIST')!, ['p1', 'p2']);

    expect(submitNightActionMock).toHaveBeenCalledWith('game-1', {
      actionType: 'INVESTIGATE_PAIR',
      targetPlayerId: 'p1',
      targetPlayerId2: 'p2',
    });
  });

  it('throws without calling the API when the selection is incomplete', async () => {
    const { submitSelectedTarget } = await import('./nightTargets');

    await expect(submitSelectedTarget('game-1', primaryAbility('SHERIFF')!, [])).rejects.toThrow();
    expect(submitNightActionMock).not.toHaveBeenCalled();
  });

  it.each(['GAME_NOT_IN_NIGHT_PHASE', 'ABILITY_ALREADY_USED', 'INVALID_TARGET'])(
    'propagates a %s ApiError from the backend',
    async (code) => {
      const { submitSelectedTarget } = await import('./nightTargets');
      const { ApiError } = await import('../api/client');
      submitNightActionMock.mockRejectedValue(new ApiError('nope', 409, code));

      await expect(submitSelectedTarget('game-1', primaryAbility('SHERIFF')!, ['town-alive'])).rejects.toMatchObject({
        code,
      });
    },
  );
});
