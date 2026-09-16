import { defineConfig } from "vitest/config";
import { BUILD_DEPENDENT_TESTS, SLOW_ACCEPTANCE_TEST_FILES } from "./vitest.tiers.mjs";

/**
 * The default tier: what `pnpm test` runs.
 *
 * Everything except two declared groups. The slow suites compile and execute real
 * projects and are kept out for timing (one measured ~113s, and its slowest scenario
 * crossed the 60s ceiling under full-suite parallelism); the build-dependent suites
 * read the real `dist/`+`dist-electron/` output and are kept out so that `pnpm test`
 * needs nothing but the sources — which is what a clean checkout has. Both groups
 * still run in CI as their own explicit steps, `pnpm run test:slow` and
 * `pnpm run test:postbuild`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [...SLOW_ACCEPTANCE_TEST_FILES, ...BUILD_DEPENDENT_TESTS, "node_modules/**", "dist/**", "dist-electron/**"],
    testTimeout: 60000
  }
});
