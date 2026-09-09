/**
 * Full-system hardening matrix (plan AP30). Pure registry of the plan §30
 * failure scenarios plus a deterministic reporter: every row declares its
 * coverage device (unit suite / controlled integration / live-only) so the
 * matrix is explicit about what is exercised where, instead of a vague
 * "NOT_RUN" blanket. The electron side runs the in-process subset.
 */

export type HardeningCoverage = "unit" | "integration" | "live";
export type HardeningResult = "PASS" | "FAIL" | "NOT_RUN";

export interface HardeningScenario {
  id: string;
  label: string;
  coverage: HardeningCoverage;
  /** Names of the deterministic test suite(s) that exercise this scenario. */
  suite: string[];
  /** Why live-only scenarios are not run in CI (documented, not hidden). */
  reason?: string;
}

export const HARDENING_SCENARIOS: readonly HardeningScenario[] = [
  { id: "provider-outage", label: "provider outage", coverage: "unit", suite: ["circuit-breaker", "runtime-registry", "role-router"] },
  { id: "api-credit", label: "API credit exhausted", coverage: "unit", suite: ["budget-manager", "role-router"] },
  { id: "network-loss", label: "network loss", coverage: "unit", suite: ["recovery-closure", "semantic-runtime", "cli-process-recovery"] },
  { id: "harness-crash", label: "harness crash", coverage: "unit", suite: ["recovery-closure", "store"] },
  { id: "browser-crash", label: "browser crash", coverage: "integration", suite: ["provider-view-navigation", "recovery-closure"] },
  { id: "boss-restart", label: "BOSS restart", coverage: "unit", suite: ["delivery-integration", "recovery-closure", "launcher"] },
  { id: "workspace-switch", label: "workspace switch", coverage: "unit", suite: ["workspace"] },
  { id: "multi-repo", label: "multi-repo workspace", coverage: "unit", suite: ["workspace"] },
  { id: "storage-failure", label: "storage failure", coverage: "unit", suite: ["durable-json", "store"] },
  { id: "cloud-unavailable", label: "cloud unavailable", coverage: "unit", suite: ["web-recovery", "semantic-runtime"] },
  { id: "cache-corruption", label: "cache corruption", coverage: "unit", suite: ["content-cache", "cached-repo-scan"] },
  { id: "schema-migration-failure", label: "schema migration failure", coverage: "unit", suite: ["schema-migration", "store"] },
  { id: "stale-cache", label: "stale cache invalidation", coverage: "unit", suite: ["content-cache", "context-capsule"] },
  { id: "blender-crash", label: "Blender crash", coverage: "live", suite: [], reason: "requires a live Blender session; AP22 adapter exercises command-level failure only" },
  { id: "unreal-crash", label: "Unreal crash", coverage: "live", suite: [], reason: "requires a live Unreal session; AP23 adapter exercises command-level failure only" },
  { id: "lease-conflict", label: "software lease conflict", coverage: "unit", suite: ["software-lease", "semantic-runtime"] },
  { id: "bad-self-mod", label: "bad self modification", coverage: "unit", suite: ["self-mod-sandbox"] },
  { id: "rollback", label: "rollback", coverage: "unit", suite: ["self-mod-sandbox", "schema-migration"] },
  { id: "corrupt-knowledge", label: "corrupted knowledge", coverage: "unit", suite: ["knowledge", "experience"] },
  { id: "secret-tainted-log", label: "secret-tainted log", coverage: "unit", suite: ["secret-scan", "telemetry"] },
  { id: "approval-expiry", label: "approval expiry", coverage: "unit", suite: ["review-gate", "task-state-machine"] },
  { id: "guardian-denial", label: "Guardian denial", coverage: "unit", suite: ["guardian", "self-mod-sandbox", "secret-vault"] },
  { id: "adapter-version-mismatch", label: "adapter version mismatch", coverage: "unit", suite: ["compatibility"] },
  { id: "restart-during-upgrade", label: "restart during upgrade", coverage: "unit", suite: ["recovery-closure", "schema-migration"] },
  { id: "long-running-soak", label: "long-running soak", coverage: "live", suite: [], reason: "deliberate soak run only in release validation, not per-commit CI" }
];

export interface HardeningRow {
  scenario: HardeningScenario;
  result: HardeningResult;
  evidence?: string;
}

export interface HardeningReport {
  schemaVersion: 1;
  generatedAt: string;
  rows: HardeningRow[];
  summary: { pass: number; notRun: number; fail: number; total: number };
}

/** Deterministic matrix reporter given per-scenario in-process outcomes. */
export function summarizeHardening(input: { results: Record<string, HardeningResult>; generatedAt?: string }): HardeningReport {
  const rows: HardeningRow[] = HARDENING_SCENARIOS.map((scenario) => {
    const result = input.results[scenario.id];
    if (!result) return { scenario, result: "NOT_RUN", evidence: scenario.reason ?? "no in-process device; live/controlled suite only" };
    return { scenario, result };
  });
  const summary = { pass: 0, notRun: 0, fail: 0, total: rows.length };
  for (const row of rows) {
    if (row.result === "PASS") summary.pass += 1;
    else if (row.result === "FAIL") summary.fail += 1;
    else summary.notRun += 1;
  }
  return { schemaVersion: 1, generatedAt: input.generatedAt ?? new Date().toISOString(), rows, summary };
}

/** The deterministic subset (unit/integration) ids — used by the harness runner. */
export function inProcessScenarioIds(): string[] {
  return HARDENING_SCENARIOS.filter((scenario) => scenario.coverage !== "live").map((scenario) => scenario.id);
}
