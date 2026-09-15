# Capture, inbox and rescheduling

## What changed

Quick Add is now a core application feature, not a client of an optional todo addon. It captures text, HTTP(S) links and multiple arbitrary files, schedules existing activities or todos, and keeps unplanned work in **Inbox**. Free/Pro prices and existing capabilities are unchanged; manual capture does not enable Pro automatic planning or bypass active-activity limits.

The previous flow could depend on an addon for unplanned capture, create a todo before its placement succeeded, lose a failed draft, strand linked todos after slot changes, and overlook conflicts or cross-midnight occupancy. These paths now have explicit state transitions, writer transactions and regressions.

## Everyday use

- **⌘/Ctrl K:** open Quick Add from the app shell.
- Type a task or paste a link, then **Enter, Enter** to choose it and confirm the highlighted available time.
- **⌘/Ctrl Enter:** save the capture to Inbox without assigning a time.
- **⌘/Ctrl 1–5:** schedule a displayed activity shortcut in the next available gap.
- **Attach files**, drop files/links, or paste files. Add notes only when needed; optional fields do not crowd the initial capture view.
- Pick an existing todo rather than creating another copy. Files and notes already associated with that todo remain attached.
- Choose a custom duration and date/time when suggestions do not fit. **Tab remains normal keyboard navigation.**

Inbox searches titles, notes, links and file names, pages through todos, shows their planned times, and exposes older standalone unscheduled slots. The completed/dropped filter is a history-only view. Open an item to read/edit its contents, manage attachments, mark it done, or plan/postpone it.

**Postpone / change time** is available for unstarted or explicitly stopped/missed work on the selected-slot panel, Up Next, unscheduled rows and todo details. It is never offered for a started slot, including guided-session chrome. It supports a custom appointment, 30 minutes later, tomorrow, next week, or returning work to Inbox. Times use the account's zone; missing DST times are rejected and repeated times have an occurrence choice.

These are **Wise Routine-managed slots**, not external-provider meetings. Imported Google/Microsoft meetings remain read-only. Moving those would require provider write scopes, organizer/attendee policy and real write-back acceptance; the app must not pretend that moving a local copy reschedules a meeting. Completed slot history is not moved. Recurring activity definitions are still managed in Activities.

## Reliability and data model

- `POST /capture` uses a stable intent ID. Todo creation, file claims and optional placement commit together. Replays return the original IDs; a different body under a committed ID conflicts instead of duplicating work.
- Placement checks run inside the writer transaction against occupied slots and busy meetings, including overlaps across midnight. Supported appointments are 1–480 minutes and start within the next year. Reads include slots crossing into the requested day.
- Planned/live/bucketed work moves in place. Started work cannot be postponed or implicitly stopped by rescheduling, bucketing or removal. **Stop** is available strictly before `actual Start + min(slot duration / 2, 2 minutes)`, capped at the slot's scheduled end. An early Stop records a skip and unlocks Postpone; after the cutoff users can create another slot. Completion remains available, and after the slot ends the existing “It didn't happen” recovery action remains available. Postponing skipped/missed work creates a new appointment and retains the old history. The current todo keeps its notes, links, files and activity identity; late actions on an old appointment cannot finish or reopen its newer appointment.
- Completion closes the current linked todo. Skipping, missing or removing an appointment reopens it; bucketing retains its link without falsely reporting it as scheduled. Duration changes remain consistent with the current todo/appointment.
- Stop timing comes from the durable lifecycle Start event, also exposed on `/today`; refresh/restart and repeated Start delivery do not renew it. Offline actions retain their recorded times, and a real stop/resume starts a new short window. Missing start evidence on an old cache does not invent permission to stop. The UI refreshes at the cutoff and on focus/visibility changes; the writer transaction validates lifecycle changes and rescheduling independently of the UI.
- Grace work uses the existing durable write-ahead scheduling mechanism. No cross-database atomicity or suspended-webview guarantee is implied.
- Quick Add drafts, including `File` objects, are stored in account-keyed IndexedDB. Writes/deletion are serialized; database operations have deadlines. Custom duration and the last unconfirmed appointment survive reopening. **Retry previous save** uses the original time instead of silently picking a new gap. Corrupt/unavailable draft storage produces a warning rather than being treated as saved.
- A session snapshot fences the entire capture/edit/export workflow, including local-storage waits between HTTP requests. Token replacement cannot redirect an old draft into the next account. Rescheduling keeps one idempotency key across edited retries, and errors show the server's actionable explanation.
- Online capture failure keeps the draft and upload IDs. Retrying clears only unclaimed staging and re-uploads the current file selection, so removed files do not consume that intent's quota; already claimed files survive. This is not background offline upload: reopen and retry when online. Closing the palette waits for a local draft save; hard process termination can still precede the short autosave interval. Local drafts are device-local, not synced or encrypted by a new application-level encryption scheme.
- Todo-detail edits require an explicit save. Unconfirmed later file uploads retain retry IDs while that panel is open; closing with unsaved work requires confirmation. Successfully accepted files are not undone by clearing the retry queue. Local cancellation or a lost response cannot recall an accepted server write.

