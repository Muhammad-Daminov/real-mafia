import type { ReactNode } from 'react';
import './Banner.css';

export type BannerVariant = 'error' | 'warn' | 'info';

export interface BannerProps {
  variant?: BannerVariant;
  children: ReactNode;
}

export function Banner({ variant = 'info', children }: BannerProps) {
  return (
    <p className={`rm-banner rm-banner--${variant}`} role={variant === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  );
}
