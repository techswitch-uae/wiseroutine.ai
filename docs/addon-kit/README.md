# Build for Wise Routine

An open-source authoring kit for a commercial routine-planning app. The kit includes the MIT-licensed SDK, manifest contract, CLI, synthetic development host and six first-party examples. It does **not** include the private app, backend, customer data or production credentials.

## Start without access to the private repository

Use Node 24 and pnpm 10.30.1:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm typecheck
pnpm addon preview addons/breathing
```

Open the loopback URL printed by the command. Select a contribution; deny a permission, restart, and check the error; try Quick Add and disconnect. The host uses synthetic slots/todos only. Rebuild and restart the preview after changing source. This kit works without publishing any package to npm first.

Fork an example inside `addons/` for the simplest workspace workflow. Change its ID away from the reserved `wiseroutine` namespace, name, package name and description, use an allowed license, and keep the SDK dependency as `workspace:*`. Start from breathing/stretch for guided sessions, day-so-far for a widget, or todos for Quick Add. Deep-work demonstrates first-party embedding, **not** a capability currently accepted for community submissions.

Alternatively, after the packages are published:

```sh
npx @wiseroutine/addon-tools init my-addon
cd my-addon
npm install
npm run build
npm run preview
```

Before publication, the workspace workflow above is simplest. To test packed packages, pack all three (`pnpm --filter @wiseroutine/addons pack --pack-destination /tmp/wr-pack`, and likewise `addon-sdk` and `addon-tools`), then generate a starter with `pnpm addon init /tmp/my-addon`. Merge this field into the starter's package.json so pnpm resolves both direct and transitive unpublished packages locally:

```json
{
  "pnpm": {
    "overrides": {
      "@wiseroutine/addons": "file:/tmp/wr-pack/wiseroutine-addons-0.1.0.tgz",
      "@wiseroutine/addon-sdk": "file:/tmp/wr-pack/wiseroutine-addon-sdk-0.1.0.tgz",
      "@wiseroutine/addon-tools": "file:/tmp/wr-pack/wiseroutine-addon-tools-0.1.0.tgz"
    }
  }
}
```

Run `pnpm install --ignore-scripts`, `pnpm build`, and `pnpm validate` in the starter. Keep the generated lockfile. Merely adding root tarball dependencies is insufficient when pnpm still resolves existing starter ranges or the tools package's manifest dependency from npm. These local overrides are unnecessary after all three packages have actually been published. Do not assume publication has already happened.

## Submit

Read [SPEC.md](SPEC.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SUBMISSIONS.md](SUBMISSIONS.md) and [SECURITY.md](SECURITY.md). The initial program is curated: source-visible review of **each exact version**, not arbitrary uploads or customer sideloading. Customer distribution remains disabled until operators configure trust/hosting and complete staging/native acceptance.

The SDK permits commercial use. It does not provide a Pro subscription or access to the hosted API. Addons run within the user's account and its plan limits. Authors retain ownership; a submission grants redistribution under its chosen license, not a transfer of ownership. No paid-addon marketplace, commissions or revenue-sharing promise is part of v1.

The name/logo identify compatibility, not endorsement. Do not imply approval before an approved release is listed. Product subscriptions, support and service terms are separate from these source-code licenses.
