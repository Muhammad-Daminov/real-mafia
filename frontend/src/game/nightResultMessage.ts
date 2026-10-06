import { uz } from '../messages/uz';

/**
 * Maps a private night-action-result event (§17.5/OD-048,
 * `PRIVATE_RESULT_EVENT_BY_ACTION_TYPE`,
 * ../../../src/game-engine/night-actions/private-event-names.ts) plus its
 * payload (shapes transcribed verbatim from `resolveNightActions`,
 * ../../../src/game-engine/night-actions/night-resolution.ts) to a uz
 * string. Unrecognized event names or malformed payloads fall back to a
 * generic message rather than crashing the phase screen.
 */
export function nightResultMessage(event: string, payload: Record<string, unknown>): string {
  switch (event) {
    case 'DON_CHECK_RESULT':
      return typeof payload.isSheriff === 'boolean'
        ? uz.nightResults.DON_CHECK_RESULT(payload.isSheriff)
        : uz.nightResults.unknown;
    case 'SHERIFF_RESULT':
      return typeof payload.died === 'boolean' ? uz.nightResults.SHERIFF_RESULT(payload.died) : uz.nightResults.unknown;
    case 'GUARD_CONSUMED':
      return typeof payload.consumed === 'boolean'
        ? uz.nightResults.GUARD_CONSUMED(payload.consumed)
        : uz.nightResults.unknown;
    case 'DETECTIVE_RESULT':
      return payload.flag === 'MAFIA' || payload.flag === 'NOT_MAFIA'
        ? uz.nightResults.DETECTIVE_RESULT(payload.flag)
        : uz.nightResults.unknown;
    case 'JOURNALIST_RESULT':
      return payload.relation === 'SAME_TEAM' || payload.relation === 'DIFFERENT_TEAM'
        ? uz.nightResults.JOURNALIST_RESULT(payload.relation)
        : uz.nightResults.unknown;
    case 'DOCTOR_PROTECT_RESULT':
      return uz.nightResults.DOCTOR_PROTECT_RESULT();
    default:
      return uz.nightResults.unknown;
  }
}
