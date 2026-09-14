import { BrandMark, Button, DayGrid, Slot } from "@wiseroutine/design";
import { useState, useSyncExternalStore } from "react";
import {
  activities,
  dayEnd,
  dayStart,
  range,
  type SampleState,
  sampleDay,
  time,
} from "../lib/sample-day";

const subscribe = () => () => {};

export function SampleDay({ id }: { id: string }) {
  // SSR shows the plan, but never offers a button before it has a handler.
  const interactive = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [state, setState] = useState<SampleState>("planned");
  const day = sampleDay(state);
  const moved = day.repair.moved[0];
  const activityName = (id: string) =>
    activities.find((activity) => activity.id === id)?.name ?? id;
  const summary =
    state === "planned"
      ? "Room found. Your routine fits around your meetings."
      : state === "full"
        ? "No room left. Your activities stay visible, not forgotten."
        : moved
          ? `${activityName(moved.activityId)} moved to ${time(moved.to.start)}. Your walk stays at ${time(day.slots.find((slot) => slot.activityId === "walk")?.start ?? dayStart)}.`
          : "Your routine is up to date.";

  return (
    <figure
      className="product-demo"
      id={id}
      aria-label="Interactive sample day"
    >
      <div className="demo-window">
        <div className="demo-toolbar">
          <span className="demo-wordmark">
            <BrandMark size={23} /> Wise Routine
          </span>
          <span className="sample-label">Interactive sample</span>
        </div>
        <div className="demo-day-heading">
          <div>
            <h2>Today</h2>
            <p>A little focus. A little fresh air.</p>
          </div>
          <span className="demo-hours">09:00–12:30</span>
        </div>
        <div
          className="demo-routine"
          role="group"
          aria-label="Your sample activities"
        >
          <span className="routine-label">Make time for</span>
          <span className="routine-pill">
            <i className="focus-dot" />
            Deep work <b>45 min</b>
          </span>
          <span className="routine-pill">
            <i className="walk-dot" />
            Walk <b>10 min</b>
          </span>
        </div>
        <div className="demo-grid" data-testid="sample-calendar">
          <DayGrid
            dayStart={dayStart}
            dayEnd={dayEnd}
            timeZone="UTC"
            now={dayStart - 1}
            quarterStep={29}
            minBlockHeight={40}
            items={[
              ...day.meetings.map((meeting) => ({
                key: meeting.id,
                startsAt: meeting.start,
                endsAt: meeting.end,
                node: (
                  <div
                    role="group"
                    data-testid={`meeting-${meeting.id}`}
                    aria-label={`${meeting.name}, ${range(meeting)}`}
                  >
                    <Slot
                      variant="meeting"
                      time={time(meeting.start)}
                      name={meeting.name}
                      meta={range(meeting)}
                    />
                  </div>
                ),
              })),
              ...day.slots.map((slot) => {
                const activity = activities.find(
                  (item) => item.id === slot.activityId,
                );
                const isMoved = day.repair.moved.some(
                  (item) => item.slotId === slot.id,
                );
                return {
                  key: slot.id,
                  startsAt: slot.start,
                  endsAt: slot.end,
                  node: (
                    <div
                      role="group"
                      data-testid={`slot-${slot.id}`}
                      aria-label={`${activity?.name}, ${range(slot)}${isMoved ? ", moved automatically" : ""}`}
                    >
                      <Slot
                        variant={
                          activity?.kind === "focus" ? "focus" : "recovery"
                        }
                        time={time(slot.start)}
                        name={activity?.name ?? slot.activityId}
                        meta={`${range(slot)}${isMoved ? " · Moved" : ""}`}
                      />
                    </div>
                  ),
                };
              }),
            ]}
          />
        </div>
        <div
          className="demo-feedback"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="feedback-symbol" aria-hidden="true">
            {state === "full" ? "!" : "↳"}
          </span>
          <div>
            <strong>{summary}</strong>
            {state === "planned" ? (
              <p>What if that first meeting runs longer?</p>
            ) : null}
            {state === "changed" && moved ? (
              <p>
                Team check-in now ends at 09:50. Only the affected slot moves.
              </p>
            ) : null}
            {day.repair.blocked.length > 0 ? (
              <ul
                className="unplaced-list"
                aria-label="Activities that could not fit"
              >
                {day.repair.blocked.map((item) => (
                  <li key={item.slotId}>
                    {activityName(item.activityId)} · Not placed
                  </li>
                ))}
              </ul>
            ) : null}
            {day.repair.suggested.map((item) => (
              <p key={item.slotId}>
                {activityName(item.activityId)} · Suggested {range(item.to)} ·
                Not confirmed
              </p>
            ))}
          </div>
        </div>
        <div className="demo-controls">
          <Button
            variant="commit"
            disabled={!interactive}
            onClick={() =>
              setState(state === "planned" ? "changed" : "planned")
            }
          >
            {state === "planned"
              ? "Extend team check-in"
              : "Restore sample day"}
            <span aria-hidden="true">{state === "planned" ? "↗" : "↺"}</span>
          </Button>
          {state === "changed" ? (
            <Button variant="quiet" onClick={() => setState("full")}>
              What if nothing fits?
            </Button>
          ) : null}
        </div>
      </div>
      <figcaption>
        Synthetic calendar, real scheduling engine. This preview does not
        connect to a calendar or demonstrate live sync speed.
      </figcaption>
      <noscript>
        <p>
          Turn on JavaScript to change the sample meeting. The initial plan is
          shown above.
        </p>
      </noscript>
    </figure>
  );
}
