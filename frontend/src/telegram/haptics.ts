import {
  hapticFeedbackImpactOccurred,
  hapticFeedbackNotificationOccurred,
  hapticFeedbackSelectionChanged,
  isHapticFeedbackSupported,
} from '@telegram-apps/sdk';

/** Shared guard every trigger below runs through — no-op outside Telegram
 * (or on a client build too old to support it), same shape as
 * `telegram/theme.ts`'s binds. Never throws, never surfaces to the caller. */
function safeCall(fn: () => void): void {
  try {
    if (isHapticFeedbackSupported()) fn();
  } catch {
    // Not running inside Telegram, or the bridge isn't ready — ignored.
  }
}

/**
 * F7a: a one-shot "something dramatic just happened" tap, fired once when
 * the role card finishes revealing.
 */
export function triggerRevealHaptic(): void {
  safeCall(() => {
    if (hapticFeedbackImpactOccurred.isAvailable()) hapticFeedbackImpactOccurred('medium');
  });
}

/** F7b: a target/vote tile being tapped — Telegram's own "selection
 * changed" haptic, the lightest of the three (picking a target isn't a
 * commitment yet, unlike `triggerConfirmHaptic`). */
export function triggerSelectHaptic(): void {
  safeCall(() => {
    if (hapticFeedbackSelectionChanged.isAvailable()) hapticFeedbackSelectionChanged();
  });
}

/** F7b: a night action or vote actually submitted (not just selected) —
 * a success notification, distinct from the lighter select tap. */
export function triggerConfirmHaptic(): void {
  safeCall(() => {
    if (hapticFeedbackNotificationOccurred.isAvailable()) hapticFeedbackNotificationOccurred('success');
  });
}

/** F7b: `InGameShell`'s own phase-change tick (NIGHT -> MORNING, etc.) —
 * a firmer tap than selecting a target, since it's not something the
 * player initiated. */
export function triggerPhaseChangeHaptic(): void {
  safeCall(() => {
    if (hapticFeedbackImpactOccurred.isAvailable()) hapticFeedbackImpactOccurred('rigid');
  });
}
