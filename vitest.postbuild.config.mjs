import { defineConfig } from "vitest/config";
import { BUILD_DEPENDENT_TESTS } from "./vitest.tiers.mjs";

/**
 * The build-dependent tier (convergence book, Phase N).
 *
 * These files read the REAL `dist/` and `dist-electron/` output, so they cannot pass
 * until something has built the application. They used to sit in the default tier,
 * which made `pnpm test` quietly require a build: measured with the two directories
 * renamed away, `pnpm test` failed `A-05`, `EV-15` and two closure-harness cases while
 * the other 1840 tests passed.
 *
 * Declaring the dependency is the point. The alternative — making these tests skip
 * when the build is missing — would turn "we verified the build identity" into "we
 * did not look", which is exactly the kind of quiet pass this repository forbids.
 * So they run here instead, as their own step immediately after `pnpm run build`.
 *
 * Every entry declares `requires: ["build"]` and nothing more, which is the claim this tier makes and
 * the claim a clean push runner can honour. Suites that need MORE than the build — generated phase
 * artifacts, a real full-suite pairing record, an accumulated host corpus — are not here; they are in
 * `PLATFORM_QUALIFICATION_TESTS` and run under `Platform Qualification`. `tests/unit/test-layers.test.ts`
 * checks that a push-CI tier entry never declares such a requirement, so the boundary cannot drift back.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: BUILD_DEPENDENT_TESTS,
    testTimeout: 60000
  }
});
