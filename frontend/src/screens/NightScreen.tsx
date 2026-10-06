import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { roleInfo } from '../game/labels';
import { hasNightAction } from '../game/nightAbility';
import type { LifeStatus, RoleCode } from '../api/games';

export type NightScreenState = 'dead' | 'sleeping' | 'acting';

/**
 * Pure decision extracted for testing — no React Testing Library in this
 * project (no `.test.tsx` anywhere in `src/`), same convention
 * `LobbyScreen.tsx`'s `isDebugMode` already established: test the
 * predicate a component renders against, not the JSX itself.
 */
export function resolveNightScreenState(myLifeStatus: LifeStatus | null, myRoleCode: RoleCode | null): NightScreenState {
  if (myLifeStatus !== null && myLifeStatus !== 'ALIVE') {
    return 'dead';
  }
  if (!myRoleCode || !hasNightAction(myRoleCode)) {
    return 'sleeping';
  }
  return 'acting';
}

/**
 * F4: the NIGHT phase screen. Three mutually exclusive states:
 *  - dead (`myLifeStatus !== 'ALIVE'`): a calm "watching" screen.
 *  - alive, role has no night action (CIVILIAN, or an unrecognized code):
 *    a calm "sleeping" screen — same tone, different copy, never a button.
 *  - alive, role has a night action: role/ability reminder, teammates
 *    (MAFIA/DON only, from gameStore — already sent by the backend, OD-025),
 *    and a submission area.
 *
 * OD-F4-001 (frontend/docs/OPEN_DECISIONS.md): no endpoint anywhere exposes
 * the alive-player roster with display names to a game member, so the third
 * state cannot render a real target picker — it says so plainly instead of
 * inventing one. `game/targetEligibility.ts`'s eligibility helper is ready
 * to wire in the moment that gap closes.
 */
function NightScreen() {
  const myLifeStatus = useGameStore((s) => s.myLifeStatus);
  const myRoleCode = useGameStore((s) => s.myRoleCode);
  const teammates = useGameStore((s) => s.teammates);
  const mySubmittedAction = useGameStore((s) => s.mySubmittedAction);

  const screenState = resolveNightScreenState(myLifeStatus, myRoleCode);

  if (screenState === 'dead') {
    return (
      <div className="mafia-screen">
        <h1>{uz.night.watchingTitle}</h1>
        <p className="mafia-hint">{uz.night.watchingNote}</p>
      </div>
    );
  }

  if (screenState === 'sleeping') {
    return (
      <div className="mafia-screen">
        <h1>{uz.night.sleepingTitle}</h1>
        <p className="mafia-hint">{uz.night.sleepingNote}</p>
      </div>
    );
  }

  // screenState === 'acting' guarantees myRoleCode is non-null (see
  // resolveNightScreenState).
  const info = roleInfo(myRoleCode!);

  return (
    <div className="mafia-screen">
      <h1>{uz.night.title}</h1>
      <div className="mafia-card">
        <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{info.name}</p>
        <p className="mafia-hint" style={{ margin: 0 }}>
          {info.ability}
        </p>

        {teammates.length > 0 && (
          <div className="mafia-row" style={{ flexWrap: 'wrap' }}>
            {teammates.map((teammate) => (
              <span key={teammate.playerId} className="mafia-badge">
                {roleInfo(teammate.roleCode).name}
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="mafia-banner mafia-banner--warn">{uz.night.targetListUnavailable}</p>

      {mySubmittedAction && <p className="mafia-hint">{uz.night.submitted}</p>}
    </div>
  );
}

export default NightScreen;
