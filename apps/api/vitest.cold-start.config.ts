import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import base from "./vitest.config";

const entrypoint = fileURLToPath(new URL("./src/index.ts", import.meta.url));

/** Reproduce slow CI module loading without slowing or mocking the handler.
 * Without the setup preload, the first real health request times out. */
export default defineConfig({
  ...base,
  plugins: [
    ...(base.plugins ?? []),
    {
      name: "wiseroutine:cold-worker-regression",
      enforce: "pre",
      async transform(_code, id) {
        if (id.split("?")[0] !== entrypoint) return;
        console.info("[cold-worker] Delaying entrypoint transform by 6500ms");
        await setTimeout(6_500);
      },
    },
  ],
  test: {
    ...base.test,
    include: ["src/api.test.ts"],
    testNamePattern: "^health ",
    testTimeout: 5_000,
  },
});
