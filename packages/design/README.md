# @wiseroutine/design

The Wise Routine interface kit. Two layers:

- `src/organic.css` - the **Organic** design system, synced verbatim from the
  Claude Design project (`_ds/organic-.../styles.css`). Re-sync by overwriting
  this file; the only local change is that the Google Fonts `@import` was
  dropped in favour of vendored `@fontsource` packages.
- `src/app.css` - the Wise Routine application layer (`--wr-*` tokens and
  `.wr-*` classes) derived from *Wise Routine - Components*.

`src/components.tsx` is a thin React skin over those classes. Nothing here
holds state beyond what a control needs to render.

## The rules the CSS encodes

- **Three colours.** Terracotta = recovery / the thing you can act on.
  Ink = focus, and the *one* commitment per view. Sand = everything else.
- **Depth, not outline.** Actionable sits above the page; context sinks into it.
- **Four elevations** - inset, lift-1, lift-2, lift-3. Warm-neutral shadows only.
- **No dimming.** Done = chip, Paused = hollow rule + chip, Off = inset +
  toggle, Unplanned = dashed. There is no opacity-based disabled state.
- **Dashed `#cdbe9f`** is the single "nothing here yet" treatment.
- Filled buttons use `accent-700` with white (6.8:1). The lighter `accent`
  step is for rules, dots, bars and tints only.

## Usage

```tsx
import { Button, Slot } from "@wiseroutine/design"; // also loads the tokens
```

Icons: Lucide at stroke-width 2.75. Only the inline `PlayGlyph` is vendored -
add `lucide-react` when the first screen needs more.

## Gallery

`pnpm design` from the repo root serves every component and variant at
<http://localhost:41100/design>.
