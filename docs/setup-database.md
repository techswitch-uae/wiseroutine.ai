# Setup - databases

Two tiers: one shared **directory** (login, sessions, billing, the cron
coordination table) and **one database per user** (everything they own).

| | directory | user databases |
|---|---|---|
| **local** | `turso dev` :41080 | `turso dev` :41081 - one database shared by every local user |
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

# After both servers are listening:
pnpm --filter @wiseroutine/db generate
pnpm db:migrate --env local --directory --dry
pnpm db:migrate --env local --directory
pnpm db:migrate --env local --all-users --dry
pnpm db:migrate --env local --all-users
```

`--db-file` matters. Without it `turso dev` is in-memory, so every restart
loses the schema *and* your account, and you re-run both migrations each time.

Both tiers need the full migration chain, currently **6 directory / 16 user
migrations**. The runner records each successful migration in `_migrations`;
rerunning an already-current schema is a no-op. `--all-users` in local mode
means the single shared user endpoint, even before the first signup.

Do not initialize with raw `0001_init.sql` and then assume the migration markers
exist. If an old database was initialized by hand without `_migrations`, back it
up and reconcile its actual schema/markers before attempting a rollout.

`pnpm test` starts its own pair on **41090/41091** and migrates them itself
(`apps/api/vitest.globalSetup.ts`) - deliberately in-memory, so each run starts
clean. Separate ports on purpose: sharing 41080/41081 meant the suite quietly
ran against your development databases, seeing their leftovers and writing its
own. You can leave `pnpm api` running while you test.

If a test port is taken, the suite now refuses to start rather than talking to
whatever is there.

Everything local sits in one block, so nothing collides with another project:
41000 the app, 41001 its HMR socket, 41080 the directory, 41081 user data,
41090/41091 the same two for tests, 41100 the design gallery, 41200 the preview
server. The API stays on wrangler's own 8787.

### If a port is taken

41080/41081/41090/41091 are used because low ports are magnets - 8080 for Docker, uvicorn,
Spring and Jenkins, 8081 for Expo - and anything in the 3000-9000 range is
likely to be another project of yours. Worth knowing how this fails: `turso dev` binds `*:PORT`
while most servers bind `127.0.0.1:PORT`, and the specific bind wins. So
`turso dev` reports success, and the Worker silently talks to whatever else is
there. There is a second version of the same trap: `turso dev` is a wrapper
around `sqld`, so killing it leaves `sqld` orphaned and still holding the port.
`vitest.globalSetup.ts` kills the process group for that reason.

```bash
lsof -nP -iTCP:41080 -sTCP:LISTEN
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:41080/health   # 200 from sqld
```

To change the development ports, update `apps/api/wrangler.jsonc` (top-level
`vars`). For the test ports, `apps/api/vitest.config.ts`,
`apps/api/vitest.globalSetup.ts` and `apps/api/src/test-support.ts`.

**What local cannot show you:** `turso dev` serves one database, so every local
user shares it. Signup provisioning and tenant isolation are first exercised in
dev.

## 3. Dev

```bash
turso group create users-dev
turso db create wiseroutine-directory-dev --group users-dev

turso group tokens create users-dev          # -> WR_DEV_TURSO_AUTH_TOKEN
turso auth api-tokens mint wiseroutine-dev   # -> WR_DEV_TURSO_PLATFORM_TOKEN
turso db show wiseroutine-directory-dev --url
```

## 4. Production

```bash
turso group create users
turso db create wiseroutine-directory --group users

turso group tokens create users              # -> WR_PROD_TURSO_AUTH_TOKEN
turso auth api-tokens mint wiseroutine       # -> WR_PROD_TURSO_PLATFORM_TOKEN
turso db show wiseroutine-directory --url
```

After configuring the URLs below, run the explicit directory-first rollout
commands under **Changing the schema**. New user databases are created and
migrated at signup from `USER_MIGRATIONS`; existing users catch up on authenticated
requests and queue consumption. The migration CLI can also walk active,
provisioned accounts before deployment. None of these paths replaces a backup.

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
| `TURSO_USER_HOST` | that URL's host suffix - `acme.turso.io` from `libsql://wiseroutine-directory-acme.turso.io`. Same for both environments; it identifies the org, not the environment. |
| `TURSO_ORG` | the bare slug - `acme`. Also `turso org list`. |
| `TURSO_GROUP` | `users-dev` or `users` |

The tokens go to Cloudflare, not here - see [setup-api.md](setup-api.md).

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
```

**Select both the environment and scope explicitly.** The CLI never reads
`.dev.vars` or `.env` files. Local mode accepts only loopback HTTP endpoints
(the defaults above, or explicit `TURSO_DIRECTORY_URL` / `TURSO_USER_HOST`
overrides) and never forwards a remote token. Named environments take their URLs
only from the matching `apps/api/wrangler.jsonc` block and require an exported
`WR_DEV_TURSO_AUTH_TOKEN` / `WR_PROD_TURSO_AUTH_TOKEN`. Generic unprefixed tokens
and URL overrides are not used for a named environment.

Supply the intended group token securely in the shell, then:

```bash
pnpm db:migrate --env dev --directory --dry
pnpm db:migrate --env dev --directory
pnpm db:migrate --env dev --all-users --dry
pnpm db:migrate --env dev --all-users
# Or one active, provisioned user registered in that selected directory:
pnpm db:migrate --env dev --user DATABASE_NAME --dry
```

`--dry` connects and reads actual markers, reports pending migration names, and
performs no schema/marker writes. User-only scopes refuse a directory with
pending migrations instead of silently migrating it. Unknown markers refuse
execution; one failed user is reported while other selected users continue, and
the command exits nonzero. Incomplete provisioning and deleted accounts are not
included in the all-users rollout; check provisioning/recovery separately.

**Production is a separate approval:** after backup/recovery rehearsal and
review of the exact targets, use `--env production`. Dry runs need no write
confirmation; writes additionally require `--confirm-production`. That flag is
an operator acknowledgement, not evidence that a backup exists. See the
[database rollout and recovery runbook](database-rollout.md) before doing this.
The CLI does not deploy the Worker or certify tenant routing/live readiness.
