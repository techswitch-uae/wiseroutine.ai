import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AppFrame,
  agoOf,
  DAY_DENSITIES,
  DayBar,
  DayGrid,
  DayPicker,
  DEFAULT_DENSITY,
  daysLabel,
  EVERY_DAY,
  HoursMenu,
  Slot,
  WEEKDAYS,
  WEEKENDS,
} from "@wiseroutine/design";
import { expect, test } from "vitest";

// The one rule worth a test: the slot variant decides the treatment, and the
// four treatments must stay distinct. If they collapse, the timeline lies.
test("each slot variant renders its own treatment", () => {
  const { container } = render(
    <>
      <Slot variant="focus" time="09:30" name="Deep work" done />
      <Slot variant="recovery" time="13:05" name="Eye rest" />
      <Slot variant="live" time="11:00" name="Stretch" grace={0.7} />
      <Slot variant="meeting" time="10:00" name="Design review" source="O" />
    </>,
  );

  for (const v of ["focus", "recovery", "live", "meeting"]) {
    expect(container.querySelectorAll(`.wr-slot-${v}`)).toHaveLength(1);
  }
  // Done is a mark, never a dimmed row - and it still says its own name to
  // anyone not looking at it.
  expect(screen.getByLabelText("Done")).toHaveClass("wr-done");
  // Only the live slot marks its time as "now".
  expect(container.querySelectorAll(".wr-time-now")).toHaveLength(1);
  // Meetings carry no category rule - the user cannot act on them.
  expect(container.querySelector(".wr-slot-meeting .wr-rule")).toBeNull();
});

/**
 * Two things about the day grid that the timeline is wrong without.
 *
 * Both were asked of it by the activities work: a dropped activity has to be
 * able to sit *beside* what is already there rather than on top of it, and a
 * block has to be movable without a pointer.
 */
const at = (hour: number, minute = 0) => Date.UTC(2026, 0, 1, hour, minute);

const block = (
  key: string,
  startsAt: number,
  endsAt: number,
  movable = false,
) => ({
  key,
  startsAt,
  endsAt,
  movable,
  title: key,
  node: <Slot variant="recovery" time="" name={key} />,
});

/** The draggable wrapper for one block, inside one render. */
const handle = (container: HTMLElement, name: string): Element => {
  const el = container.querySelector(`[aria-label^="${name} at"]`);
  if (!el) throw new Error(`no drag handle for ${name}`);
  return el;
};

test("everything happening at once gets its own column, shortest first", () => {
  const { container } = render(
    <DayGrid
      dayStart={at(9)}
      dayEnd={at(12)}
      timeZone="UTC"
      items={[
        // Two meetings and three activities, all at 10:00 - the case the
        // activities screen can produce on any busy morning.
        block("meeting-a", at(10), at(11)),
        block("meeting-b", at(10), at(11)),
        block("stretch", at(10), at(10, 10)),
        block("eyes", at(10), at(10, 10)),
        block("water", at(10), at(10, 5)),
        block("alone", at(11, 30), at(11, 45)),
      ]}
    />,
  );

  const columns = [...container.querySelectorAll(".wr-daygrid-item")].map(
    (el) => (el as HTMLElement).style.left,
  );

  // Six at once means six columns, each one column wide and none shared.
  const clashing = columns.slice(0, 5);
  expect(new Set(clashing).size).toBe(5);

  // The block with nothing beside it keeps the whole width. Without this, one
  // clash at ten in the morning would narrow every other block in the day.
  const alone = [...container.querySelectorAll(".wr-daygrid-item")].find((el) =>
    el.textContent?.includes("alone"),
  ) as HTMLElement;
  expect(alone.style.left).toBe("0%");
  expect(alone.style.width).toBe("100%");
});

