import './Avatar.css';

export type AvatarRing = 'none' | 'host' | 'you';

export interface AvatarProps {
  /** `null`/absent -> the initials fallback below. */
  imageUrl?: string | null;
  /** First letter is all that's shown — same derivation `LobbyScreen.tsx`
   * already used before this component existed. */
  name: string;
  size?: number;
  ring?: AvatarRing;
}

/**
 * F7a: image-or-initials avatar shared by Lobby's roster and RoleReveal's
 * teammate chips. `ring="host"`/`"you"` draws a colored ring around the
 * circle rather than a separate badge, for the tight player-grid layout
 * where a text badge next to every tile doesn't fit at 360px width.
 */
export function Avatar({ imageUrl, name, size = 40, ring = 'none' }: AvatarProps) {
  const initials = name.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <span
      className={`rm-avatar${ring !== 'none' ? ` rm-avatar--ring-${ring}` : ''}`}
      style={{ width: size, height: size }}
    >
      {imageUrl ? (
        <img className="rm-avatar__image" src={imageUrl} alt="" width={size} height={size} />
      ) : (
        <span className="rm-avatar__initials" style={{ fontSize: size * 0.4 }} aria-hidden="true">
          {initials}
        </span>
      )}
    </span>
  );
}
