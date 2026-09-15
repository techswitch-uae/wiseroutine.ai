# @wiseroutine/addon-tools

A standalone, MIT-licensed authoring CLI. Requires Node 24 or newer. No app checkout, login or production credentials.

```sh
wr-addon init hello-addon
cd hello-addon
npm install
npm run build
npm run preview
```

Until npm publication, use the exported kit's workspace command (`pnpm addon preview addons/breathing`) or locally packed tarballs; package names here are not a claim that they have already been published.

- `wr-addon validate DIR`: schema + semantic + community-preview policy checks, strict UTF-8, maximum 64 KiB manifest / 2 MiB bundle; prints the actual digest. Requires `manifest.json` and `dist/addon.js`.
- `wr-addon preview DIR [--port 4173]`: serves **only on 127.0.0.1**. Choose widget/session/background role, deny permissions, send Quick Add, inspect synthetic host results, disconnect/restart. It exposes no private filesystem route. Rebuild and restart the preview to change code. Network/secret integrations are intentionally unavailable. `--bundled` is only an option to `validate`, for first-party examples; it is not submission approval.
- `wr-addon package DIR [NEW_OUTPUT_DIR]`: also requires `submission.json` and `LICENSE`; creates an unapproved artifact with code, normalized manifest, payload, source/privacy/support metadata and license. Never overwrites an existing output. Nothing is uploaded or signed.

Copy `submission.example.json` to `submission.json`, give a real GitHub repository and full immutable source commit, select an allowed redistributable license, and explain data access/retention. Keep a dependency lockfile and tests in the source repository. Retain your license and notices; you retain ownership of your contribution.

The preview is deliberately synthetic, not an emulator of billing, OAuth, scheduler concurrency, native CSP, CPU/process isolation or production authorization. Passing it is only the first check. Staging and packaged-native acceptance are still required before customer distribution. Source builds run without deployment, npm or signing credentials. Never place secrets in an addon bundle.