test("a movable block steps five minutes at a time from the keyboard", () => {
  const moves: [string, number, number][] = [];
  // Scoped to this render's own container: these specs share a document, and a
  // handle matched across two of them is a false failure, not a bug.
  const { container } = render(
    <DayGrid
      dayStart={at(9)}
      dayEnd={at(12)}
      timeZone="UTC"
      onMove={(key, startsAt, endsAt) => moves.push([key, startsAt, endsAt])}
      items={[
        block("stretch", at(10), at(10, 10), true),
        block("review", at(11), at(11, 30)),
      ]}
    />,
  );

  fireEvent.keyDown(handle(container, "stretch"), { key: "ArrowDown" });
  expect(moves).toEqual([["stretch", at(10, 5), at(10, 15)]]);

  // A meeting is not ours to move, so it is not a target at all.
  expect(container.querySelector('[aria-label^="review at"]')).toBeNull();
});

test("a block cannot be walked off the end of the day", () => {
  const moves: number[] = [];
  const { container } = render(
    <DayGrid
      dayStart={at(9)}
      dayEnd={at(12)}
      timeZone="UTC"
      onMove={(_key, startsAt) => moves.push(startsAt)}
      items={[block("stretch", at(11, 50), at(12), true)]}
    />,
  );

  // Already flush with the end: there is nowhere later to go, so nothing is
  // written rather than a slot being pushed past midnight.
  fireEvent.keyDown(handle(container, "stretch"), { key: "ArrowDown" });
  expect(moves).toEqual([]);
});

/**
 * The week is stored Sunday-first and read Monday-first.
 *
 * Two conventions in one control is exactly where an off-by-one hides, and the
 * cost of getting it wrong is an activity that runs on the wrong days without
 * ever saying so.
 */
test("the day picker is read Monday first, whatever order the bits are in", () => {
  const { container } = render(
    <DayPicker value={WEEKDAYS} onChange={() => {}} />,
  );

  expect(
    [...container.querySelectorAll(".wr-day")].map((el) =>
      el.getAttribute("aria-label"),
    ),
  ).toEqual([
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]);

  // Monday through Friday lit, and the weekend not - read off the mask, not
  // off the position, which is the pair that has to agree.
  expect(
    [...container.querySelectorAll(".wr-day")].map((el) =>
      el.getAttribute("aria-pressed"),
    ),
  ).toEqual(["true", "true", "true", "true", "true", "false", "false"]);
});

test("a mask is named by the set it is, not the days it lists", () => {
  expect(daysLabel(EVERY_DAY)).toBe("Every day");
  expect(daysLabel(WEEKDAYS)).toBe("Weekdays");
  expect(daysLabel(WEEKENDS)).toBe("Weekends");
  // Monday first here too, or the summary would disagree with the row above it.
  expect(daysLabel(0b0101010)).toBe("Mon, Wed & Fri");
  expect(daysLabel(1 << 2)).toBe("Tue");
  // An activity on no days never runs. Saying so is the whole point - the
  // form disables its own save on it, and the server refuses it outright.
  expect(daysLabel(0)).toBe("No days picked");
});

/**
 * The now line's label, and the one thing it has to get out of the way of.
 *
 * Only the hours carry a number on the ruler, so an hour's label is the only
 * thing this one can collide with. When they would sit on top of each other
 * the hour keeps its number: it is the fixed thing the day is read against,
 * and two numbers a few pixels apart are worse than one. The line and its dot
 * still say where now is.
 */
// Built in UTC because the grid below is told to label in UTC. Local time here
// would put every expected number an offset out, which says nothing about the
// component.
const NINE_AM = Date.UTC(2026, 0, 5, 9, 0, 0, 0);
const day = { dayStart: NINE_AM, dayEnd: NINE_AM + 8 * 3_600_000 };

test("the now label steps aside when it would land on an hour", () => {
  // 10:22 is nowhere near an hour at this scale, so both numbers are readable.
  const clear = render(
    <DayGrid {...day} timeZone="UTC" items={[]} now={NINE_AM + 82 * 60_000} />,
  );
  expect(clear.container.querySelector(".wr-daygrid-now-label")).not.toBeNull();

  // 10:01 is one minute past the hour — about four pixels at the default
  // scale, so the two numbers would be printed over each other.
  const crowded = render(
    <DayGrid {...day} timeZone="UTC" items={[]} now={NINE_AM + 61 * 60_000} />,
  );
  expect(crowded.container.querySelector(".wr-daygrid-now-label")).toBeNull();
  // The line itself never goes: losing the number is not losing the position.
  expect(crowded.container.querySelector(".wr-daygrid-now")).not.toBeNull();
});

