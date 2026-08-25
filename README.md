# Wise Routine

Imports your Google Calendar and Outlook events, then fills the gaps with the
activities you choose — eye rest, stretching, meditation, focus blocks — and
re-adapts when the day changes.

pnpm monorepo, Turborepo task graph. Tauri 2 + TanStack Start on the front,
Cloudflare Workers + Turso (libSQL) on the back.

```
apps/
  desktop/     Tauri 2 + TanStack Start (React 19, Vite)
  api/         Cloudflare Worker — Hono, Queues, cron, webhooks
packages/
  design/      tokens, CSS and React primitives (the Organic system + our layer)
  scheduler/   the placement engine — pure, zero-dependency, golden-tested
  db/          two Prisma schemas (directory + per-user), migrations, repos
  providers/   Google + Microsoft clients over plain fetch
  plans/       free/pro capabilities and can()
  env/         validated configuration
  typescript-config/
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm design` | component gallery at <http://localhost:3100/design> |
| `pnpm dev` | `tauri dev` — the desktop app |
| `pnpm api` | `wrangler dev` — the Worker |
| `pnpm build` | web build of every app |
| `pnpm bundle` | `tauri build` — the desktop binary |
| `pnpm typecheck` / `pnpm test` / `pnpm lint` | across the workspace |

`turbo run build` depends on `test`, so tests gate every build. The API's tests
run **in workerd** via `@cloudflare/vitest-pool-workers`, against real D1 and KV
bindings and the same migrations wrangler applies in production — not a jsdom
approximation.

## The parts worth knowing

**[`packages/scheduler`](packages/scheduler/README.md)** decides where slots go.
It is pure — no clock, no randomness, no I/O — so the same day always produces
the same plan. That determinism is what lets the UI promise "this pushes deep
work to 12:10" and be right. All timezone work happens at its boundary in
`localtime.ts`; the solver only ever sees instants.

**`isBusy()` in `packages/scheduler/src/busy.ts`** decides whether the product
works at all. Google's `workingLocation` events span the whole workday and are
pure metadata — count them as busy and every user appears to have zero free
time. Declined meetings are the next trap. Read the comments before changing it.

**Sign-in is an emailed code.** Better Auth owns the `user`, `session`,
`account` and `verification` tables in the directory; `apps/api/src/auth.ts`
configures it and is mounted at `/auth`. Connecting Google or Outlook is a
*separate*, later act (`/connect/:provider`) — so an account can exist before
Google has approved anything, and the calendar refresh tokens stay
envelope-encrypted in the user's own database rather than the shared one.

**Two database tiers.** One shared *directory* holds login, sessions, billing
and the `scheduled_work` coordination table. Every user then has *their own*
database holding everything they own — which is why nothing in `src/user/`
has a `userId` column: the database is the tenant, so a query physically cannot
cross a user boundary.

The catch is that nothing can be queried across users any more. The cron ticker
cannot scan for "whose calendar is due", so the *timing* is denormalised into
the directory while the authoritative state stays with the user. Anything that
writes user state and forgets to reschedule its directory row goes quiet.

**Write discipline.** Sync compares the provider's `etag`/`changeKey` and skips
no-op writes, so an unchanged calendar costs nothing to re-sync.

**The storage boundary.** Prisma models instants as `DateTime` (its `Int` is
range-checked at 32 bits, and epoch ms is ~1.7e12), while the rest of the
codebase works in epoch-millisecond numbers. The repository layer converts, and
nothing outside `packages/db` sees a `Date`. `prisma generate` is a Turborepo
task, so the client is generated once and cached rather than on every command.

**Plan gating** lives in `packages/plans` as data, used by both sides: the
Worker enforces it, the client calls the same `can()` to decide what to disable.
There is a test per capability asserting the *server* refuses — a gate that only
exists in the UI is not a gate.

**Privacy mode.** `PATCH /settings { storeEventTitles: false }` keeps busy
intervals but no event titles, and erases the titles already stored so the
promise holds backwards as well as forwards.

## Setup

The Worker needs real infrastructure before it runs.

- [`SETUP.md`](SETUP.md) — the vendor accounts, and the one rule for secrets.
- [`docs/setup-database.md`](docs/setup-database.md) — Turso, across local, dev
  and production.
- [`docs/setup-api.md`](docs/setup-api.md) — the Worker's two deployed
  environments, and why a deploy cannot ship a broken configuration.
