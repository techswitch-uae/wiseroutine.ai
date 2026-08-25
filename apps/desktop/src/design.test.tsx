import { render, screen } from "@testing-library/react";
import { Slot } from "@wiseroutine/design";
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
  // Meetings carry no category rule — the user cannot act on them.
  expect(container.querySelector(".wr-slot-meeting .wr-rule")).toBeNull();
});