test("a pinned now line shows its instant; a past day shows none", () => {
  // Pinned: the gallery and these tests need a line that stays put.
  const pinned = render(
    <DayGrid {...day} timeZone="UTC" items={[]} now={NINE_AM + 30 * 60_000} />,
  );
  expect(
    pinned.container.querySelector(".wr-daygrid-now-label")?.textContent,
  ).toBe("09:30");

  // Live: no `now` prop at all. The day is in the past here, so the line is
  // correctly absent rather than pinned to nothing — which is also the guard
  // that keeps it off yesterday's grid.
  const live = render(<DayGrid {...day} timeZone="UTC" items={[]} />);
  expect(live.container.querySelector(".wr-daygrid-now")).toBeNull();
});

/**
 * "Synced 2 min ago" - the one thing the refresh button could never say for
 * itself. Coarse on purpose: it answers "is this current?", and a number that
 * ticks every second invites you to watch it rather than believe it.
 */
const AGO = Date.UTC(2026, 7, 27, 12, 0, 0);
const ago = (seconds: number) => agoOf(AGO - seconds * 1000, AGO);

test("how long ago is said in the fewest words that are still true", () => {
  expect(ago(0)).toBe("just now");
  expect(ago(44)).toBe("just now");
  expect(ago(60)).toBe("1 min ago");
  expect(ago(2 * 60)).toBe("2 min ago");
  expect(ago(59 * 60)).toBe("59 min ago");
  expect(ago(90 * 60)).toBe("2 hr ago");
  expect(ago(25 * 3600)).toBe("yesterday");
  expect(ago(3 * 86_400)).toBe("3 days ago");
});

test("a clock that has drifted backwards does not sync in the future", () => {
  expect(agoOf(AGO + 60_000, AGO)).toBe("just now");
});

test("the day bar keeps the controls together and the status with them", () => {
  const { container } = render(
    <DayBar
      hours={<button type="button">Hours shown</button>}
      date="Tuesday, 11 August"
      span="08:30–17:30"
      syncedAt={AGO - 2 * 60_000}
      now={AGO}
      onRefresh={() => undefined}
    />,
  );

  // One group holding both controls and the status - the whole point is that
  // they are one object rather than two ends of a header.
  const tools = container.querySelector(".wr-daybar-tools") as HTMLElement;
  expect(
    tools.querySelector("button[aria-label='Sync calendars now']"),
  ).not.toBeNull();
  expect(tools).toHaveTextContent("Hours shown");
  expect(tools).toHaveTextContent("Synced 2 min ago");

  // It changes on its own, so it has to announce itself.
  expect(container.querySelector("[role='status']")).toHaveTextContent(
    "Synced 2 min ago",
  );
});

test("a day nothing has ever synced says nothing about syncing", () => {
  // "Never" is not news to someone who has not connected a calendar yet.
  const { container } = render(
    <DayBar
      date="Tuesday, 11 August"
      syncedAt={null}
      now={AGO}
      onRefresh={() => undefined}
    />,
  );
  expect(container.querySelector(".wr-daybar-sync")).toBeNull();
  expect(container.querySelector(".wr-daybar-split")).toBeNull();
});

test("while syncing, the bar says so rather than reporting a stale time", () => {
  // Scoped to this render: these specs share a document, and a status matched
  // across two of them is a false failure rather than a bug.
  const { container } = render(
    <DayBar
      date="Tuesday, 11 August"
      syncing
      syncedAt={AGO - 60 * 60_000}
      now={AGO}
      onRefresh={() => undefined}
    />,
  );
  expect(container.querySelector("[role='status']")).toHaveTextContent(
    "Syncing…",
  );
  expect(
    container.querySelector("button[aria-label='Syncing your calendars']"),
  ).toBeDisabled();
});

