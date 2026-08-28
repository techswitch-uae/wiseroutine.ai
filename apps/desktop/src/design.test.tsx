import { fireEvent, render, screen } from "@testing-library/react";
import {
  DayGrid,
  DayPicker,
  daysLabel,
  EVERY_DAY,
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
  // Done is a chip, never a dimmed row.
  expect(screen.getByText("Done")).toHaveClass("wr-chip");
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
