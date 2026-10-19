# REAL MAFIA — Frontend design system (F7a)

A dark "mafia noir" look, mobile-first at 360px width, one-handed use. No UI
library — plain CSS with CSS variables, no CSS modules (the project had none
before this slice; everything here is global classes under an `rm-` prefix
to avoid colliding with anything else).

## Tokens (`src/styles/tokens.css`)

One `:root` block, read by every component in `src/ui/` and every screen.

- **Surfaces** — `--rm-bg`, `--rm-surface-1/2/raised`, `--rm-border(-strong)`.
  Fixed dark values, not derived from Telegram's `--tg-theme-*` vars — the
  noir look is a deliberate brand choice, not theme-adaptive. (`--tg-theme-*`
  is still bound by `telegram/theme.ts`'s `bindTelegramTheme`, in case any
  native Telegram chrome outside this app's own DOM still reads it.)
- **Text** — `--rm-text-1` (primary), `--rm-text-2` (secondary/hint),
  `--rm-text-3` (faint/placeholder).
- **Accent + semantic** — `--rm-accent` (the one strong accent, a deep
  crimson), `--rm-danger`, `--rm-success`, `--rm-warn`.
- **Team colors** — `--rm-team-town/mafia/neutral`, used by
  `game/labels.ts`'s `teamColorVar()` for RoleReveal/GameEnd's per-role
  accent.
- **Spacing** — `--rm-space-1/2/3/4/6` = 4/8/12/16/24px.
- **Radii** — `--rm-radius-sm/md/lg/full`.
- **Shadows** — `--rm-shadow-card`, `--rm-shadow-raised`.
- **Type scale** — `--rm-title-*`, `--rm-heading-*`, `--rm-body-*`,
  `--rm-caption-*` (size/weight/line-height triplets), system font stack
  (`--rm-font-family`) — no webfont download.
- **Motion** — `--rm-duration-fast/base/reveal`, `--rm-ease`. All zeroed
  under `prefers-reduced-motion: reduce`.
- **Safe area** — `--rm-safe-top/bottom/left/right`, sourced from
  Telegram's own viewport inset vars (`telegram/theme.ts`'s
  `bindTelegramViewport`) when bound, falling back to the standard
  `env(safe-area-inset-*)`, then to `0`.

### Phase themes

`ui/Screen.tsx`'s `theme` prop (`'neutral' | 'night' | 'day'`) sets
`data-theme` on the screen root. `tokens.css` overrides a handful of vars
under `[data-theme='night']` (deep blue/indigo) and `[data-theme='day']`
(warm amber) — `neutral` is the un-overridden baseline (Home, Lobby,
RoleReveal, GameEnd). `NightScreen` uses `night`; `DayScreen` uses `day`.

## Components (`src/ui/`)

Every screen uses these instead of ad-hoc classNames — the old
`styles/mafia.css` (`mafia-screen`/`mafia-card`/`mafia-button`/…) is gone.

| Component | Notes |
| --- | --- |
| `Button` | `variant`: primary/secondary/danger. `loading` shows a `Spinner` over a visibility-hidden label (no layout jump) and forces `disabled`. Min height 48px. `fullWidth` defaults true. |
| `Card` | Surface container. `raised` for a card that should stand out (RoleReveal, GameEnd's winner line). |
| `Avatar` | Image or initials fallback. `ring`: `'host' \| 'you' \| 'none'` — a colored ring instead of a separate badge, for tight grids. |
| `Badge` | Small status pill. `variant`: neutral/ready/host/alive/dead. |
| `Chip` | Selectable pill row (night-action/vote target pickers) or a static label (`as="span"`, teammate role chips). Min tap target 44px as a button. |
| `Banner` | `variant`: error/info/warn. `role="alert"` on error. |
| `Screen` | Page shell. `theme` (phase theme), `title`, `footer` (sticky, above `--rm-safe-bottom`, for the one primary action a one-handed screen should keep in thumb reach). |
| `Spinner` | Standalone loading state, or embedded in `Button`. |

Two small global utility classes (`src/ui/utilities.css`, imported once in
`main.tsx`) cover the rest: `.rm-hint` (muted caption text) and `.rm-row`
(flex row of equal-width children) — a one-off `<p>` or row doesn't need a
dedicated component, but it still reads off the token scale.

## Screens touched this slice

- **Home** — logo/title/tagline, two primary actions as cards (Create /
  Join by code), a large uppercase 6-char-capped code input, short helper
  text under each action, a small `?debug=1` link.
- **Lobby** — large room code with Copy + Share (native `navigator.share`,
  falling back to copy — no deep-link URL is built, since no bot-username
  config exists to build one from), a 2-column player grid with
  avatars/ready/host badges and dashed empty-slot placeholders, an n/max
  progress bar, Ready/Start pinned in the sticky footer, Leave as a
  `danger`-variant secondary action. The dev-bots panel (`?dev=1` only) is
  now a collapsed `<details>` section.
- **RoleReveal** — a big raised `Card` with a team-color top border + glow,
  role name, team badge, ability text, teammates as avatars (initials from
  the role name — teammates carry no `displayName`, only `roleCode`). A
  520ms fade/scale-in (`@keyframes rm-reveal-in`, under the task's 600ms
  ceiling, zeroed by `prefers-reduced-motion`) plus a one-shot Telegram
  haptic tap (`telegram/haptics.ts`'s `triggerRevealHaptic`, no-op outside
  Telegram).
- **Night/Day/GameEnd** — not redesigned (out of this slice's named scope),
  but swapped onto the same `ui/` components + theme (`night`/`day`/
  `neutral`) so nothing on these screens still reads the old ad-hoc classes.

## Accessibility

- Every `Button`/`Chip`-as-button has a ≥44px tap target (`Button` is 48px).
- Visible focus rings (`:focus-visible`, 2px, accent-colored) on buttons,
  chips, and the home code input.
- `Avatar`'s initials/role-name text is `aria-hidden` — the surrounding
  text (display name, role chip label) already carries the same
  information for a screen reader.
- `Banner`'s error variant sets `role="alert"`.
- Text colors (`--rm-text-1/2` on `--rm-bg`/`--rm-surface-*`) were picked
  for ≥4.5:1 contrast against the dark surfaces they sit on.

## What this slice did not touch

Store logic, API calls, routing, and `DebugScreen.tsx` (`?debug=1`, a raw
developer tool with no styling of its own) are all unchanged — this was a
presentation-only slice per its own scope.