/**
 * The hours popover, and the row height that now lives in it.
 *
 * Two lists of radio rows in one 300px box is exactly the arrangement that
 * reads as one list with six answers, so the assertion worth making is that
 * they stay two: each under its own heading, each with its own checked row.
 */
const RANGES = [
  {
    key: "working",
    label: "Working hours",
    startMinutes: 480,
    endMinutes: 1020,
  },
  { key: "full", label: "Full day", startMinutes: 0, endMinutes: 1440 },
];

test("the hours popover keeps hours and row height apart", async () => {
  const user = userEvent.setup();
  render(
    <HoursMenu
      ranges={RANGES}
      value="working"
      densities={DAY_DENSITIES}
      density={DEFAULT_DENSITY}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Hours shown" }));

  // The ranges stay a list of rows; the row height is a segmented control
  // beside them, so the two are never one list of six answers.
  const menu = screen.getByRole("menu");
  expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(
    RANGES.length,
  );

  // The category is on screen, not only in the accessibility tree - three
  // bare names with nothing over them do not say what they change.
  expect(within(menu).getByText("Row height")).toBeVisible();

  // Every density is offered, by name, and exactly one is pressed. Finding the
  // group by that name also proves the heading is what names it.
  const heights = within(screen.getByRole("group", { name: "Row height" }));
  for (const density of DAY_DENSITIES) {
    expect(heights.getByRole("button", { name: density.label })).toBeVisible();
  }
  const pressed = heights
    .getAllByRole("button")
    .filter((option) => option.getAttribute("aria-pressed") === "true");
  expect(pressed).toHaveLength(1);
  expect(pressed[0]).toHaveTextContent(
    DAY_DENSITIES.find((d) => d.key === DEFAULT_DENSITY)?.label as string,
  );
});

test("the edit link stays with the ranges it edits", async () => {
  const user = userEvent.setup();
  render(
    <HoursMenu
      ranges={RANGES}
      value="working"
      densities={DAY_DENSITIES}
      density={DEFAULT_DENSITY}
      onEdit={() => undefined}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Hours shown" }));

  const edit = screen.getByRole("button", { name: /Edit hours and ranges/ });
  const heights = screen.getByRole("group", { name: "Row height" });

  // "Edit hours and ranges" closes the list it edits. Below the row height it
  // reads as the way out of the whole popover, and as editing a thing it has
  // nothing to do with.
  expect(
    edit.compareDocumentPosition(heights) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("choosing a row height reports the key, and none of them says 'default'", async () => {
  const user = userEvent.setup();
  const chosen: string[] = [];
  render(
    <HoursMenu
      ranges={RANGES}
      value="working"
      densities={DAY_DENSITIES}
      density={DEFAULT_DENSITY}
      onDensityChange={(key) => chosen.push(key)}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Hours shown" }));
  const heights = within(screen.getByRole("group", { name: "Row height" }));
  await user.click(heights.getByRole("button", { name: "Roomy" }));
  expect(chosen).toEqual(["roomy"]);

  // Whichever of these somebody picks becomes their default, so naming one of
  // them "regular" or "default" describes the app's opinion rather than what
  // the option does.
  for (const density of DAY_DENSITIES) {
    expect(density.label.toLowerCase()).not.toMatch(/default|regular/);
  }
});

test("the popover is only the hours when no densities are offered", async () => {
  const user = userEvent.setup();
  render(<HoursMenu ranges={RANGES} value="working" />);
  await user.click(screen.getByRole("button", { name: "Hours shown" }));

  expect(
    screen.queryByRole("group", { name: "Row height" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("menuitemradio")).toHaveLength(RANGES.length);
});

/**
 * The keys a focused block answers.
 *
 * All of them live on the block rather than on the window, which is what makes
 * them safe: none can fire while someone is typing on the other side of the
 * page. That is the whole design, so it is what these check.
 */
const keyed = (
  over: Partial<{
    onStart: () => void;
    onRemove: () => void;
    movable: boolean;
  }> = {},
) => ({
  key: "stretch",
  startsAt: at(10),
  endsAt: at(10, 10),
  title: "stretch",
  node: <Slot variant="recovery" time="" name="stretch" />,
  ...over,
});

const keyedGrid = (
  item: ReturnType<typeof keyed>,
  onMove?: (key: string, startsAt: number, endsAt: number) => void,
) =>
  render(
    <DayGrid
      dayStart={at(9)}
      dayEnd={at(12)}
      timeZone="UTC"
      {...(onMove ? { onMove } : {})}
      items={[item]}
    />,
  );

test("Enter starts the block, and Delete takes it off today", () => {
  const started: string[] = [];
  const removed: string[] = [];
  const { container } = keyedGrid(
    keyed({
      onStart: () => started.push("started"),
      onRemove: () => removed.push("removed"),
    }),
  );

  const block = handle(container, "stretch");
  fireEvent.keyDown(block, { key: "Enter" });
  expect(started).toEqual(["started"]);

  fireEvent.keyDown(block, { key: "Delete" });
  // Backspace too - it is what a lot of people reach for, and on some shells
  // it is Back, so leaving it unhandled loses the page rather than the slot.
  fireEvent.keyDown(block, { key: "Backspace" });
  expect(removed).toEqual(["removed", "removed"]);
});

test("a block that offers neither key is not reachable by one", () => {
  // A finished slot: nothing to start, and removing it would erase what
  // actually happened.
  const { container } = keyedGrid(keyed());
  expect(container.querySelector('[aria-label^="stretch at"]')).toBeNull();
});

test("a block can be focused and removed without ever being movable", () => {
  const removed: string[] = [];
  const { container } = keyedGrid(keyed({ onRemove: () => removed.push("x") }));

  const block = handle(container, "stretch");
  fireEvent.keyDown(block, { key: "Delete" });
  expect(removed).toHaveLength(1);
  // Not draggable, so the arrows have nothing to say.
  fireEvent.keyDown(block, { key: "ArrowDown" });
  expect(removed).toHaveLength(1);
});

test("Escape gives the block back", () => {
  const { container } = keyedGrid(keyed({ onRemove: () => undefined }));
  const block = handle(container, "stretch") as HTMLElement;

  block.focus();
  expect(document.activeElement).toBe(block);
  fireEvent.keyDown(block, { key: "Escape" });
  expect(document.activeElement).not.toBe(block);
});

test("the label says which keys the block answers", () => {
  // Read once, on focus, and the only way anyone learns these without a mouse.
  const { container } = keyedGrid(
    keyed({
      movable: true,
      onStart: () => undefined,
      onRemove: () => undefined,
    }),
    () => undefined,
  );
  const label = handle(container, "stretch").getAttribute("aria-label");
  expect(label).toContain("arrow keys");
  expect(label).toContain("Enter");
  expect(label).toContain("Delete");
});

// A slot that has started or finished is pinned - see `movable` in lib/api.
// It keeps its other keys, so the label has to stop offering the one it no
// longer answers rather than going quiet altogether.
/**
 * The live card, where its height is its own duration.
 *
 * In a list it is the loudest card on the page. In the grid a five-minute eye
 * rest is one line of text tall, and the full-size pill and the grace bar
 * under it were drawn into that box and clipped - a Start button sliced off
 * at the bottom edge. So the bar is only drawn when a caller asks for one,
 * and the word beside the glyph is a separate element the grid can drop.
 */
test("a live slot draws no grace bar unless it is given one", () => {
  const { container } = render(
    <Slot
      variant="live"
      time="11:00"
      name="Stretch"
      onStart={() => undefined}
    />,
  );
  expect(container.querySelector(".wr-bar")).toBeNull();

  const withBar = render(
    <Slot variant="live" time="11:00" name="Stretch" grace={0.4} />,
  );
  expect(withBar.container.querySelector(".wr-bar")).toBeTruthy();
});

// Play means "this has not happened yet". A block you stopped and can go back
// to is not that, and offering the same mark for both offered a start on
// something already half-done.
test("a resumable block is offered a resume, not a start", () => {
  const { container } = render(
    <Slot
      variant="live"
      time="11:00"
      name="Stretch"
      action="resume"
      onStart={() => undefined}
    />,
  );
  expect(container.querySelector(".wr-btn")?.getAttribute("aria-label")).toBe(
    "Resume",
  );
  expect(container.querySelector(".wr-btn-word")?.textContent).toBe("Resume");
});

test("the start button keeps its name when the word is hidden", () => {
  const { container } = render(
    <Slot
      variant="live"
      time="11:00"
      name="Stretch"
      onStart={() => undefined}
    />,
  );
  const button = container.querySelector(".wr-btn");
  // The word is droppable; the accessible name is not.
  expect(button?.getAttribute("aria-label")).toBe("Start");
  expect(container.querySelector(".wr-btn-word")?.textContent).toBe("Start");
});

/**
 * Picking a block, which is what opens the rail's card about it.
 *
 * On press rather than on click, so a drag picks up what it is dragging - the
 * rail is already describing the block by the time the drop lands. And a
 * press on the day itself is how the card is put away, which is only right if
 * the blocks stop the press before it gets there.
 */
test("pressing a block picks it, and pressing the day itself un-picks", () => {
  const picked: (string | null)[] = [];
  const { container } = render(
    <DayGrid
      dayStart={at(9)}
      dayEnd={at(12)}
      timeZone="UTC"
      onBackdrop={() => picked.push(null)}
      items={[{ ...keyed(), onSelect: () => picked.push("stretch") }]}
    />,
  );

  const block = container.querySelector(".wr-daygrid-item") as HTMLElement;
  fireEvent.pointerDown(block, { button: 0 });
  expect(picked).toEqual(["stretch"]);

  // The surface behind the blocks. A press here is a press on nothing.
  fireEvent.pointerDown(container.querySelector(".wr-daygrid") as HTMLElement, {
    button: 0,
  });
  expect(picked).toEqual(["stretch", null]);
});

// A press on Start is still a press on that block: the rail should be
// describing what you just started.
test("pressing Start picks the block as well as starting it", () => {
  const picked: string[] = [];
  const started: string[] = [];
  const { container } = render(
    <DayGrid
      dayStart={at(9)}
      dayEnd={at(12)}
      timeZone="UTC"
      items={[
        {
          ...keyed(),
          onSelect: () => picked.push("stretch"),
          node: (
            <Slot
              variant="live"
              time=""
              name="stretch"
              onStart={() => started.push("stretch")}
            />
          ),
        },
      ]}
    />,
  );

  const button = container.querySelector(".wr-btn") as HTMLElement;
  fireEvent.pointerDown(button, { button: 0, bubbles: true });
  fireEvent.click(button);
  expect(picked).toEqual(["stretch"]);
  expect(started).toEqual(["stretch"]);
});

test("a pinned block does not offer a move it will refuse", () => {
  const { container } = keyedGrid(
    keyed({ onRemove: () => undefined }),
    () => undefined,
  );
  const label = handle(container, "stretch").getAttribute("aria-label");
  expect(label).not.toContain("arrow keys");
  expect(label).toContain("Delete");
});

/**
 * The three states of the rail column, which are not two.
 *
 * "No modules" and "no column" are different statements, and collapsing them
 * is what this guards: every page without modules still holds the column open
 * so a form is the same width on Settings as on Calendars, while the calendar's
 * wider scopes give it up on purpose - see `fullWidth` in `lib/rail`.
 */
const railColumn = (props: { rail?: React.ReactNode; reserveRail?: boolean }) =>
  render(
    <AppFrame sidebar={<nav />} chrome={false} {...props}>
      <div />
    </AppFrame>,
  ).container.querySelector(".wr-rail");

test("the rail column is held open for a page with no modules", () => {
  expect(railColumn({ reserveRail: true })).not.toBeNull();
});

test("a page that asks for the width gets it, column and all", () => {
  expect(railColumn({ reserveRail: false })).toBeNull();
});

test("modules always get a column, whatever the page reserved", () => {
  expect(
    railColumn({ reserveRail: false, rail: <p>Up next</p> }),
  ).not.toBeNull();
});
