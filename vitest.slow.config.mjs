import { defineConfig } from "vitest/config";
import { SLOW_ACCEPTANCE_TESTS } from "./vitest.tiers.mjs";

/**
 * The slow tier: acceptance suites that compile and execute real projects.
 *
 * They are separated from the default run for a measured reason, not a
 * convenience one — `tests/acceptance/review-loop.test.ts` drives the real
 * implementation loop with a real `tsc` and real `node --test` inside a fixture,
 * and takes ~28s when it runs alone but exceeded the 60s default per-test ceiling
 * under the load of a full parallel run, failing green commits three times.
 *
 * The ceiling here is raised deliberately and only as far as the work justifies:
 * the slowest single scenario measured 28s in isolation, and this tier runs one
 * file at a time (`maxWorkers: 1`) so that measurement is the real bound rather
 * than a guess. It is NOT a blanket timeout increase — the default tier keeps its
 * 60s, and this tier is a separate, explicitly-invoked step in CI.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: SLOW_ACCEPTANCE_TESTS,
    testTimeout: 180000,
    hookTimeout: 180000,
    // One file at a time: this tier exists because parallel load made the
    // measurement meaningless.
    maxWorkers: 1,
    fileParallelism: false,
    pool: "forks"
  }
});
