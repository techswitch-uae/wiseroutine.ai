# Setup — databases

Two tiers: one shared **directory** (login, sessions, billing, the cron
coordination table) and **one database per user** (everything they own).

| | directory | user databases |
|---|---|---|
| **local** | `turso dev` :41080 | `turso dev` :41081 — one database shared by every local user |
| **dev** | `wiseroutine-directory-dev` | group `users-dev`, one per user |
| **production** | `wiseroutine-directory` | group `users`, one per user |

---

## 1. Install the CLI

Needed for local development and for `pnpm test`.

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
```

## 2. Local

```bash
mkdir -p .turso-local
turso dev --port 41080 --db-file .turso-local/wiseroutine-directory.db &
turso dev --port 41081 --db-file .turso-local/wiseroutine-user.db &

turso db shell http://127.0.0.1:41080 < packages/db/migrations/directory/0001_init.sql
turso db shell http://127.0.0.1:41081 < packages/db/migrations/user/0001_init.sql
```

`--db-file` matters. Without it `turso dev` is in-memory, so every restart
loses the schema *and* your account, and you re-run both migrations each time.

Both migrations are needed. The user database also migrates itself at signup,
so the second is belt-and-braces — but without it the first request against a
user database fails and `pnpm api` gives you no hint why.

Run them once. `applyMigrations` records what it has applied, so re-running is
a no-op.

`pnpm test` starts its own pair on the same ports and migrates them itself
(`apps/api/vitest.globalSetup.ts`) — deliberately in-memory, so each run starts
clean. Stop your dev servers before running the suite, or the ports collide.

### If a port is taken

41080/41081 are used because low ports are magnets — 8080 for Docker, uvicorn,
Spring and Jenkins, 8081 for Expo — and anything in the 3000-9000 range is
likely to be another project of yours. Worth knowing how this fails: `turso dev` binds `*:PORT`
while most servers bind `127.0.0.1:PORT`, and the specific bind wins. So
`turso dev` reports success, and the Worker silently talks to whatever else is
there.

```bash
lsof -nP -iTCP:41080 -sTCP:LISTEN
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:41080/health   # 200 from sqld
```

To change them, update `apps/api/wrangler.jsonc` (top-level `vars`),
`apps/api/vitest.config.ts`, `apps/api/vitest.globalSetup.ts` and
`apps/api/src/test-support.ts`.

**What local cannot show you:** `turso dev` serves one database, so every local
user shares it. Signup provisioning and tenant isolation are first exercised in
dev.

## 3. Dev

```bash
turso group create users-dev
turso db create wiseroutine-directory-dev --group users-dev
turso db shell wiseroutine-directory-dev < packages/db/migrations/directory/0001_init.sql

turso group tokens create users-dev          # -> WR_DEV_TURSO_AUTH_TOKEN
turso auth api-tokens mint wiseroutine-dev   # -> WR_DEV_TURSO_PLATFORM_TOKEN
turso db show wiseroutine-directory-dev --url
```

## 4. Production

```bash
turso group create users
turso db create wiseroutine-directory --group users
turso db shell wiseroutine-directory < packages/db/migrations/directory/0001_init.sql

turso group tokens create users              # -> WR_PROD_TURSO_AUTH_TOKEN
turso auth api-tokens mint wiseroutine       # -> WR_PROD_TURSO_PLATFORM_TOKEN
turso db show wiseroutine-directory --url
```

Only the directory is migrated by hand. User databases are created **and**
migrated at signup from `USER_MIGRATIONS` — see `apps/api/src/provisioning.ts`.

Two things that catch people:

- The directory lives **inside** the same group as the user databases. The
  Worker uses one `TURSO_AUTH_TOKEN` for both tiers, so a group-scoped token
  has to reach the directory too.
- `turso group tokens create` is not `turso db tokens create`. The latter takes
  a *database* name and scopes the token to that one database.

## 5. Fill in `apps/api/wrangler.jsonc`

Per environment, under `vars`:

| var | where it comes from |
|---|---|
| `TURSO_DIRECTORY_URL` | the `turso db show … --url` output, whole |
| `TURSO_USER_HOST` | that URL's host suffix — `acme.turso.io` from `libsql://wiseroutine-directory-acme.turso.io`. Same for both environments; it identifies the org, not the environment. |
| `TURSO_ORG` | the bare slug — `acme`. Also `turso org list`. |
| `TURSO_GROUP` | `users-dev` or `users` |

The tokens go to Cloudflare, not here — see [setup-api.md](setup-api.md).

Locally `TURSO_USER_HOST` is a full `http://127.0.0.1:41081` URL rather than a
suffix. That is intentional: `userDatabaseUrl` returns an `http` host as-is,
because `turso dev` serves one database and the name has nothing to attach to.

---

## Changing the schema

```bash
# 1. Edit packages/db/prisma/{directory,user}.prisma
# 2. Emit the next migration
pnpm --filter @wiseroutine/db migrate:diff:user > packages/db/migrations/user/0002_<name>.sql
# 3. Regenerate clients and re-embed the SQL
pnpm --filter @wiseroutine/db generate
# 4. Apply it to every directory database by hand
turso db shell wiseroutine-directory-dev < packages/db/migrations/directory/0002_<name>.sql
```

**A user-schema change fans out.** New user databases pick it up at creation;
existing ones need a backfill job that walks the directory. That job does not
exist — write it before the first user-schema change after launch, not during.

**Dev and production migrate separately.** Applying to one does nothing for the
other.
