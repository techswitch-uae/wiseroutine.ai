# Setup — the API worker

Two deployed environments, `dev` and `production`, plus local. Each is a
separate Worker with its own queue, its own KV namespace, its own databases and
its own secrets. Nothing is shared except the account-level Secrets Store,
which is why every secret name carries a `WR_DEV_` or `WR_PROD_` prefix.

---

## Where configuration lives

There are exactly two places, and which one a value belongs in is decided by
one question — *is it a secret?*

**Not a secret → `vars` in `apps/api/wrangler.jsonc`.** Committed, per
environment, readable at a glance. URLs, the Turso org and group, OAuth client
*IDs*, the Stripe price, the Resend From address, the OneSignal app ID. These
ship in consent URLs and email headers anyway.

**A secret → Cloudflare Secrets Store**, bound per environment in the same
file. The value exists in exactly one place, account-wide, and nothing can read
it back out — not the dashboard, not the API, not us. Only a Worker with a
binding resolves it, at runtime.

The consequence worth knowing: **rotating a secret does not need a deploy.**
Update it in the store and the next isolate picks it up. The old
`wrangler secret put`-per-worker approach needed one push per environment and a
redeploy to be sure.

`apps/api/src/env.ts` lists the secret names once, in `SECRET_KEYS`. Adding a
secret means touching that list, the two `secrets_store_secrets` blocks in
`wrangler.jsonc`, and a schema fragment — and the deploy will tell you if you
miss one.

## Why a deploy cannot ship a broken configuration

`pnpm deploy:dev` / `pnpm deploy:prod` run three gates in order, and stop at the
first failure:

1. **`scripts/check-secrets.mjs`** reads every `secret_name` for the target
   environment out of `wrangler.jsonc` and checks each exists in the store.
   Missing one, and nothing is uploaded.
2. **`wrangler deploy`** refuses a binding it cannot wire up.
3. **`GET /health/config`** on the deployed Worker resolves every binding and
   runs the full schema over the result — so an empty value, or a Resend key
   that does not start with `re_`, fails here. `curl -f` turns that into a
   non-zero exit.

Gate 1 checks presence, gate 3 checks shape. Between them, "missing or invalid"
means the command fails. Nothing can check a stored secret's value against its
source, because Cloudflare will not disclose it — that is the trade for having
one store.

---

## 1. Cloudflare — account resources

```bash
pnpm wrangler login
pnpm wrangler secrets-store store list --remote
```

There is **one store per account and it already exists** — Cloudflare creates
`default_secrets_store` the first time anyone with the Secrets Store Admin or
Super Administrator role touches the feature. Trying to create another returns
`maximum_stores_exceeded`; list it and use the id you get.

This account's is already filled into `apps/api/wrangler.jsonc`
(`8edcf4c1ac534aaea54bc99c6cefaec2`). It is an identifier, not a credential —
committed for the same reason KV namespace ids are.

```bash
pnpm wrangler kv namespace create CONFIG --env dev
pnpm wrangler kv namespace create CONFIG --env production
pnpm wrangler queues create wiseroutine-sync-dev
pnpm wrangler queues create wiseroutine-sync-dev-dlq
pnpm wrangler queues create wiseroutine-sync
pnpm wrangler queues create wiseroutine-sync-dlq
```

Paste each KV `id` into the matching environment block.

**Note:** Queues need the Workers **Paid** plan ($5/mo). That is the floor cost
of this architecture. Secrets Store is in open beta — one store per account, up
to 100 secrets, 1 KiB each.

## 2. The secrets

Ten per environment. Create each one:

```bash
STORE=8edcf4c1ac534aaea54bc99c6cefaec2
pnpm wrangler secrets-store secret create $STORE --name WR_PROD_SESSION_SECRET --scopes workers --remote
```

Omit `--value` and let it prompt — passing it inline leaves the secret in your
shell history.

