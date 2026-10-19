import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import './PlayerTile.css';

export type PlayerTileLayout = 'grid' | 'row';

export interface PlayerTileProps {
  name: string;
  imageUrl?: string | null;
  isYou?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** A disabled reason (Night/Vote pickers) or role/team text (GameEnd's
   * role-reveal list) — small, muted, under the name. */
  caption?: ReactNode;
  /** A trailing badge — alive/dead/ready/etc (`row` layout only; `grid`
   * tiles are too narrow at 360px for a second badge next to the name). */
  trailing?: ReactNode;
  /**
   * `grid`: a square tile, avatar on top — the Night/Vote target pickers'
   * tap-to-select grid. `row`: a horizontal strip — rosters, GameEnd's
   * role-reveal list. Defaults to `grid`, the shape two or more screens
   * actually needed a shared component for (task's own "add new shared
   * components only when two or more screens need them").
   */
  layout?: PlayerTileLayout;
}

/**
 * F7b: the one player tile every in-game screen uses — Night/Vote's
 * target-selection grid, Day's alive roster, GameEnd's role-reveal list.
 * `onClick` makes it a `<button>` (interactive picker row); without one
 * it's a plain `<div>` (a roster entry has nothing to tap).
 */
export function PlayerTile({ name, imageUrl, isYou = false, selected = false, disabled = false, onClick, caption, trailing, layout = 'grid' }: PlayerTileProps) {
  const className = `rm-tile rm-tile--${layout}${selected ? ' rm-tile--selected' : ''}${disabled ? ' rm-tile--disabled' : ''}`;

  const content = (
    <>
      <Avatar name={name} imageUrl={imageUrl} ring={isYou ? 'you' : 'none'} size={layout === 'grid' ? 48 : 36} />
      <span className="rm-tile__text">
        <span className="rm-tile__name">{name}</span>
        {caption && <span className="rm-tile__caption">{caption}</span>}
      </span>
      {trailing && <span className="rm-tile__trailing">{trailing}</span>}
    </>
  );

  if (!onClick) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button type="button" className={className} disabled={disabled} onClick={onClick}>
      {content}
    </button>
  );
}
