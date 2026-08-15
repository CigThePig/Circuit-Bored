import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The generation and full-route suites are intentionally CPU-heavy stress
    // tests. Running them concurrently only makes both hit their per-test
    // timeout without increasing invariant coverage.
    fileParallelism: false,
  },
});
