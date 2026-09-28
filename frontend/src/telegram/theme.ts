import { bindThemeParamsCssVars, mountThemeParamsSync } from '@telegram-apps/sdk';

/**
 * Binds `--tg-theme-*` CSS custom properties to `:root` from Telegram's
 * `themeParams`, kept live as the user's theme changes. No-op (never
 * throws) outside Telegram — `styles/mafia.css` already falls back to
 * fixed colors when these vars are unset, so a failed bind just means the
 * fallback palette applies, same as the plain-browser dev fallback
 * elsewhere in this app (`telegram/initData.ts`).
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
