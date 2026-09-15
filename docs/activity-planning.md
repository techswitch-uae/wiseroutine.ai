# Activity planning

## Duration and frequency

The activity form and API share `maxDailySessions()` in
`packages/scheduler/src/routine.ts`:

- At most 12 occurrences per day.
- At most two hours per day for a repeated activity: `floor(120 / minutes)`.
- At least one occurrence; longer single sessions remain possible through the API.

Examples: 10 minutes → 12/day, 20 → 6/day, 25–30 → 4/day, 60 → 2/day,
120 → 1/day. This is a per-activity configuration limit, **not** a guarantee
that today's meetings leave enough room.

Increasing duration clamps the form's count immediately. Decreasing it raises
the available limit but does not increase the chosen count. The API validates
merged duration/frequency on create and patch, so a duration-only update cannot
bypass the limit. Existing non-daily cadence fields are preserved by the form.

## Changes take effect tomorrow

New activities and edits to frequency, duration, days, placement preferences,
priority or meeting buffers take effect on the **next local calendar date**.
The editor shows the latest choice and its effective date; saving does not
create slots or change today's target. Repeated edits overwrite tomorrow's
choice, not today's settings and not a queue of extra occurrences.

`activity_schedules` stores effective-dated settings. Planning, repair and daily
progress resolve the version for the day being viewed. At local midnight the
new version becomes current without a cron job or a planning write; opening or
refreshing Today shows its fresh demand in **Not placed**. Dates are local to
the account, including DST and month/year boundaries, not a 24-hour delay.
Existing definitions retain their current settings as a baseline on upgrade.

Pausing/removing an activity and guided-session controls remain immediate.
Existing slots, completed work and earlier configuration versions are not
rewritten by a frequency or duration edit.

## Automatic placement and repair

Repeated activities get distinct targets across the working day, not repeated
attempts at its first free gap. Every activity kind follows the same rule.
Existing kept occurrences consume their nearest target. Morning/afternoon
anchors remain soft preferences, not forbidden regions.

Initial planning and rearrangement share the minimum clear interval between
occurrences: `max(30 minutes, working-day span / occurrences × 0.6)`.
Placement borrows edge padding when necessary to fit that spacing. It never
shortens a session or bunches several together just to empty the bucket.

Mid-day planning starts at now, while spacing still uses the full working day.
Adding or editing an activity does not run the planner. Opening an unplanned Today does
not place the routine as a side effect: it appears in **Not placed**, ready for
manual placement or **Place them for me**. That button preserves existing
placements. Reading a future day is also side-effect-free, even with weekly
planning enabled. All accepted appointments are preserved, not only manual
placements; the old full-replacement planner is gone.

Initial placement and repair use the same candidate search and score:
`distance from target + 2 × missing breathing room`. They prefer five minutes
beside a neighbour, or ten beside one lasting at least 45 minutes. The activity's
meeting buffer raises that preference before the next neighbour. Breathing room
may be borrowed to fit a **full-length** slot; occupied time and same-activity
spacing may not. Initial placement targets routine preferences; repair targets
the slot's previous time.

Calendar sync repairs only collisions. It leaves healthy slots and Not placed
alone, and cannot move or bucket a pending slot after its movement cutoff.
Manual placement is provenance ("Placed by you"), not immunity from a meeting
collision before that cutoff. The existing calendar busy interpretation is
unchanged. Engine version: **1.4.0**.

## Manual movement

- **First Start** on an unstarted slot remains available strictly until its
  scheduled end, including after the two-minute movement cutoff. Starting late
  does not move or extend the appointment.
- **Resume, dragging and Postpone** close **two minutes after the scheduled
  start**, or the slot's end if sooner. Calendar repair uses the same cutoff.
  This applies to manually placed slots too. An early Start/Stop does not renew it.
- Before the cutoff, moving an early-stopped slot updates the **same slot**
  and returns it to planned. Its Start/Stop events remain in the action log;
  there is no replacement appointment or duplicate occurrence.
- After the movement cutoff, an unstarted slot still offers **Start**, but no
  movement or Postpone. A stopped slot no longer offers Resume. At the slot's
  end, Start closes too. **Mark it done** remains available.
- Started, completed and missed slots cannot be moved. Today's Not placed
  slots remain available during the day; old daily shortfalls cannot be revived
  through a stale drag or Postpone request. Saved one-off work does not expire.
- Pointer and keyboard movement clamp to a future five-minute grid point.
  If no room remains in the visible day, no move is submitted.
