# Logo assets

Generated from `Wise Routine - Logo.dc.html`. Static files, for anywhere that
cannot run the React component: the marketing site, a README, an OG image, the
app icons, a slide.

**Inside the app, use `<BrandMark>` from `@wiseroutine/design` instead.** It is
the same geometry with no HTTP request, and it picks its stroke weight from the
size it is asked for.

| file | what it is |
| --- | --- |
| `mark.svg` | The mark alone, stroke 12. For 44px and up. |
| `mark-small.svg` | The mark alone, stroke 18. For 20px and down. |
| `wordmark.svg` | "Wise Routine" in ink, outlines. |
| `wordmark-on-ink.svg` | The same in cream, for dark grounds. |
| `logo.svg` | Mark + ink wordmark. The default lockup. |
| `logo-on-ink.svg` | Mark + cream wordmark. |
| `mark-mono.svg` | One-colour mark, for the macOS menu bar and anywhere monochrome. |

## The mark does not change colour

There is one mark: a terracotta disc `#c67139`, a sand arc `#f2e0bd` for booked
time, an ink arc `#2e2b25` for the slot placed in the gap after it. It sits on
sand and on ink without alteration, which is why there is no "mark on dark"
file — `mark.svg` is already it.

The only thing that varies by ground is the **wordmark**: ink `#201e1d` on
light, cream `#f5ead8` on dark.

Colours are literal, not tokens. A logo that changes because someone retuned
the interface palette is not a logo.

## The monochrome one is a template image, not a greyscale copy

`mark-mono.svg` is pure black with the two arcs told apart by opacity rather
than hue, because that is what macOS wants: it reads only the alpha channel of
a menu bar icon and paints the shape itself — dark on a light bar, light on a
dark one. One file covers both appearances.

The terracotta disc is dropped there. Flattened to one colour it is a solid
blob that says nothing, and the arcs were always the idea; without the disc
holding them in they take the room it was using.

The app's menu bar icon is generated from it into
`apps/desktop/src-tauri/icons/tray.png`.

## Why two marks

The stroke thickens as the mark shrinks — the design ships eleven sizes on that
ramp, from 12 units at 44px to 18 at 16px. It is not a detail: the two arcs are
the whole idea, and a thin stroke at 16px closes into a smudge you cannot read
as two separate things. The two files here are the ends of that ramp; for
anything in between, render `<BrandMark size={n} />` and export it.

## The wordmark is outlines, not text

Caprasimo is converted to paths, so these files need no font installed and no
webfont loaded. The trade-off is that the text is not selectable or editable —
correct for a logo, wrong for body copy.

Extracted at 15px against a 2048-unit em. Verified against the browser: the
paths measure 100.94px where live text renders 100.88px, so the outlines carry
the face's own metrics rather than an approximation.

## Regenerating

These are build outputs of a design file, not hand-drawn. If the design
changes, regenerate rather than editing the paths by hand — the outlines came
out of `@fontsource/caprasimo` with fontTools, and hand-edits will not survive
the next pass.
