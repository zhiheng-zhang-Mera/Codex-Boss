import { defineConfig } from "vitest/config";
import { BUILD_DEPENDENT_TESTS, PLATFORM_QUALIFICATION_TEST_FILES, REAL_HOST_SCALE_TEST_FILES, SLOW_ACCEPTANCE_TEST_FILES } from "./vitest.tiers.mjs";

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
 *
 * The fourth group is the REAL_HOST_SCALE execution tier: suites whose correctness contract is
 * deterministic but whose required SCALE makes their cost depend on host-local storage, so a shared hosted
 * runner cannot decide them within a budget that is not itself inside the machine's variance. They are
 * excluded here for the same reason the qualification tier is — not skipped, run elsewhere — and their
 * requirement is declared in `REAL_HOST_SCALE_TESTS`. The bounded correctness case for the same contract
 * stays IN this tier (`durable-event-correctness.test.ts`), so the merge gate keeps proving the contract
 * while the scale claim is owned by the real host.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [...SLOW_ACCEPTANCE_TEST_FILES, ...BUILD_DEPENDENT_TESTS, ...PLATFORM_QUALIFICATION_TEST_FILES, ...REAL_HOST_SCALE_TEST_FILES, "node_modules/**", "dist/**", "dist-electron/**"],
    testTimeout: 60000
  }
});
