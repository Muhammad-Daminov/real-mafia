import type { ReactNode } from 'react';
import './Chip.css';

export interface ChipProps {
  children: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Static (non-interactive) chip — role/team labels, not a picker row. */
  as?: 'button' | 'span';
}

/**
 * F7a: a selectable pill — the night-action/vote target picker rows
 * (`NightScreen.tsx`/`DayScreen.tsx`) and static labels (teammate role
 * chips) share this instead of the old "`mafia-button`, toggled via a
 * conditional `--secondary` class" pattern.
 */
export function Chip({ children, selected = false, disabled = false, onClick, as = onClick ? 'button' : 'span' }: ChipProps) {
  const className = `rm-chip${selected ? ' rm-chip--selected' : ''}`;

  if (as === 'span') {
    return <span className={className}>{children}</span>;
  }

  return (
    <button type="button" className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
