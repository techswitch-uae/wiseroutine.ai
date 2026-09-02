# Rearranging slots after a calendar change

## The problem with replanning

Today, `realignAfterSync` responds to a conflict by calling `planDay`, which
wipes every planned slot from `now` onward and re-solves the day. That is
correct and unusable: a meeting that moves twenty minutes makes four blocks the
user had already accepted jump somewhere else, and there is no honest way to
explain any of them.

`rearrange()` ([rearrange.ts](../packages/scheduler/src/rearrange.ts)) repairs
instead. Only the slots the change actually broke are touched, earliest first,
each into whatever space is left. Every move has one meeting behind it, so the
UI can say which.

## The pass

Linear, one slot at a time, nothing loops back:

1. **Which slots are ours to move?** past / running / broken / intact
2. **Where could this one go?** candidate positions in free space
3. **Which of those are allowed?** the spacing rule, and only that
4. **Which is best?** drift, plus what a missing breather costs
5. **Do we need to ask?** window and drift decide

A slot that reaches step 3 with no candidates is bucketed and the pass moves
on. It is never reconsidered once something else has been placed — which is
what makes the result explicable and identical every time.

## Three outcomes

| Outcome | Meaning | UI |
|---|---|---|
| `moved` | Inside its window, close to home. | Applied silently |
| `suggested` | A position exists but leaves the window, or moves far enough to be a different plan. | `suggested` slot, awaits confirm |
| `blocked` | No position we would stand behind. | Bucket → widget |

## The rules

### Trigger: any overlap

A repair needs a collision, and **any** overlap counts — no edge tolerance. A
meeting that runs four minutes into a stretch has taken four minutes of it. The
earlier version ignored overlaps under five minutes and let a meeting eat the
top of a session while the app said everything was fine.

Touching is not overlapping. A meeting that ends exactly when a slot starts
does not trigger anything.

### Spacing — the only hard rule

Two sessions of the same activity must be at least
`max(MIN_SIBLING_GAP_MS, spread ? span/sessions × SPREAD_TOLERANCE : 0)` apart —
30 minutes floor, more for a `spread` activity.

Violating it produces **`blocked`, not `suggested`**. Two deep-work blocks back
to back is one long block that lies about being two; four eye rests inside an
hour is one eye rest and three interruptions. There is no version of that the
user wants, so it is never offered.

The floor applies to every activity, not just the spread ones.

### The breather — a preference, priced, and configurable

A session that starts the second a two-hour call ends is a session nobody does.
So a placement prefers to leave a gap on each side of whatever it is adjacent
to — meeting *or* another of our own sessions, because landing flush against
either is the same problem.

The rule is `BreatherRule`, passed on `RearrangeInput.breather`, all in minutes
so a settings screen can hand it over unchanged:

| Field | Default | Meaning |
|---|---|---|
| `minutes` | 5 | Wanted beside any neighbour. **0 turns the gap off.** |
| `longNeighbourMinutes` | 45 | A neighbour this long earns the longer gap. |
| `longMinutes` | 10 | Wanted beside a long neighbour. |
| `weight` | 2 | What a missing minute is worth, in minutes of drift. |

Omitted takes `DEFAULT_BREATHER`; `NO_BREATHER` is the off preset. Settings
should expose the three sizes — `weight` prices the preference rather than
describing it, and is a tuning knob, not a question to ask anyone.

`resolveBreather` fills in and clamps whatever settings hand over. A negative
gap is not a rule but a bug arriving from the edge of the system: it would make
a shortfall negative and pay a placement to sit *inside* its neighbour.

Never required. Candidates are ranked by `drift + weight × shortfall`, so a
placement will travel ten extra minutes to gain a five-minute breather but will
not cross the day for one, and a gap exactly the length of the session still
gets used.

Two things it deliberately does **not** override:

- **`Activity.bufferBeforeMeetingMinutes`** raises the floor on the leading
  side and survives the global rule being switched off. That is one user asking
  for room on one activity, and a global preference for a packed day is not a
  way to cancel it. This is why `NO_BREATHER` keeps `weight` at the default
  rather than zeroing it — zero prices *every* shortfall at nothing, including
  the buffer's, so turning the gap off would have quietly turned the buffer off
  too. Scenario `h9` is that case.
- **The spacing floor** between two sessions of one activity, which is a rule,
  not a preference, and has nothing to do with this setting.

Adjacency is measured against **merged** busy runs, so after four hours of
back-to-back meetings the breather is sized off the four hours, not off the last
thirty-minute item in it.

