import { defineConfig } from "prisma/config";

// The CLI needs a datasource to render migration SQL against; without one
// `migrate diff` silently emits nothing. It points at a throwaway local file
// and is never used by the application, which connects to Turso over HTTP.
export default defineConfig({
  schema: "prisma/directory.prisma",
  migrations: { path: "migrations/directory" },
  datasource: { url: "file:./.shadow-directory.db" },
});
