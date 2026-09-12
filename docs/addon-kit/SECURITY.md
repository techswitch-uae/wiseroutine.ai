# Security

Do not publish user data, tokens, exploit credentials or live abuse instructions in public issues. Before this repository accepts external submissions, operators must enable GitHub private vulnerability reporting (or publish another monitored private reporting channel) and name a response owner. Use that channel for vulnerabilities; until it exists, customer addon distribution stays closed.

Treat all contributed source, dependencies, manifests and bundles as untrusted. A sandbox, digest, signature or successful preview is not a security certification. Initial community approval excludes network, embedding, external-link, background-wake and secret integrations. Adversarial browser/native acceptance remains necessary even for local-only contributions.

Build contributions in disposable, time-limited runners without production API, npm publishing, deployment, signing or personal credentials. Read-only repository access only; no privileged `pull_request_target`, self-hosted production runners, shared writable release caches or source-controlled commands in the promotion stage. Install with a lockfile and lifecycle scripts disabled by default; any required build script is still untrusted code.

Separate stages:
1. Untrusted source build/test -> immutable artifact and digest.
2. Human source/license/privacy review -> approval of the exact source commit, dependencies and bytes.
3. Trusted promotion -> independently recheck bytes and metadata, sign data only, upload to controlled hosting, retain approved history.

On a report: triage, revoke affected ID or release in the authoritative catalog, deploy the catalog, monitor backend denials, and verify clients stop frames/authority. Rotate compromised keys through a reviewed app/server release; do not trust a key supplied by the downloaded artifact. Retain public historical keys and revoked descriptors for verification; do not approve new releases with a compromised key. Removing an approval key alone is not a complete incident response.

No promise of immediate remote recall: clients refresh online, enforce a bounded approval lease and may be offline or suspended. Native serving/fetch checks expire independently. Already accepted writes or data previously sent cannot be recalled. Use local addon safe mode and remove affected device data as appropriate. Record incident timing and user notification decisions without collecting private addon contents.
