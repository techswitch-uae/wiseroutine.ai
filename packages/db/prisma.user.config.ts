import { defineConfig } from "prisma/config";

// See prisma.directory.config.ts - same reasoning, different schema.
export default defineConfig({
  schema: "prisma/user.prisma",
  migrations: { path: "migrations/user" },
  datasource: { url: "file:./.shadow-user.db" },
});
