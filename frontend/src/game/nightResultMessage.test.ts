import { describe, expect, it } from 'vitest';
import { nightResultMessage } from './nightResultMessage';
import { uz } from '../messages/uz';

describe('nightResultMessage', () => {
  it('DON_CHECK_RESULT', () => {
    expect(nightResultMessage('DON_CHECK_RESULT', { isSheriff: true })).toBe(uz.nightResults.DON_CHECK_RESULT(true));
    expect(nightResultMessage('DON_CHECK_RESULT', { isSheriff: false })).toBe(uz.nightResults.DON_CHECK_RESULT(false));
  });

  it('SHERIFF_RESULT', () => {
    expect(nightResultMessage('SHERIFF_RESULT', { died: true })).toBe(uz.nightResults.SHERIFF_RESULT(true));
    expect(nightResultMessage('SHERIFF_RESULT', { died: false })).toBe(uz.nightResults.SHERIFF_RESULT(false));
  });

  it('GUARD_CONSUMED', () => {
    expect(nightResultMessage('GUARD_CONSUMED', { consumed: true })).toBe(uz.nightResults.GUARD_CONSUMED(true));
  });

  it('DETECTIVE_RESULT', () => {
    expect(nightResultMessage('DETECTIVE_RESULT', { flag: 'MAFIA' })).toBe(uz.nightResults.DETECTIVE_RESULT('MAFIA'));
    expect(nightResultMessage('DETECTIVE_RESULT', { flag: 'NOT_MAFIA' })).toBe(
      uz.nightResults.DETECTIVE_RESULT('NOT_MAFIA'),
    );
  });

  it('JOURNALIST_RESULT', () => {
    expect(nightResultMessage('JOURNALIST_RESULT', { relation: 'SAME_TEAM' })).toBe(
      uz.nightResults.JOURNALIST_RESULT('SAME_TEAM'),
    );
  });

  it('DOCTOR_PROTECT_RESULT (payload-independent confirmation)', () => {
    expect(nightResultMessage('DOCTOR_PROTECT_RESULT', { applied: true })).toBe(uz.nightResults.DOCTOR_PROTECT_RESULT());
  });

  it('falls back to the unknown message for an unrecognized event name', () => {
    expect(nightResultMessage('SOME_FUTURE_EVENT', {})).toBe(uz.nightResults.unknown);
  });

  it('falls back to the unknown message for a malformed payload', () => {
    expect(nightResultMessage('DETECTIVE_RESULT', { flag: 'NOT_A_REAL_FLAG' })).toBe(uz.nightResults.unknown);
    expect(nightResultMessage('SHERIFF_RESULT', {})).toBe(uz.nightResults.unknown);
  });
});
