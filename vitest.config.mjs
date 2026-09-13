import { defineConfig } from "vitest/config";

/**
 * The default suite: fast, deterministic, and the one that runs on every change.
 *
 * Layering (convergence book, Phase N). Two kinds of test used to share this run
 * and made it neither fast nor reliable:
 *
 *  - suites that run real `tsc` / `node --test` inside a fixture and need tens of
 *    seconds each. Under full-suite parallelism one of them
 *    (`tests/acceptance/review-loop.test.ts`, ~28s alone) repeatedly hit the
 *    global per-test timeout, turning a green commit red. They now have their own
 *    configuration (`vitest.slow.config.mjs`) and their own explicit CI step, so
 *    they still run — just not in a pool that is trying to finish in four minutes.
 *  - `tests/unit/closure-terminal-logic.test.ts` spawns acceptance harnesses that
 *    `require` compiled modules under `dist-electron`, so the run depends on a
 *    build. It stays here because CI builds first, but it is why `pnpm test` is
 *    documented as build-dependent rather than pretending to be hermetic.
 *
 * Everything else — unit tests, the trust/adversarial suites, the fast acceptance
 * suites — stays in this run, because they are the signal a developer needs
 * immediately.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // See SLOW_ACCEPTANCE_TESTS below: those files run through
    // `pnpm run test:slow` with a timeout justified by what they actually do.
    exclude: ["tests/acceptance/review-loop.test.ts", "node_modules/**", "dist/**", "dist-electron/**"],
    testTimeout: 60000
  }
});

/**
 * Suites that compile and execute real projects in a fixture. They are excluded
 * from the default run and executed by `pnpm run test:slow`; the list lives here so
 * the two configurations cannot drift apart.
 */
export const SLOW_ACCEPTANCE_TESTS = ["tests/acceptance/review-loop.test.ts"];
