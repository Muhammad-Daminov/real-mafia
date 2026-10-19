import { hapticFeedbackImpactOccurred, isHapticFeedbackSupported } from '@telegram-apps/sdk';

/**
 * F7a/RoleReveal: a one-shot "something dramatic just happened" tap, fired
 * once when the role card finishes revealing. No-op outside Telegram (or
 * on a client build too old to support it) — `isHapticFeedbackSupported`
 * is the SDK's own capability check, same guarded-call shape as
 * `telegram/theme.ts`'s binds.
 */
export function triggerRevealHaptic(): void {
  try {
    if (isHapticFeedbackSupported() && hapticFeedbackImpactOccurred.isAvailable()) {
      hapticFeedbackImpactOccurred('medium');
    }
  } catch {
    // Not running inside Telegram, or the bridge isn't ready — ignored.
  }
}
