import { defineConfig } from "vitest/config";

/**
 * The complete suite: every test file, no exclusions.
 *
 * This stays the *default* configuration on purpose. Several acceptance harnesses
 * (`scripts/acceptance-review.cjs`, `scripts/acceptance-*.cjs`) invoke
 * `vitest run <file>` against a specific suite, and an explicit file that a
 * configuration excludes makes vitest exit 1 with "No test files found" — which is
 * how a tier split can silently disable a gate instead of speeding it up.
 *
 * `pnpm test` therefore names its own tier explicitly (`vitest.unit.config.mjs`),
 * and this file remains what it always was: everything, with a generous per-test
 * timeout, because the same suite also runs inside the live Electron app
 * (autonomous-loop audits) where process/git-heavy tests are much slower.
 */
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 60000 }
});
