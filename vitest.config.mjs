import { defineConfig } from "vitest/config";

export default defineConfig({
  // Default per-test timeout is deliberately generous: the same suite runs both
  // in CI/node and inside the live Electron app (autonomous-loop audits), where
  // parallel process/git-heavy tests are much slower. Git-heavy tests also
  // carry their own explicit timeouts; a 90s floor keeps those robust in-app.
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 60000 }
});
