import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  /** Shows a `Spinner` in place of `children` and forces `disabled` — the
   * label stays mounted (visually hidden, not removed) so the button's
   * width doesn't jump between the two states. */
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

/**
 * F7a: the one button every screen uses now — min 48px tap target (task's
 * own accessibility floor), `variant="danger"` for destructive actions
 * (Leave room), `loading` for an in-flight request without the label
 * disappearing (avoids the old ad-hoc `'…'`/`uz.*.creating` text swap
 * pattern reading as a layout jump).
 */
export function Button({ variant = 'primary', loading = false, fullWidth = true, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`rm-button rm-button--${variant}${fullWidth ? ' rm-button--full' : ''}${loading ? ' rm-button--loading' : ''}`}
    >
      {loading && <Spinner size={18} className="rm-button__spinner" />}
      <span className="rm-button__label">{children}</span>
    </button>
  );
}
