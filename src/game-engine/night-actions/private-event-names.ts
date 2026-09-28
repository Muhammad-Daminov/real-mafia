import { ActionType } from '@prisma/client';

/**
 * §17.5 (extended by OD-048): the private-event name each `GameAction.result`
 * is delivered under, keyed by `actionType`. `KILL` has no entry — neither
 * §17.5 nor `resolveNightActions` produces a private result for a kill
 * submission (see OD-048's reasoning).
 */
export const PRIVATE_RESULT_EVENT_BY_ACTION_TYPE: Partial<Record<ActionType, string>> = {
  [ActionType.CHECK]: 'DON_CHECK_RESULT',
  [ActionType.SHOOT]: 'SHERIFF_RESULT',
  [ActionType.GUARD]: 'GUARD_CONSUMED',
  [ActionType.INVESTIGATE]: 'DETECTIVE_RESULT',
  [ActionType.INVESTIGATE_PAIR]: 'JOURNALIST_RESULT',
  [ActionType.PROTECT]: 'DOCTOR_PROTECT_RESULT',
};
