import type { AddonTheme } from "@wiseroutine/addon-sdk";

/**
 * The app's own tokens, resolved, for an addon that has no access to them.
 *
 * An addon's frame is a separate document with an opaque origin. It inherits
 * no stylesheet and no custom properties, so `var(--color-text)` inside it is
 * a name for nothing and falls back to black - which is invisible on the dark
 * theme and is what "the addon looks broken in dark mode" actually is.
 *
 * Read from the live document rather than from a table of hex values kept
 * beside it, so the day someone changes a token the addons change with it.
 * `getComputedStyle` returns the *resolved* value, which is what an addon
 * needs: `color-mix(...)` would be as meaningless in that frame as the
 * variable it came from.
 */

const token = (name: string, fallback: string): string => {
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return value === "" ? fallback : value;
  } catch {
    // No document at all - a test environment, or a frame torn down between
    // the read and the reply. Fallbacks are the light theme, which is the one
    // an addon drawn against no theme at all should look least wrong in.
    return fallback;
  }
};

export const addonTheme = (): AddonTheme => ({
  text: token("--color-text", "#2e2b25"),
  muted: token("--wr-text-muted", "rgba(46, 43, 37, 0.74)"),
  background: token("--wr-page", "#f6f1e8"),
  hairline: token("--wr-hairline", "rgba(46, 43, 37, 0.1)"),
  accent: token("--color-accent-700", "#7a6a4f"),
  fontBody: token("--font-body", "system-ui, sans-serif"),
  fontHeading: token("--font-heading", "Georgia, serif"),
});
