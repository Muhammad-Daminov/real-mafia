import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GamePhaseName, RoomPlayerSummary } from '../api/rooms';
import type { RoleCode } from '../api/games';
import { phaseLabel, roleInfo } from '../game/labels';
import { isAlivePlayer } from '../game/nightTargets';
import { countdownFraction, formatCountdown } from '../game/countdown';
import { triggerPhaseChangeHaptic } from '../telegram/haptics';
import { uz } from '../messages/uz';
import { Screen, type ScreenTheme } from './Screen';
import { Badge } from './Badge';
import './InGameShell.css';

export interface InGameShellProps {
  /** `'vote'` is `DayScreen`'s own VOTING sub-phase — a tenser accent
   * than plain `day`, not a separate screen or route. */
  theme: ScreenTheme;
  phase: GamePhaseName | null;
  round: number;
  phaseEndsAt: string | null;
  myRoleCode: RoleCode | null;
  /** `null` while the roster hasn't loaded yet — the alive-count badge
   * is omitted entirely rather than showing a guessed "0/0". */
  roster: RoomPlayerSummary[] | null;
  footer?: ReactNode;
  children: ReactNode;
}

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Not exported — only ever used by `InGameShell`'s own top bar (task:
 * "add new shared components only when two or more screens need them";
 * this one screen-within-a-screen doesn't qualify). An honest ring, not a
 * "time left in the phase" claim — see `countdownFraction`'s docstring. */
function CountdownRing({ display, fraction }: { display: string | null; fraction: number }) {
  const safeFraction = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const offset = CIRCUMFERENCE * (1 - safeFraction);

  return (
    <div className="rm-shell__ring" role="timer" aria-label={display ?? uz.gameScreen.noDeadline}>
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle className="rm-shell__ring-track" cx="22" cy="22" r={RADIUS} />
        {display && (
          <circle
            className="rm-shell__ring-fill"
            cx="22"
            cy="22"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
          />
        )}
      </svg>
      <span className="rm-shell__ring-text">{display ?? uz.gameScreen.noDeadline}</span>
    </div>
  );
}

/**
 * F7b: the shared chrome every in-game screen (`NightScreen`/`DayScreen`)
 * renders through — phase name + round, a countdown ring, my role chip,
 * and an alive-count badge, themed by phase (`night`/`day`/`vote`) via
 * `Screen`'s existing `data-theme` mechanism. `children` crossfades
 * (300ms, `--rm-duration-phase`, zeroed under `prefers-reduced-motion`)
 * on every `phase` change by remounting under a `phase`-keyed wrapper —
 * simpler than a transition-group dependency for a one-directional fade.
 * Also fires one haptic tap per phase change (not on first mount) and
 * never on the *very first* render of a brand new screen component,
 * since mounting already has its own entrance.
 */
/** Ticks once a second while `phaseEndsAt` is set — the same pattern
 * `game/useCountdown.ts` uses, inlined here rather than shared since this
 * is `InGameShell`'s only consumer and it needs both the display string
 * and the ring's fraction together. */
function useShellCountdown(phaseEndsAt: string | null): { display: string | null; fraction: number } {
  const [value, setValue] = useState(() => ({
    display: formatCountdown(phaseEndsAt, Date.now()),
    fraction: countdownFraction(phaseEndsAt, Date.now()),
  }));

  useEffect(() => {
    const tick = () => setValue({ display: formatCountdown(phaseEndsAt, Date.now()), fraction: countdownFraction(phaseEndsAt, Date.now()) });
    tick();

    if (!phaseEndsAt) return;

    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phaseEndsAt]);

  return value;
}

export function InGameShell({ theme, phase, round, phaseEndsAt, myRoleCode, roster, footer, children }: InGameShellProps) {
  const { display, fraction } = useShellCountdown(phaseEndsAt);
  const previousPhase = useRef(phase);

  useEffect(() => {
    if (previousPhase.current !== null && previousPhase.current !== phase) {
      triggerPhaseChangeHaptic();
    }
    previousPhase.current = phase;
  }, [phase]);

  const aliveCount = roster ? roster.filter(isAlivePlayer).length : null;

  return (
    <Screen theme={theme} footer={footer}>
      <div className="rm-shell__topbar">
        <div className="rm-shell__phase-row">
          <span className="rm-shell__phase-name">{phaseLabel(phase ?? '')}</span>
          <span className="rm-shell__round">{uz.gameScreen.round(round)}</span>
        </div>
        <div className="rm-shell__meta-row">
          <CountdownRing display={display} fraction={fraction} />
          {myRoleCode && <Badge>{roleInfo(myRoleCode).name}</Badge>}
          {aliveCount !== null && roster && (
            <Badge variant="alive">{uz.gameScreen.aliveCount(aliveCount, roster.length)}</Badge>
          )}
        </div>
      </div>

      <div key={phase} className="rm-shell__fade">
        {children}
      </div>
    </Screen>
  );
}
