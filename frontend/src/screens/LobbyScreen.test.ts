import { describe, expect, it } from 'vitest';
import { isDebugMode } from './LobbyScreen';

/**
 * F2.2: the dev-only "Fill with bots" panel's visibility gate. No React
 * Testing Library in this project (no `.test.tsx` files exist anywhere in
 * `src/`), so this tests the pure predicate `LobbyScreen.tsx` actually
 * renders the panel with (`isDebugMode(window.location.search)`), rather
 * than adding a new rendering-test dependency for one boolean check.
 */
describe('isDebugMode', () => {
  it('is true when the query string is exactly ?debug=1', () => {
    expect(isDebugMode('?debug=1')).toBe(true);
  });

  it('is true when debug=1 is one of several query params', () => {
    expect(isDebugMode('?foo=bar&debug=1&baz=1')).toBe(true);
  });

  it('is false with no query string', () => {
    expect(isDebugMode('')).toBe(false);
  });

  it('is false for any other debug value', () => {
    expect(isDebugMode('?debug=true')).toBe(false);
    expect(isDebugMode('?debug=0')).toBe(false);
    expect(isDebugMode('?debug')).toBe(false);
  });

  it('is false when debug is absent entirely', () => {
    expect(isDebugMode('?foo=bar')).toBe(false);
  });
});
