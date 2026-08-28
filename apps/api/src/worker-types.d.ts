/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { Bindings } from "./context";

declare global {
  namespace Cloudflare {
    // Augments the pool's own `cloudflare:test` types - the reference above
    // must come first, or this replaces the module instead of extending it.
    interface Env extends Bindings {}

    // Types `exports` from "cloudflare:workers" as this Worker's own exports,
    // so `exports.default.fetch()` is checked against the real handler rather
    // than being an untyped record.
    interface GlobalProps {
      mainModule: typeof import("./index");
    }
  }
}