`h2` / `h7` / `h8` are the same day at 5 minutes, off, and 15 minutes — three
answers from one situation, which is the point of the setting being a number.

### Windows

The whole slot must fit inside one allowed region — a stretch straddling noon
is not a morning stretch. Outside → `suggested`.

A window beats any amount of cost: an activity that fits its window is placed
there however far into it we had to reach.

### Drift — the fallback, not an extra rule

Beyond `AUTO_DRIFT_MS` (60 min) → `suggested`, **but only for an activity with
no window and no spread**.

An activity that says where it wants to run has already told us what a bad
placement looks like, and distance is not it. Applying all three rules at once
made a long meeting turn every block on the day into a question — which is how
a confirmation people read becomes one they dismiss.

### No pinned state

There is no `isLocked`. A slot the user dragged into place is still a slot the
day has to make room around. Frozen means *running or already begun by the
clock*, nothing else. (`planDay` still honours `isLocked` — see Follow-ups.)

`skipped` and `missed` are past tense by definition. `cancelled` is the one
not-happening status that can sit in the future, and it frees its space.

### What counts as busy

The corpus runs `toBusyBlocks` with `BusyOptions.literal`: **if it is on the
calendar and has a duration, it takes time.** Only two things stop being busy —
cancelled and declined — because those genuinely left the calendar.

This is a deliberate reversal of the inferring behaviour still in
[busy.ts](../packages/scheduler/src/busy.ts), which treats working-location
events, all-day entries and `transparency: transparent` as free. Each of those
inferences is right often enough to be tempting and wrong often enough to
schedule a session inside something real, and only the second kind of mistake is
one the user notices. Graph has no `eventType` at all, so the same
working-location entry from Outlook is indistinguishable from a real all-day
block.

`literal` is **off by default** — `planDay` has shipped on the inferring
behaviour and switching it is a product decision, not a detail of this function.

### The bucket is never auto-filled

There is no `pending` input. A session in the bucket stays there until the user
acts on it; freed time is not quietly claimed. A "place these for me" flow is
its own piece of work with its own UI.

## Tests

[rearrange.test.ts](../packages/scheduler/src/rearrange.test.ts) — 663
assertions, two kinds.

**Invariants**, run against all 60 scenarios, true regardless of what we decide
a good repair looks like: never on top of a meeting, never on top of another
slot, never in the past or outside the day, length preserved, only slots
something actually landed on, spacing floor honoured, every movable slot gets
exactly one answer, `moved` carries no reasons and `suggested` carries at
least one, deterministic.

**Expectations**, per scenario, exact and complete — a key left out means "none
of those". A rule change that shifts a placement by five minutes fails here
rather than shipping. `it("is fully settled")` fails if any scenario lacks one.

**Unit rules**, away from any particular day, so a future "just bump the
breather" cannot pass because every scenario happened to be insensitive to it.

### Mutation results

Every rule was broken deliberately to check the suite notices:

| Mutation | Tests failed |
|---|---|
| never treat a slot as broken | 55 |
| let repairs land in the past | 22 |
| breather weight 2 → 1 | 26 |
| long breather 10 → 9 min | 21 |
| breather 5 → 4 min | 14 |
| long-meeting threshold 45 → 20 min | 12 |
| drop the spacing rule | 11 |
| blame every failure on `no_gap` | 4 |
| drop the window rule | 3 |
| let two repairs claim one gap | 3 |
| ignore overlaps under 5 minutes | 3 |
| drift line 60 → 61 min | 2 |
| sibling floor 30 → 29 min | 2 |
| spread tolerance 0.6 → 0.5 | 2 |
| stop letting spread supersede drift | 2 |
| drop the started-by-clock freeze | 1 |

And again once the gap rule became configurable:

| Mutation | Tests failed |
|---|---|
| default weight 2 → 1 | 26 |
| default long gap 10 → 9 min | 21 |
| default gap 5 → 4 min | 13 |
| long-neighbour threshold 45 → 20 min | 12 |
| ignore the configured rule | 3 |
| `NO_BREATHER` zeroes the weight | 2 |
| skip clamping the gap size | 1 |

## Deliberate limits

- **A repair never evicts a healthy slot.** It takes free space only, so a
  displaced block can end up worse off than one that was fine. Predictable, and
  a repair can never ripple further than the meeting that caused it. Upgrade
  path: a second pass allowing one level of displacement (`d5` is the case that
  argues for it).
- **Freed time does not pull slots back.** A cancelled meeting is only used by a
  slot that is actually broken.
