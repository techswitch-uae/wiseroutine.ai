import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type ViteDevServer } from "vite";

type TanStackStartInputConfig = NonNullable<
  Parameters<typeof tanstackStart>[0]
>;
type SpaOptions = NonNullable<TanStackStartInputConfig["spa"]>;
type SpaPrerenderOptions = NonNullable<SpaOptions["prerender"]>;
type RegularPrerenderOptions = NonNullable<SpaOptions["prerender"]>;

const host: string | undefined = process.env.TAURI_DEV_HOST;

/**
 * Somewhere for the rearrangement simulator to put its verdicts.
 *
 * The simulator (`/sim`) exists so a person can look at what the scheduler
 * wants to do with a broken day and say whether it is right. Those answers are
 * only worth collecting if they end up somewhere readable outside the browser
 * - localStorage would leave them where nobody can act on them, and a real API
 * route would be production surface for a page that is scaffolding.
 *
 * Dev server only, which is the whole point: it never ships.
 */
function scenarioVerdicts() {
  const file = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../docs/scenario-verdicts.json",
  );

  const read = (): { verdicts: Record<string, unknown> } => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return { verdicts: {} };
    }
  };

  return {
    name: "wiseroutine:scenario-verdicts",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__verdicts", (req, res) => {
        res.setHeader("content-type", "application/json");

        if (req.method === "GET") {
          res.end(JSON.stringify(read()));
          return;
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end('{"error":"method"}');
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const { id, verdict } = JSON.parse(body);
            const store = read();
            store.verdicts[id] = verdict;
            mkdirSync(dirname(file), { recursive: true });
            // Sorted, so the diff of a review session is the verdicts that
            // changed rather than the order a browser happened to send them in.
            const sorted = Object.fromEntries(
              Object.entries(store.verdicts).sort(([a], [b]) =>
                a < b ? -1 : 1,
              ),
            );
            writeFileSync(
              file,
              `${JSON.stringify({ verdicts: sorted }, null, 2)}\n`,
            );
            res.end('{"ok":true}');
          } catch (error) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });
    },
  };
}

// Read from environment variable to pick which prerender mode to use.
// Defaults to false, which will pick the SPA prerender mode
const useSsrPrerenderString: string =
  process.env.USE_SSR_PRERENDER_MODE?.toLowerCase() ?? "false";
const useSsrPrerenderMode: boolean =
  useSsrPrerenderString === "true" || useSsrPrerenderString === "1";

const sharedPrerenderOptions: SpaPrerenderOptions & RegularPrerenderOptions = {
  enabled: true,
  autoSubfolderIndex: true,
};

// See: https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode#prerendering-options
const regularPrerenderOptions: RegularPrerenderOptions = {
  ...sharedPrerenderOptions,
  // Whether to extract links from the HTML and prerender them also
  // See: https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering#crawling-links
  crawlLinks: true,
  // Number of times to retry a failed prerender job
  retryCount: 3,
  // Delay between retries in milliseconds
  retryDelay: 1000,
};

// See: https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode#prerendering-options
const spaWithPrerenderOptions: SpaOptions = {
  prerender: {
    ...sharedPrerenderOptions,
    // Change the root output path for SPA prerendering from /_shell.html to /index.html
    outputPath: "/index.html",
    crawlLinks: false,
    retryCount: 0,
  },
};

// See: https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    devtools(),
    nitro(),
    tailwindcss(),
    tanstackStart({
      spa: (!useSsrPrerenderMode
        ? spaWithPrerenderOptions
        : undefined) satisfies SpaOptions | undefined,
      prerender: (useSsrPrerenderMode
        ? regularPrerenderOptions
        : undefined) satisfies RegularPrerenderOptions | undefined,
    }),
    viteReact(),
    scenarioVerdicts(),
  ],

  // Resolve path aliases from tsconfig.json
  resolve: {
    tsconfigPaths: true,
  },

  // Prevent Vite from obscuring rust errors
  clearScreen: false,

  // The prerender step boots a preview server. Keep it off the dev port, which
  // `tauri dev` needs fixed - a build must not fail because it is taken.
  preview: {
    port: 41200,
    strictPort: false,
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 41000,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 41001,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
