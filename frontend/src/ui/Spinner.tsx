import './Spinner.css';

export interface SpinnerProps {
  size?: number;
  className?: string;
}

/** F7a: a loading state that's never a blank screen — used standalone
 * (skeleton states) and inside `Button`'s `loading` prop. */
export function Spinner({ size = 24, className = '' }: SpinnerProps) {
  return (
    <span
      className={`rm-spinner ${className}`.trim()}
      style={{ width: size, height: size }}
      role="status"
      aria-hidden="true"
    />
  );
}
