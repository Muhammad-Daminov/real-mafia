import type { HTMLAttributes, ReactNode } from 'react';
import './Card.css';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  /** A card that stands out from the stack (RoleReveal's big reveal,
   * GameEnd's winner line) — slightly raised surface + shadow. */
  raised?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({ raised = false, className = '', children, ...rest }: CardProps) {
  return (
    <div {...rest} className={`rm-card${raised ? ' rm-card--raised' : ''} ${className}`.trim()}>
      {children}
    </div>
  );
}
