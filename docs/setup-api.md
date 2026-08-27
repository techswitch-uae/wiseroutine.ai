# Setup — the API worker

Two deployed environments, `dev` and `production`, plus local. Each deployed
one is a separate Worker with its own queue, KV namespace, databases and
secrets.

**Where a value lives, decided by one question — is it a secret?**

- **No → `vars` in `apps/api/wrangler.jsonc`.** Committed, per environment.
  URLs, Turso org/group, OAuth client *IDs*, Stripe price, Resend From,
  OneSignal app ID. These ship in consent URLs, email headers or client-side
  SDK code anyway.
- **Yes → Cloudflare Secrets Store**, bound per environment in the same file.
  Nothing can read a stored secret back — not the dashboard, not us. Only a
  Worker with a binding resolves it, at runtime.

"It is a var" never means "it is optional": `RESEND_FROM` is required to send
the sign-in code. It means you edit it in `wrangler.jsonc` rather than push it.

Rotating a secret needs no deploy — update it in the store and the next isolate
picks it up.

---

## 1. Cloudflare resources

```bash
pnpm wrangler login
pnpm wrangler secrets-store store list --remote
```

One store per account, already created for you as `default_secrets_store`
(creating a second returns `maximum_stores_exceeded`). This account's id is
already in `wrangler.jsonc`: `8edcf4c1ac534aaea54bc99c6cefaec2`. It is an
identifier, not a credential.

```bash
pnpm wrangler kv namespace create CONFIG --env dev
pnpm wrangler kv namespace create CONFIG --env production
pnpm wrangler queues create wiseroutine-sync-dev
pnpm wrangler queues create wiseroutine-sync-dev-dlq
pnpm wrangler queues create wiseroutine-sync
pnpm wrangler queues create wiseroutine-sync-dlq
```

Keep the binding name `CONFIG`, and answer **no** to "connect to the remote
resource for local dev" — local uses a simulated namespace. Paste each KV `id`
into the matching environment block.

Queues need the Workers **Paid** plan ($5/mo). Secrets Store is open beta: one
store per account, 100 secrets, 1 KiB each.

## 2. Secrets

Ten per environment. Put the values in `apps/api/.env.dev` and
`apps/api/.env.prod` — both gitignored, and generated for you with every name
and its source — then:

```bash
pnpm --filter @wiseroutine/api secrets:push:dev -- --dry-run
pnpm --filter @wiseroutine/api secrets:push:dev
pnpm --filter @wiseroutine/api secrets:check:dev
```

| secret | source |
|---|---|
| `TURSO_AUTH_TOKEN` | `turso group tokens create <group>` |
| `TURSO_PLATFORM_TOKEN` | `turso auth api-tokens mint <name>` |
| `TOKEN_ROOT_KEY` | generated — see below |
| `SESSION_SECRET` | generated — see below |
| `GOOGLE_CLIENT_SECRET` | Google Cloud console |
| `MICROSOFT_CLIENT_SECRET` | Entra → Certificates & secrets |
| `STRIPE_SECRET_KEY` | Stripe — test mode for dev, live for production |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint |
| `RESEND_API_KEY` | Resend → API keys |
| `ONESIGNAL_API_KEY` | OneSignal → Keys & IDs |

Names in the file are **unprefixed**; the `WR_DEV_` / `WR_PROD_` prefix belongs
to the store, where both environments share one account namespace.

How the push behaves:

- Blank or absent → left as it is in the store, so fill the file in gradually.
- A key nothing binds → reported by name, never silently dropped.
- A key that is a *var* → told so, with where to set it instead.
- Values go over stdin, never `argv`. Nothing prints a value, only a length and
  a short SHA.

**The trade:** before these files existed, the only copy of a production secret
was inside Cloudflare. `.env.prod` is a plaintext copy on your laptop.

### The two generated ones

```bash
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"
```

`TOKEN_ROOT_KEY` envelope-encrypts per-user OAuth refresh tokens — **lose it
and every user must reconnect their calendar.** Back it up. `SESSION_SECRET`
only signs everyone out if lost. Different pair per environment.

## 3. Local

`wrangler dev` reads `apps/api/.dev.vars` (gitignored). `resolveServerEnv`
takes a plain string wherever a deployed environment hands it a binding, so the
code path is identical.

```bash
pnpm --filter @wiseroutine/api dev:vars
```

That derives `.dev.vars` from the two files that already hold the answers:
secrets from `.env.dev`, vars from the `dev` environment in `wrangler.jsonc`.
Nothing is retyped, so no value can be invented to fill a gap — it reports what
it skipped instead. Re-run it after changing either source.

Two things it deliberately does not copy: vars that already exist in the
top-level block (`.dev.vars` overrides them, so copying `APP_URL` or
`TURSO_DIRECTORY_URL` from the deployed environment would point local
development at deployed infrastructure), and anything still holding a
`REPLACE_WITH_…` placeholder.

`RESEND_API_KEY` **and** `RESEND_FROM` are both required to sign in — the
script says so by name if either is missing. Sending from your own domain needs
that domain verified in Resend first.

Anything left blank fails at its call site naming the key; the app still boots.
That leniency is local-only.

Start the two `turso dev` servers first — see
[setup-database.md](setup-database.md) — then:

```bash
pnpm api
```

## 4. Deploy

```bash
pnpm --filter @wiseroutine/api deploy:dev
pnpm --filter @wiseroutine/api deploy:prod
```

Three gates, stopping at the first failure:

1. `check-secrets.mjs` — every declared secret exists in the store. Nothing is
   uploaded otherwise.
2. `wrangler deploy` — refuses a binding it cannot wire.
3. `GET /health/config` — the deployed Worker resolves every binding and runs
   the schema over the result. Catches empty values, wrong shapes (a Resend key
   without `re_`) and any var still holding a `REPLACE_WITH_…` placeholder.

Gate 1 is pre-upload, gate 3 post-upload — so treat a gate-3 failure as "roll
back", not "nothing happened". Nothing can compare a stored secret against its
source, because Cloudflare will not disclose it.

## 5. Domains

- `api.wiseroutine.ai` and `api-dev.wiseroutine.ai` — need a CA-signed
  certificate, which Google's push channels require.
- `wiseroutine.ai` — homepage and privacy policy for Google verification, and
  the domain to verify in Resend.

Then set `APP_URL` and `API_URL` in each environment's `vars`.

---

## Adding a secret

Three places, and the deploy tells you if you miss one:

1. `SECRET_KEYS` in `apps/api/src/env.ts`
2. both `secrets_store_secrets` blocks in `wrangler.jsonc`
3. a schema fragment — a package's `keys.ts`, or `apps/api/src/env.ts`

Then add it to `.env.dev` / `.env.prod` and push.
