import type { ReactNode } from 'react';
import './Badge.css';

export type BadgeVariant = 'neutral' | 'ready' | 'host' | 'alive' | 'dead';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

/** F7a: small status pill — ready/host/alive/dead across Lobby/Night/Day,
 * `variant="neutral"` for anything else (team name, role chip). */
export function Badge({ variant = 'neutral', children }: BadgeProps) {
  return <span className={`rm-badge rm-badge--${variant}`}>{children}</span>;
}
