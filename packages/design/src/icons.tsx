import {
  IconAdjustmentsHorizontal,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPlayFilled,
  IconRefresh,
  IconRotateClockwise2,
  IconSettings,
  IconArrowRight as TablerArrowRight,
  type IconProps as TablerProps,
} from "@tabler/icons-react";

/**
 * The kit's icons, from Tabler.
 *
 * Hand-drawn paths until now, on the reasoning that "two shapes do not earn a
 * dependency". That held while there were two. It stopped holding somewhere
 * around the sixth, and the cost had already started showing: every glyph
 * carried its own viewBox, its own stroke width and its own optical size, so
 * a check at 1.8 sat beside a refresh at 2.75 and they did not look like they
 * came from the same hand.
 *
 * Tabler is one grid, one stroke weight, and a name for every icon the app has
 * not needed yet - which is the part that matters, because the alternative is
 * drawing the seventh one at whatever weight the sixth happened to use.
 *
 * Wrapped rather than used directly, and the wrappers are the point:
 *
 * - **`size` and `stroke` are set here**, so a caller cannot half-adopt the
 *   scale. Tabler's own default is 24 at stroke 2, which is a stroke and a
 *   half too light beside this typeface.
 * - **The names stay the app's.** `ResumeGlyph` says what it means in this
 *   product; `IconRotateClockwise2` says what it looks like. Swapping icon
 *   sets later is then this file and nothing else.
 * - **Each keeps its `<title>`**, so a glyph used without a label is still
 *   announced. Tabler emits none.
 *
 * Tree-shaken per icon, so the bundle carries the eight below and not the
 * five thousand it did not import.
 */

/**
 * A glyph, at the size and weight this kit draws them.
 *
 * The name is carried by `<title>` and deliberately *not* by `aria-label`.
 * Several of these sit inside an element that already labels the pair - the
 * done mark inside `.wr-done`, the cog inside a button with its own
 * `aria-label` - and a second label there is the same thing announced twice.
 * `<title>` names the graphic without competing with the wrapper.
 *
 * Props pass through, so a caller that has already said what the glyph means
 * can hide it outright with `aria-hidden`.
 */
const glyph =
  (
    Icon: React.FC<TablerProps>,
    label: string,
    size = 15,
  ): React.FC<TablerProps> =>
  (props) => (
    <Icon size={size} stroke={2.4} role="img" {...props}>
      <title>{label}</title>
    </Icon>
  );

/**
 * Done.
 *
 * Sits centred inside a 16px disc, so it is drawn smaller than the rest -
 * `size` is the one dimension a caller of these ever needed to vary, and
 * varying it here keeps the stroke consistent with everything else.
 */
export const CheckGlyph = glyph(IconCheck, "Done", 11);

/**
 * Pick it back up.
 *
 * A distinct mark from the play triangle on purpose: one of them means "this
 * has not happened yet" and the other means "you stopped this and can go back
 * to it". The same glyph for both left someone looking at a block they had
 * already been in and being offered a start.
 */
export const ResumeGlyph = glyph(IconRotateClockwise2, "Resume", 12);

export const PlayGlyph = glyph(IconPlayerPlayFilled, "Start", 12);

export const RefreshGlyph = glyph(IconRefresh, "Sync", 14);

/** The day-view hours control: two ruled lines with a handle on each, which
 *  is the range being moved. */
export const HoursGlyph = glyph(IconAdjustmentsHorizontal, "Hours shown");

/** Opens whatever configures the thing beside it. */
export const SettingsGlyph = glyph(IconSettings, "Settings", 14);

/** Onward - the one arrow the kit draws. */
export const ForwardGlyph = glyph(TablerArrowRight, "Next", 16);

export const ChevronLeftGlyph = glyph(IconChevronLeft, "Previous", 16);
export const ChevronRightGlyph = glyph(IconChevronRight, "Next", 16);

/**
 * The arrow itself, unwrapped.
 *
 * For the one place that draws an icon inline *after* text inside a button
 * that already has a name - "Edit hours and ranges →". A wrapped glyph would
 * add a `<title>`, and a title inside a labelled button is that button's name
 * read out twice.
 */
export const IconArrowRight = TablerArrowRight;
