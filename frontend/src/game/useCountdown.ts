import { useEffect, useState } from 'react';
import { formatCountdown } from './countdown';

/** Ticks once a second while `phaseEndsAt` is set — thin stateful wrapper
 * around the pure `formatCountdown` (./countdown.ts), kept separate so the
 * actual math stays unit-testable without React. */
export function useCountdown(phaseEndsAt: string | null): string | null {
  const [display, setDisplay] = useState(() => formatCountdown(phaseEndsAt, Date.now()));

  useEffect(() => {
    setDisplay(formatCountdown(phaseEndsAt, Date.now()));

    if (!phaseEndsAt) return;

    const interval = setInterval(() => {
      setDisplay(formatCountdown(phaseEndsAt, Date.now()));
    }, 1000);

    return () => clearInterval(interval);
  }, [phaseEndsAt]);

  return display;
}
