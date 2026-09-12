# Contributing

Start with the standalone kit, not the private app. Use a personal/business namespace and a narrow permission list. Keep a dependency lockfile and small tests; build one IIFE. Test widget/session/Quick Add roles, denied permissions, empty data, disconnected host and full storage. Never commit credentials or real calendar data.

For SDK/contract changes, add regression tests and update SPEC.md, schema and examples together. API additions should be additive; incompatible wire changes need a new API version. Version upgrades must not silently widen authority. Run `pnpm build`, `pnpm test`, `pnpm typecheck` and `pnpm addon validate <your-addon>`.

For addon submissions, follow [SUBMISSIONS.md](SUBMISSIONS.md). Human review is required for every version, including dependency-only updates. An automated green result is not approval. Do not use reserved Wise Routine IDs for forks.

Contributions to the kit are made under its MIT license unless a file explicitly says otherwise. Keep upstream notices. Submitted addon authors retain ownership and choose an accepted redistributable license; no ownership assignment or exclusivity is requested. Trademark use and service access are separate. Contributors must have rights to all submitted code/assets/dependencies.

Operators must publish a real support/security contact and configure branch protection before opening submissions. This export deliberately does not invent contact addresses, registry URLs or npm publication status.
