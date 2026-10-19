# REAL MAFIA — Frontend design system (F7a, extended F7b)

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
- **Motion** — `--rm-duration-fast/base/reveal/phase`, `--rm-ease`.
  `--rm-duration-phase` (300ms, F7b) is `InGameShell`'s own phase
  crossfade. All zeroed under `prefers-reduced-motion: reduce`.
- **Safe area** — `--rm-safe-top/bottom/left/right`, sourced from
  Telegram's own viewport inset vars (`telegram/theme.ts`'s
  `bindTelegramViewport`) when bound, falling back to the standard
  `env(safe-area-inset-*)`, then to `0`.

### Phase themes

`ui/Screen.tsx`'s `theme` prop (`'neutral' | 'night' | 'day' | 'vote'`)
sets `data-theme` on the screen root. `tokens.css` overrides a handful of
vars under `[data-theme='night']` (deep blue/indigo, plus a CSS-only
moon/stars backdrop — `Screen.css`'s `::before`, a handful of
`radial-gradient` dots, no images), `[data-theme='day']` (warm amber), and
`[data-theme='vote']` (F7b: a tenser red-amber, `DayScreen`'s own VOTING
sub-phase, not a separate screen/route) — `neutral` is the un-overridden
baseline (Home, Lobby, RoleReveal, GameEnd). `NightScreen` uses `night`;
`DayScreen` uses `day`, switching to `vote` only while `phase === 'VOTING'`.

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
| `InGameShell` (F7b) | Wraps `Screen` for every in-game screen (Night/Day). Top bar: phase name (uz), round, a countdown ring (`CountdownRing`, private to this file — only one consumer, doesn't meet the "two or more screens" bar for its own export), my role chip, an alive-count badge (omitted while the roster hasn't loaded). Crossfades `children` 300ms on every `phase` change (remounts under a `phase`-keyed wrapper) and fires one `triggerPhaseChangeHaptic()` per change (never on first mount). |
| `PlayerTile` (F7b) | The one player tile Night/Vote/Day's roster/GameEnd's role list all use. `layout="grid"` (square, avatar on top — target pickers) or `"row"` (horizontal strip — rosters, role-reveal list). `isYou`/`selected`/`disabled`/`caption`/`trailing` cover every state these screens need; `onClick` makes it a `<button>`, its absence a plain `<div>`. |

Two small global utility classes (`src/ui/utilities.css`, imported once in
`main.tsx`) cover the rest: `.rm-hint` (muted caption text), `.rm-row`
(flex row of equal-width children), and `.rm-tile-grid` (F7b: the
`auto-fill`/`minmax(96px, 1fr)` grid container behind `PlayerTile`'s
`grid` layout, shared by Night's target picker and Day's vote picker) —
none of these need a dedicated component, but they still read off the
token scale.

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
- **Night/Day/GameEnd (F7a)** — not redesigned (out of that slice's named
  scope), but swapped onto the same `ui/` components + theme (`night`/
  `day`/`neutral`) so nothing on these screens still read the old ad-hoc
  classes.

## F7b: deep redesign of the in-game screens

