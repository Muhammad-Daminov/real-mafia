import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { roleInfo, teamLabel } from '../game/labels';

/**
 * F3: shown once after the game starts, when `myRoleCode` is known and not
 * yet dismissed — before the phase screen takes over (see `App.tsx`'s
 * routing). `teammates` (MAFIA/DON only, OD-025) is rendered by role code
 * only, exactly as the backend sent it — never any other player data, and
 * never logged (console or otherwise).
 */
function RoleRevealScreen() {
  const myRoleCode = useGameStore((s) => s.myRoleCode);
  const myTeam = useGameStore((s) => s.myTeam);
  const teammates = useGameStore((s) => s.teammates);
  const dismissRoleReveal = useGameStore((s) => s.dismissRoleReveal);

  if (!myRoleCode || !myTeam) return null;

  const info = roleInfo(myRoleCode);

  return (
    <div className="mafia-screen">
      <h1>{uz.roleReveal.title}</h1>
      <div className="mafia-card">
        <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{info.name}</p>
        <span className="mafia-badge">{teamLabel(myTeam)}</span>
        <p className="mafia-hint" style={{ margin: 0 }}>
          {info.ability}
        </p>

        {teammates.length > 0 && (
          <div>
            <p className="mafia-hint" style={{ margin: '0 0 6px' }}>
              {uz.roleReveal.teammatesLabel}
            </p>
            <div className="mafia-row" style={{ flexWrap: 'wrap' }}>
              {teammates.map((teammate) => (
                <span key={teammate.playerId} className="mafia-badge">
                  {roleInfo(teammate.roleCode).name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <button className="mafia-button" onClick={dismissRoleReveal}>
        {uz.roleReveal.dismiss}
      </button>
    </div>
  );
}

export default RoleRevealScreen;
