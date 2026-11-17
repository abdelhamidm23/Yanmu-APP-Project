import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      // Needs a migrated, seeded PostgreSQL: pnpm db:setup
      { extends: true, test: { name: "db", include: ["tests/db/**/*.test.ts"], fileParallelism: false, testTimeout: 20_000 } },
    ],
  },
});
