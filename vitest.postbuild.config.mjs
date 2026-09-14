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
 */
export default defineConfig({
  test: {
    environment: "node",
    include: BUILD_DEPENDENT_TESTS,
    testTimeout: 60000
  }
});
