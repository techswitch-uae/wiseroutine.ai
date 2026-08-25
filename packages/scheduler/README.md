# @wiseroutine/scheduler

The placement engine. **Pure, zero runtime dependencies, no I/O, no clock, no
randomness** — the same input always produces the same plan.

That determinism is a product requirement, not a preference: screen 3b promises
"Pushes deep work to 12:10, still before lunch". The UI can only make that
promise if replanning is reproducible.

Because it has no dependencies it runs unchanged in the Cloudflare Worker
(authoritative planning) and in the Tauri renderer (instant preview).

## Boundary

Everything wall-clock is resolved **by the caller**. `dayStart`, `dayEnd` and
`preferredAt` all arrive as epoch-millisecond instants. No timezone logic lives
here, which is what keeps DST out of the solver.

## Parts

- `busy.ts` — turns raw calendar events into the canonical busy set: filter what
  is genuinely busy, deduplicate across calendars by `iCalUID`, merge overlaps.
  `isBusy()` is the highest-risk function in the codebase; read its comments.
- `demand.ts` — resolves an activity's minimum (count/day, duration/day,
  count/week) into "sessions owed today".
- `plan.ts` — greedy placement ordered by importance, then gap scarcity, then a
  deterministic id tie-break.

## Not here yet

`candidates()` — the ranked options with consequence diffs for quick-add
(screen 3b). Deferred until that screen exists.
