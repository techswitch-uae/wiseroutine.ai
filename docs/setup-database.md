# Setup — the databases

Turso, in two tiers. One **directory** database, shared, holding login,
sessions, billing and the coordination table the cron ticker reads. Then **one
database per user**, holding everything they own.

Three contexts, and they are genuinely different:

| | directory | user databases |
|---|---|---|
| **local** | `turso dev` on :8080 | `turso dev` on :8081 — one database, shared by every local user |
| **dev** | `wiseroutine-directory-dev` | group `users-dev`, one per user |
| **production** | `wiseroutine-directory` | group `users`, one per user |

---

## The CLI

Needed for local development and for the test suite.

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
```

## Local

`turso dev` serves exactly one database per instance, so local development
needs two of them — on the ports in `apps/api/wrangler.jsonc`:

```bash
turso dev --port 8080 &   # stands in for the directory
turso dev --port 8081 &   # stands in for every user database

turso db shell http://127.0.0.1:8080 < packages/db/migrations/directory/0001_init.sql
```

The user database migrates itself at signup, as it does everywhere else. The
directory does not, so that shell command is required before the first sign-in
or every request fails on a missing table. `pnpm test` starts and migrates both
servers itself (`apps/api/vitest.globalSetup.ts`) — the above is only for
`pnpm api`.

**What local cannot show you:** one server means one database, so every local
user shares it. Signup provisioning and tenant isolation are exercised for the
first time in dev.

## Dev and production

Same shape, different names. Do this twice.

```bash
# ── dev ──────────────────────────────────────────────────────────────────
turso group create users-dev
turso db create wiseroutine-directory-dev --group users-dev
turso db shell wiseroutine-directory-dev < packages/db/migrations/directory/0001_init.sql

turso group tokens create users-dev      # -> WR_DEV_TURSO_AUTH_TOKEN
turso auth api-tokens mint wiseroutine-dev   # -> WR_DEV_TURSO_PLATFORM_TOKEN

# ── production ───────────────────────────────────────────────────────────
turso group create users
turso db create wiseroutine-directory --group users
turso db shell wiseroutine-directory < packages/db/migrations/directory/0001_init.sql

turso group tokens create users          # -> WR_PROD_TURSO_AUTH_TOKEN
turso auth api-tokens mint wiseroutine   # -> WR_PROD_TURSO_PLATFORM_TOKEN
```

The directory lives **inside** the same group as the user databases on purpose:
the Worker uses one `TURSO_AUTH_TOKEN` for both tiers, so a token scoped to the
group has to be able to open the directory too.

Two different tokens, two different jobs:

- a **group token** (`turso group tokens create`) opens every database in the
  group. `turso db tokens create` exists too, but it takes a *database* name and
  scopes the token to that one database — not what this needs.
- a **platform token** (`turso auth api-tokens mint`) is what lets the Worker
  create a *new* database at signup.

Both go into Cloudflare Secrets Store — see [setup-api.md](setup-api.md).

Then fill in `apps/api/wrangler.jsonc` for each environment:
`TURSO_DIRECTORY_URL` (from `turso db show <name> --url`), `TURSO_USER_HOST`
(your org host suffix, e.g. `myorg.turso.io`), `TURSO_ORG`, `TURSO_GROUP`.

User databases are created and migrated automatically at signup — see
`apps/api/src/provisioning.ts`. Nothing else is created by hand.

---

## The cost of one database per user

**Schema changes now fan out.** A change to `prisma/user.prisma` has to be
applied to every existing user database, not once. New databases get it from
`USER_MIGRATIONS` at creation; existing ones need a backfill job that walks the
directory. That job does not exist yet — write it before the first user-schema
change after launch, not during.

**Nothing can query across users.** "Whose sync is failing", "how many users are
on Pro", any admin or analytics question — none of it is a SQL query any more.
The directory's `scheduled_work` table is what makes the cron ticker possible;
anything else cross-cutting needs the same treatment.

**Dev and production must be migrated separately**, including the directory. A
migration applied to one is not applied to the other.
