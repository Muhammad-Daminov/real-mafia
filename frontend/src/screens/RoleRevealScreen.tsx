import { useEffect, type CSSProperties } from 'react';
import { uz } from '../messages/uz';
import { useGameStore } from '../store/gameStore';
import { roleInfo, teamColorVar, teamLabel } from '../game/labels';
import { triggerRevealHaptic } from '../telegram/haptics';
import { Screen, Card, Button, Badge, Avatar } from '../ui';
import './RoleRevealScreen.css';

/**
 * F3/F7a: shown once after the game starts, when `myRoleCode` is known and
 * not yet dismissed — before the phase screen takes over (see `App.tsx`'s
 * routing). `teammates` (MAFIA/DON only, OD-025) is rendered by role code
 * only, exactly as the backend sent it — never any other player data, and
 * never logged (console or otherwise). The entrance animation
 * (`RoleRevealScreen.css`'s `rm-reveal-in`) is under the task's 600ms
 * ceiling and backs off to an instant appearance under
 * `prefers-reduced-motion` (`styles/tokens.css` zeroes the duration vars
 * it uses). The haptic tap fires once per mount, matching "shown once" —
 * a no-op outside Telegram.
 */
function RoleRevealScreen() {
  const myRoleCode = useGameStore((s) => s.myRoleCode);
  const myTeam = useGameStore((s) => s.myTeam);
  const teammates = useGameStore((s) => s.teammates);
  const dismissRoleReveal = useGameStore((s) => s.dismissRoleReveal);

  useEffect(() => {
    triggerRevealHaptic();
  }, []);

  if (!myRoleCode || !myTeam) return null;

  const info = roleInfo(myRoleCode);
  const accent = teamColorVar(myTeam);

  return (
    <Screen>
      <div className="rm-reveal">
        <p className="rm-reveal__label">{uz.roleReveal.title}</p>
        <Card raised className="rm-reveal__card" style={{ '--rm-reveal-accent': accent } as CSSProperties}>
          <p className="rm-reveal__role-name">{info.name}</p>
          <Badge variant="neutral">{teamLabel(myTeam)}</Badge>
          <p className="rm-reveal__ability">{info.ability}</p>

          {teammates.length > 0 && (
            <div className="rm-reveal__teammates">
              <p className="rm-reveal__teammates-label">{uz.roleReveal.teammatesLabel}</p>
              <div className="rm-reveal__teammates-row">
                {teammates.map((teammate) => (
                  <div className="rm-reveal__teammate" key={teammate.playerId}>
                    <Avatar name={roleInfo(teammate.roleCode).name} size={36} />
                    <span className="rm-reveal__teammate-name">{roleInfo(teammate.roleCode).name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Button onClick={dismissRoleReveal}>{uz.roleReveal.dismiss}</Button>
      </div>
    </Screen>
  );
}

export default RoleRevealScreen;
