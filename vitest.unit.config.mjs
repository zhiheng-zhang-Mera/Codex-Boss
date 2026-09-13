import { defineConfig } from "vitest/config";
import { SLOW_ACCEPTANCE_TESTS } from "./vitest.tiers.mjs";

/**
 * The default tier: what `pnpm test` runs.
 *
 * Everything except the suites that compile and execute real projects. Keeping
 * those out of this run is what makes a green commit stay green: one of them
 * measured ~28s alone and exceeded the 60s ceiling under the load of a full
 * parallel run. They still run in CI — as their own explicit step, one at a time,
 * through `pnpm run test:slow`.
 *
 * `tests/unit/closure-terminal-logic.test.ts` stays here: it spawns acceptance
 * harnesses that `require` compiled modules under `dist-electron`, which is why
 * `pnpm test` is documented as build-dependent rather than pretended hermetic.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [...SLOW_ACCEPTANCE_TESTS, "node_modules/**", "dist/**", "dist-electron/**"],
    testTimeout: 60000
  }
});
