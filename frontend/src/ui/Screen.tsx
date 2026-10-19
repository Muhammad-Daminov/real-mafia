import type { ReactNode } from 'react';
import './Screen.css';

export type ScreenTheme = 'neutral' | 'night' | 'day';

export interface ScreenProps {
  /** `data-theme` — `styles/tokens.css`'s phase-theme override block.
   * `neutral` (the default) covers Home/Lobby/RoleReveal/GameEnd. */
  theme?: ScreenTheme;
  title?: ReactNode;
  children: ReactNode;
  /** Pinned above the safe-area inset, for the one primary action a
   * one-handed mobile screen should always have within thumb reach
   * (task item 2/4: "fixed bottom action area above the safe inset"). A
   * screen with no single primary action (e.g. a loading state) omits
   * this and scrolls like a plain page instead. */
  footer?: ReactNode;
}

export function Screen({ theme = 'neutral', title, children, footer }: ScreenProps) {
  return (
    <div className="rm-screen" data-theme={theme}>
      <div className="rm-screen__scroll">
        {title && <h1 className="rm-screen__title">{title}</h1>}
        <div className="rm-screen__body">{children}</div>
      </div>
      {footer && <div className="rm-screen__footer">{footer}</div>}
    </div>
  );
}