- Timeline, detail widgets, open dialogs and Up next update at the cutoff,
  including after waking from sleep. The route rechecks the real clock before
  optimistic updates; the server enforces the same source-slot cutoff and
  rejects past destinations and occupied intervals. Offline Start/Resume uses
  the recorded action time, not a fresh window at replay.
- Manual choices may override **automatic spacing**, not meetings or other
  occupied slots. Explicit placement always preserves existing appointments.
- Undo restores the original appointment with its existing one-minute grace;
  it is not a way to submit a new past timestamp.

## Background and wake-up behavior

Time passing is not a placement trigger. The old per-activity grace / first-gap
move / two-retry loop has been removed. `graceMinutes` and `autoMoveCount` remain
legacy storage/API fields, not permission to move an ignored slot.

An unstarted slot stays put and displays **Time passed** only at its end. A
manually started slot becomes **Needs confirmation**, not automatically missed
an hour later. Neither path invents an outcome, creates replacement demand, or
invalidates an offline Start recorded while time remained.

Guided auto-start is still feature-gated. It may start a due slot while time
remains, never fabricate a start after waking beyond its end. Only actual
auto-start evidence permits automatic completion; changing a policy or disabling
the feature does not strand an auto-start already in flight.

The native tray retains Start now until the slot's end, then explicitly clears
the title and disables Start when no next slot remains. Native acceptance still
requires rebuilding and testing the desktop binary.

## Not placed

One widget combines the day's fresh demand with **that day's** persisted
placement shortfalls and slots displaced by rearrangement. Equal-duration occurrences of one
activity share a row. Saved slots already count against fresh demand, so there
is no duplicate list or double count. Different saved durations stay separate.

Unused daily occurrences do **not carry over**. Yesterday's saved rows remain
in history, but are excluded from today's bucket and automatic placement.
Explicit one-off tasks remain saved until handled. Reads are scoped to the
viewed day; a day change never combines new progress with stale bucket rows.

Not placed is the remaining count, not the configured total: today's placed,
completed, stopped, missed and explicitly dismissed occurrences already consume
today's target. They never reduce tomorrow's target. Three stretches and four
walks with nothing placed tomorrow produce exactly three and four fresh slots.

The widget keeps the simple draggable-row design. There is no **Drop** or
**Choose time** action: leaving slots here is fine. Drag one onto the timeline,
or use the same grip with Enter → arrow keys → Enter (Escape cancels). The
ruler remains available even when no slots or meetings have been placed yet.

**Place them for me** explicitly retries saved occurrences and fresh demand
without moving accepted placements. Saved IDs and durations survive. A longer
slot that fails does not prevent a shorter one being tried. When space runs
out, a toast explains it and remaining slots stay here, unchanged across reload
or retry. Freeing calendar time alone does not pull saved slots onto Today.

The internal `bucketed` state/API remain storage details, not another widget.
Archiving an activity clears older saved entries too. Inbox uses the same list
with a link to Today, where the timeline is available for placement.

User-facing terminology is **slot** for a Wise Routine activity occurrence and
**meeting** for a calendar event. Internal layout `Block` components are not
renamed: those describe UI geometry, not a second product concept.

## Coverage

- `packages/scheduler/src/rules-contract.test.ts`: shared placement/repair
  scoring, tight fits, pre-meeting buffers and exact repair/Start boundaries.
- `apps/api/src/features-background.test.ts`: real sweeps across the cutoff,
  repeated ticks, sleep, offline Start, guided auto-start and rollback.
- `apps/api/src/slot-window.test.ts`: first Start versus Resume, immutable
  movement boundaries in the transaction, replay and unchanged slot identity.
- `apps/desktop/e2e/late-start.spec.ts`: late Start from timeline and widget,
  real API persistence, exact end, wake and reload.

- `packages/scheduler/src/routine.test.ts`: limits, distinct targets, all kinds,
  anchors, kept slots, short/late/crowded days, spacing and demand conservation.
- `apps/api/src/planning/routine.test.ts`: real database persistence, repeated
  plans, bucket/manual recovery, merged validation, past/running/done refusals.
- `apps/api/src/planning/day-routine.test.ts`: repeated edits, unchanged history,
  local midnight/DST, fresh daily counts, old-bucket exclusion and one-off recovery.
- `apps/desktop/e2e/day-routine.spec.ts`: real editor/save/reload and date-scoped
  Not placed counts without yesterday's shortfalls.
- Desktop unit tests: live form limits, timeline permissions, merged counts,
  read failures, keyboard placement/cancellation, and pointer placement.
- `apps/desktop/e2e/routine.spec.ts`: configuration/save/reload, actual pointer
  and keyboard moves, full-day bucket recovery through the real app and API.
