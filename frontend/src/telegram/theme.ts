import {
  bindThemeParamsCssVars,
  mountThemeParamsSync,
  bindViewportCssVars,
  mountViewport,
  isViewportMounted,
  isViewportCssVarsBound,
} from '@telegram-apps/sdk';

/**
 * Binds `--tg-theme-*` CSS custom properties to `:root` from Telegram's
 * `themeParams`, kept live as the user's theme changes. No-op (never
 * throws) outside Telegram — nothing in `styles/tokens.css`'s dark "mafia
 * noir" palette reads these (F7a: the look is a deliberate brand choice,
 * not theme-adaptive), so a failed/no-op bind here has no visual effect
 * either way; kept only because some Telegram chrome outside this app's
 * own DOM (native buttons, etc.) still relies on it being bound.
 */
export function bindTelegramTheme(): void {
  try {
    mountThemeParamsSync();
    if (bindThemeParamsCssVars.isAvailable()) {
      bindThemeParamsCssVars();
    }
  } catch {
    // Not running inside Telegram, or the bridge isn't ready — ignored.
  }
}

/**
 * F7a: binds `--tg-viewport-safe-area-inset-*`/
 * `--tg-viewport-content-safe-area-inset-*` to `:root`, which
 * `styles/tokens.css`'s `--rm-safe-*` vars read in preference to the
 * standard `env(safe-area-inset-*)` (itself the fallback for plain-browser
 * dev). `mountViewport()` is async — the bind only happens once mounting
 * resolves; a failure (not in Telegram, bridge not ready, already
 * mounted/bound) is swallowed the same way `bindTelegramTheme` does,
 * since `env()`/0 are always a safe fallback.
 */
export function bindTelegramViewport(): void {
  try {
    if (isViewportMounted()) {
      if (bindViewportCssVars.isAvailable() && !isViewportCssVarsBound()) {
        bindViewportCssVars();
      }
      return;
    }
    if (!mountViewport.isAvailable()) return;
    mountViewport()
      .then(() => {
        if (bindViewportCssVars.isAvailable() && !isViewportCssVarsBound()) {
          bindViewportCssVars();
        }
      })
      .catch(() => {
        // Not in Telegram, or mounting failed — env()/0 fallback stands.
      });
  } catch {
    // Not running inside Telegram, or the bridge isn't ready — ignored.
  }
}
