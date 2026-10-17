import { useGameStore } from '../store/gameStore';
import RoleRevealScreen from './RoleRevealScreen';
import NightScreen from './NightScreen';
import DayScreen from './DayScreen';
import GameEndScreen from './GameEndScreen';

/**
 * F3/F4/F5: thin router within the "game has started" shell —
 * `App.tsx` swaps this in once `currentPhase` leaves `LOBBY`. Shows
 * `RoleRevealScreen` first if the caller's role is known and not yet
 * dismissed; then `GameEndScreen` once the game has finished
 * (`status === 'FINISHED'`, checked before the phase-based routes below —
 * GAME_OVER is terminal, nothing else is reachable after it); then
 * `NightScreen` for NIGHT; `DayScreen` for everything else (MORNING/
 * DISCUSSION/VOTING/LAST_WORD/the transient resolution phases).
 */
function GameStartedScreen() {
  const status = useGameStore((s) => s.status);
  const phase = useGameStore((s) => s.phase);
  const myRoleCode = useGameStore((s) => s.myRoleCode);
  const roleRevealDismissed = useGameStore((s) => s.roleRevealDismissed);

  if (myRoleCode && !roleRevealDismissed) {
    return <RoleRevealScreen />;
  }

  // `phase === 'GAME_OVER'` updates synchronously from the PHASE_CHANGED
  // socket payload; `status === 'FINISHED'` only catches up once the
  // fire-and-forget GET /games/:gameId/state refetch that event also
  // triggers resolves — checking both avoids a brief flash of DayScreen
  // in between.
  if (status === 'FINISHED' || phase === 'GAME_OVER') {
    return <GameEndScreen />;
  }

  if (phase === 'NIGHT') {
    return <NightScreen />;
  }

  return <DayScreen />;
}

export default GameStartedScreen;