- **Night** — shelled by `InGameShell`. Dead: the shared spectator banner
  (`uz.spectator`), no controls. No night action (CIVILIAN/unrecognized):
  a calm "sleeping" card. Acting: a teammates strip (MAFIA/DON, avatars +
  role name — teammates carry no `displayName`), a `PlayerTile` grid of
  every roster entry (alive ones tappable, dead/self/excluded ones shown
  disabled with a short reason caption), the selection echoed live in the
  pinned Confirm button's own label (`uz.night.confirmWithTarget`, "Tanlash:
  <name>"), and — once submitted — a confirmation card with a "Change"
  button that clears the local selection so a new one can be made and
  resubmitted (OD-028: resubmitting mid-NIGHT always updates the existing
  action, never rejected). `game/nightTargets.ts`'s `toggleTargetSelection`
  is the pure tap-handler rule behind the grid (single-replace, or
  slide-the-oldest-out for Journalist's pair target), tested without React.
- **Day / Vote** — same shell, themed `day` normally and `vote` (tenser
  red-amber) specifically while `phase === 'VOTING'`. A morning/vote-result
  announcement card is driven by `game/dayAnnouncement.ts`'s
  `resolveDayAnnouncement` — `'deaths'` (who, by context), `'quiet'` (a
  "nobody died"/"no one eliminated" card, only shown when `lastPhaseFrom`
  confirms the relevant transition actually just happened — never a
  guessed "quiet" claim off an unrelated reconnect refetch), or `'none'`.
  A vote-context card gets a 2.6s CSS pulse (`rm-announce--pulse`,
  disabled under `prefers-reduced-motion`) — purely decorative, nothing
  downstream waits on it. The alive/dead roster is a scrollable
  (`max-height` + `overflow-y: auto`, never horizontal) list of `row`-
  layout `PlayerTile`s; the VOTING picker is the same `grid`-layout
  pattern Night uses, selection echoed in the Confirm button
  (`uz.day.confirmVoteWithTarget`, "Ovoz: <name>"), live counts shown only
  when `voteTally` is already in the store (never fetched specially for
  this).
- **GameEnd** — winner banner colored by `teamColorVar` (safe neutral
  fallback for `DRAW`/an unrecognized team), the won/lost headline, and
  the full role-reveal list grouped TOWN → MAFIA → NEUTRAL
  (`game/labels.ts`'s `groupByTeam`, any unrecognized team appended as its
  own trailing group rather than dropped) using the same `PlayerTile` row
  layout, alive/dead badge, and "you" ring. A won banner gets a one-shot
  CSS glow (`rm-end__banner--win`, disabled under `prefers-reduced-motion`)
  — the task's permitted "CSS-only celebration," no confetti library.
- **Spectator** (dead players, Night and Day alike) — the exact same
  shell and layout a live player sees, minus controls: `uz.spectator.banner`
  ("Siz o‘ldingiz, kuzatyapsiz") plus a short note, and the roster still
  shows everyone's alive/dead status. Not a separate screen/route — a
  state within `NightScreen`/`DayScreen`, gated on `myLifeStatus`.
- **Feedback** — `telegram/haptics.ts` grew three triggers alongside the
  existing `triggerRevealHaptic`: `triggerSelectHaptic` (a tile tap —
  Telegram's own `selectionChanged`), `triggerConfirmHaptic` (a
  submission — `notificationOccurred('success')`), `triggerPhaseChangeHaptic`
  (fired once per phase change by `InGameShell` itself). All no-op outside
  Telegram, same guarded-call shape as every existing bind.

## Accessibility

- Every `Button`/`Chip`-as-button has a ≥44px tap target (`Button` is 48px).
- Visible focus rings (`:focus-visible`, 2px, accent-colored) on buttons,
  chips, and the home code input.
- `Avatar`'s initials/role-name text is `aria-hidden` — the surrounding
  text (display name, role chip label) already carries the same
  information for a screen reader.
- `Banner`'s error variant sets `role="alert"`.
- Text colors (`--rm-text-1/2` on `--rm-bg`/`--rm-surface-*`) were picked
  for ≥4.5:1 contrast against the dark surfaces they sit on, including the
  `night`/`day`/`vote` theme overrides (F7b) — every one of those
  overrides only darkens `--rm-bg`/`--rm-surface-*` further, never
  lightens `--rm-text-*`, so the ratio only improves per theme.
- `InGameShell`'s countdown ring sets `role="timer"` with an `aria-label`
  of its own display text, so a screen reader announces the number, not
  an unlabeled `<svg>`.

## What this slice did not touch

Store logic, API calls, routing, and `DebugScreen.tsx` (`?debug=1`, a raw
developer tool with no styling of its own) are all unchanged — both F7a
and F7b were presentation-only slices per their own scope.
