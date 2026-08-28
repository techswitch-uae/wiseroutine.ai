import { fireEvent, render, screen } from "@testing-library/react";
import { DayGrid, Slot } from "@wiseroutine/design";
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

test("everything happening at once gets its own lane, and a lone block spans them", () => {
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
        block("water", at(10), at(10, 10)),
        block("alone", at(11, 30), at(11, 45)),
      ]}
    />,
  );

  const columns = [...container.querySelectorAll(".wr-daygrid-item")].map(
    (el) => (el as HTMLElement).style.gridColumn,
  );

  // Five at once means five lanes, each one column wide and none shared.
  const clashing = columns.slice(0, 5);
  expect(new Set(clashing).size).toBe(5);
  for (const column of clashing) expect(column).toMatch(/span 1$/);

  // The block with nothing beside it keeps the whole width. Without this one
  // clash at ten in the morning would narrow every other block in the day.
  expect(columns[5]).toBe("2 / span 5");
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