- **Cross-activity crowding is not checked.** Only same-activity spacing is
  enforced; two different activities may end up back to back, subject to the
  breather.

## Open questions

Three places where the current rules and the recorded verdicts disagree. The
simulator flags all three as stale, with the old outcome shown.

1. **`a2` — moved became suggested.** The breather pushed the only landing spot
   from 11:00 to 11:10, which crosses the 60-minute drift line. Judged "ok" as a
   move *before* the breather rule existed and before `i3` confirmed the hour as
   the line. Either the drift line moves, or a2 is genuinely a question.
2. **`d3` — two placed, one bucketed.** The verdict asked for one placed and two
   bucketed. With a 30-minute spacing floor, two 50-minute blocks fit in the
   160-minute gap. Getting one would need a floor above 60 minutes.
3. **`c6` — 09:23.** Placements are minute-exact, so a breather and a spacing
   constraint can meet at an odd time. Real slots probably want snapping to
   five minutes. Not added — it is a new rule, not a bug.

## Wired up

`realignAfterSync` ([realign.ts](../apps/api/src/sync/realign.ts)) calls it now,
instead of `planDay`. The pure half — rows in, writes out — is
[repair.ts](../apps/api/src/planning/repair.ts), so the translation can be
tested away from a database; the placement rules stay tested here.

Three outcomes, two things a database can hold:

| Outcome | What happens |
|---|---|
| `moved` | `moveSlot`, actor `system`, reason `calendar_change`. |
| `suggested` | Bucketed, carrying the position on the log's `to_starts_at`. |
| `blocked` | Bucketed, with the reason and nothing else. |
| `frozenConflicts` | Left where it is; the conflict badge already says so. |

### The bucket is a status, not a table

`slots.status = 'bucketed'`. A session that lost its place is the same row it
always was — same activity, same length, same lifecycle log — and the log
already had the two columns the bucket needs: `reason_code` for why, and
`to_starts_at` for where we would have put it. No migration; the column has no
`CHECK`.

It holds no time, so `/today` and `/scope` leave it off the ruler and nothing
that counts what is scheduled counts it. `GET /bucket` reads it the way
`/missed` reads its list. There are no mutations of its own: `moveSlot` lifts a
slot out of the bucket, because giving it a time is what the status means, and
`cancelSlot` drops it. Accepting a suggestion is therefore one existing call
with the position the bucket handed over.

### Tested in three places, not one

[rearrange.test.ts](../packages/scheduler/src/rearrange.test.ts) is the rules,
against all 60 scenarios.
[repair.test.ts](../apps/api/src/planning/repair.test.ts) is the translation,
away from a database - the two ways it can go wrong are both silent, a
`suggested` applied as though the user agreed and a `blocked` dropped.
[realign.test.ts](../apps/api/src/sync/realign.test.ts) is the chain: the row
really moves, the bucket really fills, `/today` stops drawing it, and the
position `GET /bucket` hands back really lands when it is accepted.

The corpus itself cannot run through the last of those. 27 of the 60 scenarios
use a window (13), a `spread` (11), a configured breather (3) or the literal
busy reading (g1, g7, g8), and the schema can express none of them - so an
end-to-end run would be measuring the gap below rather than the integration.
Worth doing once `activity_windows` and `activities` can carry a policy; then
all 60 go through the real path and the two suites cannot drift.

### What the integration does not carry yet

- **No windows, no spread.** `ANYWHERE` for every activity — see the note in
  `repair.ts`. The schema change below is what unblocks it, and until then
  drift is the only rule that fires, which makes `outside_window` unreachable.
- **The breather is the default.** No settings column, so nothing to read.
- **The inferring busy reading**, matching `planDay`. Two solvers disagreeing
  about what counts as busy is worse than either answer, so `literal` stays a
  decision for both at once.
- **A bucket entry never becomes `missed`.** It sits until the user answers it
  and then falls out of the day-ranged read. Sweeping the leftovers at day end
  needs a day-end trigger, which does not exist.
- **The edge tolerance is gone.** `realignAfterSync` used to skip an overlap
  under five minutes. Any overlap is now handed to the engine, which usually
  answers a small one with a small move.

## Follow-ups

- **`planDay` and `busy.ts`.** The literal busy reading and the removal of
  pinning are corpus-level decisions so far. If they are the product's answer,
  `planDay` should adopt both — it currently infers busy-ness and honours
  `isLocked`.