Or keep them in a local file and push the set in one command — see
[From a local file](#from-a-local-file) below.

| name | where it comes from |
|---|---|
| `…_TURSO_AUTH_TOKEN` | `turso group tokens create <group>` |
| `…_TURSO_PLATFORM_TOKEN` | `turso auth api-tokens mint <name>` |
| `…_TOKEN_ROOT_KEY` | generated, below |
| `…_SESSION_SECRET` | generated, below |
| `…_GOOGLE_CLIENT_SECRET` | Google Cloud console |
| `…_MICROSOFT_CLIENT_SECRET` | Entra app registration |
| `…_STRIPE_SECRET_KEY` | Stripe dashboard |
| `…_STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint |
| `…_RESEND_API_KEY` | Resend dashboard |
| `…_ONESIGNAL_API_KEY` | OneSignal dashboard |

Prefix each with `WR_DEV_` or `WR_PROD_`. Check yourself at any time:

```bash
pnpm --filter @wiseroutine/api secrets:check:prod
```

### From a local file

`.env.dev` and `.env.prod` in `apps/api/` (both gitignored) hold the values,
one `KEY=value` per line, **unprefixed** — `RESEND_API_KEY=re_...`, not
`WR_PROD_RESEND_API_KEY`. The prefix belongs to the store, where dev and
production share one account namespace; the file already knows which
environment it is.

```bash
pnpm --filter @wiseroutine/api secrets:push:dev  -- --dry-run
pnpm --filter @wiseroutine/api secrets:push:prod
```

What it does, and what it refuses to do:

- **Which secrets exist is not the script's opinion.** It reads the
  `secrets_store_secrets` entries in `wrangler.jsonc` — the same list the
  deploy preflight checks — so nothing can be pushed that no binding wants,
  and nothing bound can be quietly skipped.
- **A key in the file that nothing binds is reported, not ignored.** That is
  almost always a typo, and silently dropping it costs an afternoon.
- **A key absent from the file is left alone in the store.** Pushing is
  additive; it never clears a secret you did not mention. `secrets:check:*` is
  what tells you the set is complete.
- **Values go in over stdin, never as an argument.** Anything in `argv` is
  visible to `ps` while the process runs.
- **Nothing prints a value.** Output is a length and a short SHA, enough to
  tell two pushes apart without putting a credential in your scrollback.
- Empty values, stray quotes and pasted line breaks are refused before upload.

**The trade you are making.** Until you create these files, the only copy of a
production secret is inside Cloudflare, where nothing — not the dashboard, not
the API, not us — can read it back. A local `.env.prod` is a plaintext copy on
a laptop, and it is exactly as safe as that disk. That is a fair trade for one
command instead of ten prompts; it is worth knowing you made it. If you would
rather not keep one, `secrets-store secret create` per key still works and
`secrets:check:prod` still tells you what is missing.

A rotated value reaches the Worker as isolates recycle. Deploy if you need it
to take effect immediately.

### The two generated ones

```bash
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"
```

`TOKEN_ROOT_KEY` envelope-encrypts per-user OAuth refresh tokens — **losing it
means every user must reconnect their calendar**, so back it up where you would
back up a database credential. `SESSION_SECRET` signs sessions and OTP state;
losing it only signs everyone out. Generate a different pair per environment.

## 3. Local

Local uses neither store. `wrangler dev` reads `apps/api/.dev.vars`
(gitignored), and `resolveServerEnv` takes a plain string wherever a deployed
environment hands it a binding — so the code path is the same.

```bash
cat > apps/api/.dev.vars <<EOF
TOKEN_ROOT_KEY=$(node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))")
SESSION_SECRET=$(node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))")
RESEND_API_KEY=re_...
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
EOF
```

Leave a secret blank and the feature that needs it fails at its call site with
the key's name — the app still boots. That leniency is local-only;
`/health/config` refuses it anywhere else.

Start the two `turso dev` servers first — see
[setup-database.md](setup-database.md) — then:

```bash
pnpm api
```

## 4. Deploying

```bash
pnpm --filter @wiseroutine/api deploy:dev
pnpm --filter @wiseroutine/api deploy:prod
```

Both are also the answer to "a secret changed": rotate it in the store, and
deploy only if you want the change to take effect immediately rather than as
isolates recycle.

## 5. Domains

- API: `api.wiseroutine.ai` and `api-dev.wiseroutine.ai` — need a valid
  CA-signed certificate, which Google's push channels require.
- App: `wiseroutine.ai` — must host the homepage and privacy policy for Google
  verification, and is the domain to verify in Resend.

Set `APP_URL` and `API_URL` in each environment's `vars` once these exist.
