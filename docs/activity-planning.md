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
Adding an activity preserves accepted blocks. These changes do not silently
redistribute a routine already on Today; manual moves and explicit replanning
remain available, and newly planned days use the new rules.

## Manual movement

- Planned blocks remain movable, including pinned blocks and unstarted blocks
  whose original time has passed.
- Started and completed blocks cannot be moved. Dragging stopped/missed work
  uses Postpone to create a new appointment while retaining the original record.
- Pointer and keyboard movement clamp to a future five-minute grid point.
  If no room remains in the visible day, no move is submitted.
- The route rechecks lifecycle permissions and the real clock before its
  optimistic update. The server rejects past starts and occupied intervals.
- Manual choices may override **automatic spacing**, not meetings or other
  occupied slots. Moving a block pins it against a full replan.
- Undo restores the original appointment with its existing one-minute grace;
  it is not a way to submit a new past timestamp.

## Unscheduled slots (the bucket)

Both initial planning shortfalls and rearrangement failures become persisted
bucket rows, with their activity, full duration, and reason. Initial shortfalls
say **Not placed**, never pretend to have had a previous appointment.

Bucket rows do not occupy calendar time. They do consume the day's outstanding
demand, so refresh/replan neither duplicates them nor lists them again in
**To place**. Freeing time does not silently schedule them. **Choose time**
places the same row; **Drop** dismisses it for that day, including subsequent
replans. Archiving an activity also clears its older bucket entries.
Rearrangement suggestions still carry
the proposed time and use the same move validation.

## Coverage

- `packages/scheduler/src/routine.test.ts`: limits, distinct targets, all kinds,
  anchors, kept slots, short/late/crowded days, spacing and demand conservation.
- `apps/api/src/planning/routine.test.ts`: real database persistence, repeated
  plans, bucket/manual recovery, merged validation, past/running/done refusals.
- Desktop unit tests: live form limits, timeline permissions, keyboard bounds,
  and placement drag behaviour.
- `apps/desktop/e2e/routine.spec.ts`: configuration/save/reload, actual pointer
  and keyboard moves, full-day bucket recovery through the real app and API.