- **The DB has no policy.** `ActivityWindow` stores `anchorMinutes` (a point)
  where `PlacementPolicy` wants a region, and there is no `spread` column.
  Wiring it up means adding `start_minutes`/`end_minutes` to `activity_windows`
  and `spread` to `activities`, then mapping in `planDay`.

## The simulator

```bash
pnpm sim
```

Opens `/sim`. 60 scenarios; `←` `→` between them, space steps through **the day
→ simulate the sync → rearrange**. A verdict button saves and advances; the
comment box saves on blur without advancing.

Three panels. The **grid** gives shape and proportion. The **ledger** beside it
is the diagnostic: every block on the day in time order with its range, length,
and the breather it earns as a neighbour, and between every pair the actual gap
against what the rule wanted —

```
10:00  Standup    10:00–10:30 · 30m · wants 5m either side · ← moved
       ↕ 5m · wants 5m ✓
10:35  Deep work  s1 · 10:35–11:25 · 50m · was 10:00 · drift 35m
```

On the synced step the same rows read `▲ overlapping by 30m` and `OVERLAP 4m`,
which is the only way to judge a partial overlap — a timeline at any readable
zoom cannot show four minutes. The ledger calls `breatherFor` with the scenario's own rule rather than
restating either: a diagnostic that reimplements what it diagnoses agrees with
itself and nothing else, and one that assumes the default lies about any
scenario that overrode it. The rules panel prints the rule in force and marks
it when the scenario overrode it.

Verdicts go to [scenario-verdicts.json](scenario-verdicts.json) via a
dev-server-only Vite middleware ([vite.config.ts](../apps/desktop/vite.config.ts)).
Each records the outcome it was judged against, so a verdict the engine has
since outgrown shows as stale rather than pretending to still hold.

The grid draws only what the engine counts as busy. It used to draw everything
with a "not busy" tag, which made a cancelled meeting sitting on a slot look
exactly like a conflict the engine had missed — and it got judged as one.

The route is scaffolding. Nothing links to it, and it should be deleted once the
corpus stops changing.

## Coverage

60 scenarios, each probing something no other one does.

| Group | Probes |
|---|---|
| A | plain repair: moved, extended, deleted, touching, one-minute overlap |
| B | windows: fits, overflows, blocked, two windows, straddling the edge, misconfigured |
| C | spacing: kept, nowhere far enough, two displaced, collapse, single session, spread + window, unspread floor |
| D | cascades: one meeting over three slots, two syncs at once, running out of room, chain shift, no eviction |
| E | lifecycle: running, healthy slot holds the gap, completed, cancelled, past, straddling now |
| F | boundaries: past day end, partly in the past, day nearly over, slot outliving a shortened day, future day, DST spring-forward |
| G | busy: all-day, declined, tentative, cross-calendar duplicate, cancelled, working location, free, zero-length |
| H | breathers: after long, after short, no room, before a meeting, configured buffer, not worth the trip, rule off, bigger gap, buffer outliving the setting |
| I | drift: no window, either side of the hour, moving earlier, window beats drift |
| J | malformed: unknown activity, meeting over the whole day, slot longer than the day |

### Removed as no longer applicable

- `e1-locked-slot-conflicted` / `e3-locked-slot-holds-the-only-gap` — the pinned
  state they existed to test is gone. e1 became byte-for-byte a1; e3 survives as
  `e3-healthy-slot-holds-the-only-gap`, which asks the same question without a
  lock.
- `g2-all-day-out-of-office` — under the literal reading an all-day OOO and an
  all-day birthday are one event. `g1` keeps the ambiguous case and inherits
  g2's second slot so the bucket still carries more than one entry.
- `a3-meeting-shortened` — same answer and same reason as `a4`, which also
  covers the `remove` op.
- `i1`–`i3` (owed sessions) — `pending` is gone; the bucket is the user's.
- `a5`/`a6` (edge overlap either side of five minutes) — the tolerance is gone,
  so they now test the boundary between *touching* and *one minute of overlap*.
- `h1`/`h2` (hard pre-meeting buffer) — the buffer is a preference now, so the
  H group tests the breather instead.

`f4` was rewritten: it used to put every slot in the past, so the past filter
caught them first and the `day_over` branch was never reached by any test. It
now uses a slot that outlives a working day the user shortened, which is the
only way that branch fires.

## On using AI for this

Not needed, and it would be the wrong tool. Placement is arithmetic over
intervals, and the reason a user trusts a move is that we can name the meeting
that caused it. A model producing the same answer non-deterministically would
cost us both the explanation and the tests.
