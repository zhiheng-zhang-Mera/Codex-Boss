import { defineConfig } from "vitest/config";
import { BUILD_DEPENDENT_TESTS, PLATFORM_QUALIFICATION_TEST_FILES, SLOW_ACCEPTANCE_TEST_FILES } from "./vitest.tiers.mjs";

/**
 * The default tier: what `pnpm test` runs.
 *
 * Everything except three declared groups. The slow suites compile and execute real
 * projects and are kept out for timing (one measured ~113s, and its slowest scenario
 * crossed the 60s ceiling under full-suite parallelism); the build-dependent suites
 * read the real `dist/`+`dist-electron/` output and are kept out so that `pnpm test`
 * needs nothing but the sources — which is what a clean checkout has. Both groups
 * still run in CI as their own explicit steps, `pnpm run test:slow` and
 * `pnpm run test:postbuild`.
 *
 * The third group is the platform-qualification tier: the frozen Phase 01-05 gates that additionally
 * need generated phase artifacts, a real full-suite pairing record, or a host corpus accumulated by
 * real soak runs. They are excluded here because a clean checkout cannot satisfy them honestly, and
 * they are NOT skipped — the real soak host runs them, under the qualification workflow in the separate
 * private control repository, after generating their declared
 * prerequisites. Each suite's requirement is declared in `PLATFORM_QUALIFICATION_TESTS`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [...SLOW_ACCEPTANCE_TEST_FILES, ...BUILD_DEPENDENT_TESTS, ...PLATFORM_QUALIFICATION_TEST_FILES, "node_modules/**", "dist/**", "dist-electron/**"],
    testTimeout: 60000
  }
});
