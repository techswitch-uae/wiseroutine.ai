# Database rollout and recovery

This is an operator runbook, **not authorization to migrate production**. Keep
M0 enabled and later milestones disabled. Follow [release preparation](releasing.md)
and record the evidence below alongside the candidate acceptance record.

## 1. Identify and prepare

- Record the reviewed application SHA, environment (`dev` or `production`),
  operator, approver, maintenance window and previous deployable SHA.
- Confirm the Cloudflare account/Worker and Turso organization/group. Obtain the
  actual directory URL from Turso and compare it to the selected
  `apps/api/wrangler.jsonc` block. Never infer production from a database name or
  from whichever `.dev.vars` happens to be on the laptop.
- Inventory the directory and active, provisioned user databases. Record
  incomplete provisioning separately; `--all-users` intentionally excludes those
  accounts and deleted accounts. Check the scope of the intended group token.
- Generate clients and embedded SQL from this checkout:
  ```sh
  pnpm --filter @wiseroutine/db generate
  pnpm typecheck
  pnpm --filter @wiseroutine/db test
  pnpm --filter @wiseroutine/api preflight:dev
  # Production preflight remains blocked until its actual directory URL is set:
  pnpm --filter @wiseroutine/api preflight:prod
  ```
- Supply only the matching exported `WR_DEV_TURSO_AUTH_TOKEN` or
  `WR_PROD_TURSO_AUTH_TOKEN` via the approved secret manager. Do not place tokens
  in shell command arguments, logs, PRs or acceptance records. The migration CLI
  does not load dotenv files or use generic unprefixed credentials for remote runs.

## 2. Back up and prove recovery first

- Plan a write-quiescence window covering API requests, queue consumers, cron and
  provisioning, or use a reviewed provider-supported consistent backup method.
  Independent snapshots taken while writes continue are not proof of a consistent
  directory/user restore point.
- Use the current Turso backup/export procedure for the actual databases. Record
  protected backup locations/IDs, source database identity, timestamp, checksum
  where applicable, retention and recovery access. Protect OAuth tokens, sessions
  and personal calendar data in those backups; back up `TOKEN_ROOT_KEY` separately
  through the secret manager.
- Restore to **isolated staging databases**, not over the source. Verify markers,
  representative activities/saved slots, account → database ownership, and access
  to encrypted calendar credentials with the intended root key. Run a staging
  application smoke test against the restored routing.
- Stop if the restore cannot be demonstrated. Set the accepted recovery point
  objective and maintenance/write-loss boundary explicitly before rollout.

Automated `packages/db/scripts/migrate.test.js` rehearses a disposable libSQL
backup/restore across the last directory/user migrations, preserving ownership
and saved slots. This is local regression evidence only: it does not test Turso
backup permissions, remote restore, production routing or deployment rollback.

## 3. Inspect, migrate, verify

Rehearse in **dev** first. Each scope is explicit; user scopes cannot mutate the
directory. `--dry` reads real migration markers without applying SQL.

```sh
pnpm db:migrate --env dev --directory --dry
pnpm db:migrate --env dev --directory
pnpm db:migrate --env dev --all-users --dry
pnpm db:migrate --env dev --all-users
pnpm db:migrate --env dev --directory --dry
pnpm db:migrate --env dev --all-users --dry
```

Review exact database origins, inventory counts, pending names and every error.
The chain currently has **6 directory / 16 user migrations**. An empty user list
is not evidence of success if accounts were expected. Unknown markers indicate
an incompatible checkout/schema; do not delete markers to force a pass.

Once separately approved for production, repeat with `--env production` and add
`--confirm-production` to **write** commands only. Do not run those commands just
because preflight passed. A failed user migration leaves other selected users
eligible to finish; the CLI exits nonzero and names failures. Fix the cause and
rerun the same reviewed scope; already-applied migrations are skipped.

Only then deploy the intended Worker. Check `/health/config`, database
connectivity, fresh provisioning, an existing-account upgrade, account ownership,
both calendar syncs, and saved work. `/health/config` alone proves none of the
connectivity, schema or data checks. Record the resulting deployment identifier.

## 4. Failure and rollback

- On an unexpected migration or smoke-test failure, stop promotion and prevent
  additional writes through the affected environment while assessing recovery.
  Preserve logs, database identities, markers and the failing application SHA.
- Each migration and its marker commits atomically. Inspect the failed database;
  do not assume the whole fleet or a multi-migration chain rolled back.
- Prefer an application rollback only after staging proves the previous SHA can
  operate against the **upgraded** schemas. Redeploying older code is not a schema
  downgrade. The old CLI may correctly reject unknown newer markers.
- If restoration is required, restore the reviewed consistent directory/user set
  to isolated targets, verify routing and data, then perform an approved cutover.
  Account for writes since the recovery point and communicate any loss. Never
  restore only a directory mapping while leaving it pointed at unrelated user data.
- Verify login, tenant routing, saved work, sync and queue processing before
  reopening writes. Record incident ownership and follow-up work. Do not delete
  the previous backups until recovery and retention requirements are satisfied.

## Evidence to retain (without secrets or personal calendar contents)

Environment and SHA; operator/approver; database inventory; backup IDs/times;
restore targets and results; dry-run and migration results; failed databases;
post-deploy provisioning/upgrade/ownership checks; rollback result; incident and
support owner. Ownership, alert destinations and the live rehearsal remain open
release gates until real people and actual environments have been verified.