## Attachment boundaries

Current technical limits apply equally to both plans:

| Limit | Value |
| --- | --- |
| Files per capture/todo | 10 |
| Individual file | 5 MiB |
| Total files per capture/todo | 20 MiB |
| Account attachment bytes | 100 MiB |
| Account file records, including empty files | 2,000 |

These are bounded initial storage limits, not a new paid addon entitlement. Names normalize path separators, controls and bidi formatting; names are limited to 200 characters. Content stays opaque: no PDF parser, OCR, thumbnail service, antivirus claim or automatic execution is introduced.

Metadata and bounded base64 chunks live in the user's private database. This avoids a new public bucket or unconfigured object-storage dependency, but base64 increases storage and this is **not an unbounded large-file architecture**. Measure production storage/backup/latency costs before expanding limits; a later private-object-store migration needs transactional lifecycle design rather than public URLs.

Uploads, quota checks and chunk writes are transactional. SHA-256 verifies downloaded bytes. Unclaimed staging records expire after 24 hours and are pruned during upload, capture or inbox activity, not by a claimed background cleanup service. File deletion removes its chunks and metadata. Dropping/completing a todo retains its contents; it is not attachment deletion.

Downloads require account authorization and the correct todo/file association. Responses are attachment-only octet streams with no-store/nosniff/sandbox headers. Addon routes cannot access the new private detail or file endpoints. Filenames are never accepted as filesystem paths. In Tauri, export uses a native Save dialog and an atomic temporary-file write; it does not open the document. HTML5 drag/drop is configured explicitly, including the Windows webview setting. These native paths still need packaged acceptance.

## Rollout and verification

Ship **`packages/db/migrations/user/0015_capture.sql`**, regenerated Prisma output and embedded migrations together with the API. The schema gate must remain enabled. The migration adds capture/file tables and todo metadata, repairs old completed/cancelled/skipped/missed/missing/bucketed associations, and preserves activity references. Back up real databases and follow [release preparation](releasing.md); no production migration or deployment was performed during this work.

Regression entry points:

- `packages/scheduler/src/slot-actions.test.ts`, `apps/api/src/slot-actions.test.ts`, and `apps/desktop/e2e/slot-actions.spec.ts`: exact stop boundaries, actual Start timing, offline replay, duplicate Start, reload, running-slot refusals, and early-stop → postpone history.
- `apps/api/src/capture.test.ts`: atomic/idempotent/concurrent capture, conflicts, lifecycle/history, quotas, partial-write rollback, private downloads, exact bytes, expiry/retry and duration consistency.
- `packages/db/src/migration-atomicity.test.ts`: real file-backed upgrade/repair and migration atomicity.
- Desktop Quick Add, draft and date helper tests: keyboard interactions, retained data, selection changes, duplicate submission, storage deadlines/order and DST handling.
- `apps/desktop/e2e/quick-capture.spec.ts`: real local Worker/libSQL/browser flow, multi-file download, scheduling, postponement, offline draft recovery and narrow-window keyboard focus.
- Native attachment validation tests in `src-tauri/src/attachments.rs`.

```sh
pnpm exec turbo run typecheck test --force
# After the workspace dependency builds, assemble browser fixture assets:
node scripts/assemble-addons.mjs
pnpm test:capture-browser
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Final local verification:

| Check | Result |
| --- | --- |
| Fresh workspace typechecks and tests | **34/34 tasks; 1,494 tests passed** |
| Desktop / API / database suites | **387 / 215 / 12 tests passed** |
| Core capture + earlier session/privacy browser regressions | **6 passed** |
| Addon browser regressions | **3 passed** |
| Native Rust tests, locked/offline | **25 passed** |
| Release configuration | **9 passed** |
| Addon tooling/promotion/catalog checks | Passed; community catalog remains empty |
| Configured frontend/dependency build | **22/22 tasks**; all six bundled addons assembled |

The browser scenarios use synthetic accounts against a real local Worker and libSQL, not live provider accounts. Quick Add was also inspected at 800×650 and 1280×720. Whole-repository lint still has the original **2 errors and 1 warning**; the broader product browser suite has not been established green. The targeted suites do not replace those open checks.

Before release, exercise actual macOS/Windows installers: file chooser, multiple-file drop/paste, Save-dialog cancellation/overwrite/error, logout/account switch, restart, interrupted requests and suspend/resume. Also validate production tenant routing, upload latency and storage costs. Browser tests and Rust helper tests do not establish native child-frame isolation, direct Tauri-command denial, installer trust or real provider write-back.

The pre-existing whole-product lint/browser findings and addon launch gates remain separate; see [project audit](project-audit.md) and [addon launch](addon-launch.md).
