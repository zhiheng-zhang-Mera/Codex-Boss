/**
 * checkpoint-1 §33 (checkpoint-10) — recovery acceptance (RC-01..RC-10).
 *
 * The classification is driven by failures the host really produced: a real
 * `tsc --noEmit` diagnostic, a real missing module, a real failing `node --test`,
 * the real §7.3 mutation refusal for the Boss repository and a real theme
 * validation report. The engine reads those bytes back out of the §31.3 ledger.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { createVerificationEngine, type VerificationEngine } from "../../electron/engineering/verification-engine";
import { createRecoveryEngine, missingModuleNames, type RecoveryEngine } from "../../electron/engineering/recovery-engine";
import { createReviewEngine } from "../../electron/engineering/review-engine";
import { runImplementationLoop } from "../../electron/engineering/implementation-loop";
import { assessMutation } from "../../electron/self-evolution/mutation-guard";
import { validateThemePackage } from "../../src/shared/theme";
import { planHnsFallback, planRecovery, advanceRecovery, type RecoveryAttempt } from "../../src/shared/recovery";
import type { ExecutionNode } from "../../src/shared/execution-planner";
import type { VerifiableRequirement } from "../../src/shared/verification";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-recovery-acceptance-"));
const WORK = path.join(ROOT, "workspace");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");
const LEDGER_PATH = path.join(WORK, "artifacts", "acceptance", "verification-ledger.json");
const BACKLOG_PATH = path.join(WORK, "artifacts", "acceptance", "capability-gaps.json");

type Verdict = "PASS" | "FAIL" | "NOT_RUN";
interface Observation { claim: string; expected: string; observed: string; ok: boolean; }
interface RequirementResult { id: string; title: string; verdict: Verdict; observations: Observation[]; evidence: string[]; notes?: string; }

class Item {
  private readonly observations: Observation[] = [];
  private readonly evidence: string[] = [];
  private failure?: string;
  constructor(readonly id: string, readonly title: string) {}
  check(claim: string, expected: unknown, observed: unknown): void {
    const expectedText = typeof expected === "string" ? expected : JSON.stringify(expected);
    const observedText = typeof observed === "string" ? observed : JSON.stringify(observed);
    this.observations.push({ claim, expected: expectedText, observed: observedText, ok: expectedText === observedText });
  }
  cite(pointer: string): void { if (!this.evidence.includes(pointer)) this.evidence.push(pointer); }
  fail(reason: string): void { this.failure = reason; }
  get ok(): boolean { return this.failure === undefined && this.observations.length > 0 && this.observations.every((entry) => entry.ok); }
  result(): RequirementResult {
    const result: RequirementResult = { id: this.id, title: this.title, verdict: this.ok ? "PASS" : "FAIL", observations: this.observations, evidence: this.evidence };
    if (this.failure) result.notes = this.failure;
    return result;
  }
}
const results: RequirementResult[] = [];
async function scenario(id: string, title: string, body: (item: Item) => Promise<void> | void): Promise<void> {
  const item = new Item(id, title);
  try { await body(item); }
  catch (error) { item.fail(`scenario threw: ${error instanceof Error ? error.message : String(error)}`); }
  results.push(item.result());
}

/* ------------------------------------------------------------------ *
 * a real workspace whose failures are real
 * ------------------------------------------------------------------ */

const GATEWAY = "export const gateway = (): string => \"full\";\n";
const BAD_IMPORT = "import leftPad from \"left-pad-that-does-not-exist\";\nexport const padded = (): string => String(leftPad);\n";
const FAILING_TEST = [
  "import { test } from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "test(\"the gateway resolves\", () => {",
  "  assert.equal(1, 2);",
  "});",
  ""
].join("\n");

for (const directory of ["src", "tests", "artifacts/acceptance"]) fs.mkdirSync(path.join(WORK, directory), { recursive: true });
fs.writeFileSync(path.join(WORK, ".gitignore"), "artifacts/\nnode_modules/\n", "utf8");
fs.writeFileSync(path.join(WORK, "package.json"), JSON.stringify({ name: "recovery-fixture", private: true }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler", skipLibCheck: true }, include: ["src"] }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), GATEWAY, "utf8");
fs.writeFileSync(path.join(WORK, "tests", "gateway.test.mjs"), "export const ok = true;\n", "utf8");

const MODULES = path.join(WORK, "node_modules");
fs.mkdirSync(path.join(MODULES, "typescript"), { recursive: true });
const TS_SOURCE = path.join(process.cwd(), "node_modules", "typescript");
for (const entry of ["package.json", "bin", "lib"]) fs.cpSync(path.join(TS_SOURCE, entry), path.join(MODULES, "typescript", entry), { recursive: true });
const PLATFORM_NAME = `typescript-${process.platform}-${process.arch}`;
const PNPM = path.join(process.cwd(), "node_modules", ".pnpm");
const platformEntry = fs.existsSync(PNPM) ? fs.readdirSync(PNPM).find((name) => name.startsWith(`@typescript+${PLATFORM_NAME}@`)) : undefined;
if (platformEntry) {
  fs.mkdirSync(path.join(MODULES, "@typescript", PLATFORM_NAME), { recursive: true });
  fs.cpSync(path.join(PNPM, platformEntry, "node_modules", "@typescript", PLATFORM_NAME), path.join(MODULES, "@typescript", PLATFORM_NAME), { recursive: true });
}
function git(...args: string[]): { status: number | null; output: string } {
  const result = spawnSync("git", args, { cwd: WORK, encoding: "utf8", windowsHide: true });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
const initialized = git("init", "--quiet");
git("config", "user.email", "acceptance@example.invalid");
git("config", "user.name", "acceptance");
git("add", "--all");
const committed = git("commit", "--quiet", "-m", "fixture: initial state");

const COMMANDS = { syntax: "node --check", typecheck: "pnpm run typecheck", unit: "pnpm test", tests: ["tests/gateway.test.mjs"], build_tools: ["tsc"] };
const TARGETS = { syntax: ["src/loader.mjs"], unit: ["tests/gateway.test.mjs"], module: [], integration: [] };
fs.writeFileSync(path.join(WORK, "src", "loader.mjs"), "export const loader = () => \"ready\";\n", "utf8");

function makeEngine(): VerificationEngine {
  return createVerificationEngine({ root: WORK, ledgerPath: LEDGER_PATH, commands: COMMANDS, targets: TARGETS, harnesses: {}, host: "acceptance-host", runtimes: { node: process.version } });
}
const recoveryFor = (engine: VerificationEngine): RecoveryEngine => createRecoveryEngine({ root: WORK, ledger: () => engine.ledger(), backlogPath: BACKLOG_PATH });

const NODE: ExecutionNode = {
  id: "implement-1",
  objective: "implement the gateway adapter",
  kind: "IMPLEMENT",
  requirements: ["R-gateway"],
  inputs: [],
  scope: ["gateway adapter"],
  allowed_files: ["src/gateway.ts"],
  expected_outputs: ["the gateway adapter"],
  verification: { gate: "TYPECHECK", commands: ["pnpm run typecheck", "pnpm test"], required_evidence: ["IMPLEMENTATION", "TEST"] },
  dependencies: [],
  rollback: "git checkout HEAD -- src/gateway.ts",
  wave: 0,
  optional: false,
  unbounded_scope: false
};
const requirement = (overrides: Partial<VerifiableRequirement> = {}): VerifiableRequirement => ({ id: "R-gateway", type: "FUNCTIONAL", text: "the gateway adapter returns a receipt", visual: false, ...overrides });

const shared: Record<string, unknown> = {};
/** Produce a real FAIL ledger row for a requirement by verifying a real change. */
async function failWith(engine: VerificationEngine, node: ExecutionNode, content: { path: string; content: string }, id = "R-gateway"): Promise<void> {
  const scope = engine.scopeFor(node);
  const applied = engine.applyChangeUnit(scope, { changes: [content] });
  if (!applied.applied) throw new Error(`fixture change was refused: ${applied.problems.join(", ")}`);
  await engine.verifyRequirement(engine.selectFor(requirement({ id })));
}

describe("checkpoint-10 §33 recovery acceptance", () => {
  it("RC-01 a real compiler error is classified as BUILD from its own output", async () => {
    await scenario("RC-01", "§33.1 classification from real evidence", async (item) => {
      const engine = makeEngine();
      await failWith(engine, NODE, { path: "src/gateway.ts", content: "export const gateway = (): number => \"full\";\n" });
      const recovery = recoveryFor(engine);
      const classified = recovery.classifyFromLedger("R-gateway")!;
      item.check("a failure row was classified", true, classified !== undefined);
      item.check("the class is BUILD", "BUILD", classified.classification.failure_class);
      item.check("the evidence is the tool's own output", true, (classified.entry.detail ?? "").includes("TS2322"));
      item.check("the signals include the compiler diagnostic", true, classified.classification.signals.some((signal) => signal.includes("error TS")));
      item.check("the gate that failed is recorded", "TYPECHECK", classified.entry.gate);
      item.check("the plan's first step is the local repair", "LOCAL_RECOVERY", classified.plan.next);
      item.check("no provider step is offered for a compile error", false, classified.plan.steps.find((step) => step.step === "ALTERNATE_PROVIDER")?.applicable);
      item.check("the plan ends at the Hard Blocker", "HARD_BLOCKER", classified.plan.steps.at(-1)?.step);
      shared.rc01 = { class: classified.classification.failure_class, severity: classified.classification.severity, next: classified.plan.next, signals: classified.classification.signals };
      item.cite("classifyFromLedger over a real tsc diagnostic");
    });
  });

  it("RC-02 a real missing module is a DEPENDENCY failure the host verified", async () => {
    await scenario("RC-02", "§33.1 host-verified dependency facts", async (item) => {
      const engine = makeEngine();
      await failWith(engine, NODE, { path: "src/gateway.ts", content: BAD_IMPORT });
      const recovery = recoveryFor(engine);
      const classified = recovery.classifyFromLedger("R-gateway")!;
      item.check("the class is DEPENDENCY", "DEPENDENCY", classified.classification.failure_class);
      item.check("the module name was extracted from the output", JSON.stringify(["left-pad-that-does-not-exist"]), JSON.stringify(missingModuleNames(classified.entry.detail ?? "")));
      item.check("the host confirmed the module is absent", JSON.stringify(["left-pad-that-does-not-exist"]), JSON.stringify(classified.observation.workspace?.missing_modules ?? []));
      item.check("the signal names the missing module", true, classified.classification.signals.some((signal) => signal.includes("missing_modules=")));
      item.check("local recovery is offered", "LOCAL_RECOVERY", classified.plan.next);
      item.check("a provider cannot supply a local module", false, classified.plan.steps.find((step) => step.step === "ALTERNATE_PROVIDER")?.applicable);
      shared.rc02 = { class: classified.classification.failure_class, next: classified.plan.next };
      item.cite("observe() module existence probe");
    });
  });

  it("RC-03 a real failing test is classified as TEST, not as a build error", async () => {
    await scenario("RC-03", "§33.1 gate + output agree", async (item) => {
      const engine = makeEngine();
      const node = { ...NODE, allowed_files: ["tests/gateway.test.mjs"] };
      const scope = engine.scopeFor(node);
      // Apply the failing test through the host seam, so its rollback restores the
      // fixture baseline rather than the failing content.
      const applied = engine.applyChangeUnit(scope, { changes: [{ path: "tests/gateway.test.mjs", content: FAILING_TEST }] });
      // A typecheck-passing tree so the ladder really reaches the test rung.
      engine.applyChangeUnit(engine.scopeFor(NODE), { changes: [{ path: "src/gateway.ts", content: GATEWAY }] });
      await engine.verifyRequirement(engine.selectFor(requirement({ id: "R-tests" })));
      const classified = recoveryFor(engine).classifyFromLedger("R-tests")!;
      item.check("the failing gate is the unit rung", "UNIT", classified.entry.gate);
      item.check("the class is TEST", "TEST", classified.classification.failure_class);
      item.check("the real assertion failure is cited", true, /(not ok|assertionerror|fail|✖)/i.test(classified.entry.detail ?? ""));
      item.check("retrying is refused for a deterministic test failure", false, classified.plan.steps.find((step) => step.step === "NATIVE_RETRY")?.applicable);
      shared.rc03 = { gate: classified.entry.gate, class: classified.classification.failure_class, detail: classified.entry.detail };
      item.cite("real node --test failure → TEST class");
      // Leave the fixture as it was: a later scenario must not inherit this failure.
      applied.rollback();
    });
  });

  it("RC-04 a real policy refusal is TERMINAL and cannot be retried or delegated", async () => {
    await scenario("RC-04", "§33.1 TERMINAL + §33.3 no HNS for prohibited work", async (item) => {
      const repoRoot = process.cwd();
      const verdict = assessMutation(repoRoot);
      item.check("the mutation guard really refuses the Boss repository without a run context", false, verdict.allowed);
      const recovery = recoveryFor(makeEngine());
      const refusal = recovery.policyRefusalFor(repoRoot)!;
      item.check("the refusal is real and explains itself", true, refusal.includes("no EvolutionRunContext") || refusal.includes("refusing to mutate"));
      const classification = recovery.classify({ detail: "the worker wanted to rewrite main", policy_refusal: refusal });
      item.check("the class is TERMINAL", "TERMINAL", classification.failure_class);
      item.check("the severity is CRITICAL", "CRITICAL", classification.severity);
      const plan = planRecovery(classification);
      item.check("no recovery step applies", undefined, plan.next);
      item.check("HNS is forbidden for a prohibited action", false, plan.hns_allowed);
      item.check("the Owner must decide", "AUTHORIZATION", plan.requires_owner?.kind);
      const decision = planHnsFallback({ classification, plan, task: "rewrite main", missing_capability: "self-rewrite permission", workaround: "ask HNS to do it" });
      item.check("HNS refuses it", false, decision.allowed);
      item.check("and still records a gap", "self-rewrite permission", decision.capability_gap.missing_capability);
      shared.rc04 = { class: classification.failure_class, owner: plan.requires_owner?.kind, hns_allowed: plan.hns_allowed };
      item.cite("assessMutation refusal → TERMINAL");
    });
  });

  it("RC-05 a real theme validation failure takes the §33.2 theme ladder", async () => {
    await scenario("RC-05", "§33.2 theme recovery", async (item) => {
      const validation = validateThemePackage({
        manifest: { id: "broken-theme", name: "Broken", version: "1.0.0", author: "acceptance" },
        tokens: {},
        overrides: [],
        css: "body { background: url(javascript:alert(1)); }"
      } as never);
      const errors = validation.diagnostics.filter((diagnostic) => diagnostic.severity === "ERROR");
      item.check("the real validator produced errors", true, errors.length > 0);
      const recovery = recoveryFor(makeEngine());
      const classification = recovery.classify({ detail: `theme validation failed: ${errors.map((error) => error.code).join(", ")}`, theme_error_diagnostics: errors.length });
      item.check("the class is THEME", "THEME", classification.failure_class);
      const plan = planRecovery(classification);
      item.check("the theme ladder is present", JSON.stringify(["DISABLE_THEME", "FALLBACK_BUILT_IN_THEME", "RECORD_DIAGNOSTIC"]), JSON.stringify(plan.theme_steps));
      item.check("a theme is not a provider's work", false, plan.steps.find((step) => step.step === "ALTERNATE_PROVIDER")?.applicable);
      item.check("the diagnostic says to record the failure", true, plan.diagnostics.some((line) => line.includes("theme ladder")));
      shared.rc05 = { errors: errors.map((error) => error.code), class: classification.failure_class, theme_steps: plan.theme_steps };
      item.cite("validateThemePackage errors → THEME class");
    });
  });

  it("RC-06 the ladder cannot be short-circuited to HNS", async () => {
    await scenario("RC-06", "§33.2 order is not advisory", async (item) => {
      const recovery = recoveryFor(makeEngine());
      const classification = recovery.classify({ detail: "error TS2322: type mismatch", gate: "TYPECHECK" });
      const plan = planRecovery(classification);
      item.check("the first due step is the local repair", "LOCAL_RECOVERY", advanceRecovery(plan, []).next);
      const one: RecoveryAttempt[] = [{ step: "LOCAL_RECOVERY", outcome: "FAIL" }];
      item.check("one failed attempt is not enough to jump ahead", "LOCAL_RECOVERY", advanceRecovery(plan, one).next);
      const three: RecoveryAttempt[] = [1, 2, 3].map(() => ({ step: "LOCAL_RECOVERY", outcome: "FAIL" }) as RecoveryAttempt);
      item.check("only once its budget is used does HNS become due", "HNS_FALLBACK", advanceRecovery(plan, three).next);
      const withHns: RecoveryAttempt[] = [...three, { step: "HNS_FALLBACK", outcome: "FAIL" }];
      const progress = advanceRecovery(plan, withHns);
      item.check("then it hard-blocks instead of looping", true, progress.hard_blocker);
      item.check("and says so", true, progress.reason.includes("Hard Blocker"));
      shared.rc06 = { first: advanceRecovery(plan, []).next, afterBudget: advanceRecovery(plan, three).next, final: progress.reason };
      item.cite("advanceRecovery budgets");
    });
  });

  it("RC-07 an HNS fallback always writes a durable CapabilityGap", async () => {
    await scenario("RC-07", "§33.3 HNS → CapabilityGap → backlog", async (item) => {
      const recovery = recoveryFor(makeEngine());
      const classification = recovery.classify({ detail: "error TS2322: type mismatch" });
      const { record, decision } = recovery.hns({
        classification,
        task: "repair the gateway across two files",
        missing_capability: "multi-file refactor planning",
        workaround: "HNS rewrites both files, Boss verifies them",
        role: "external_executor"
      });
      item.check("the first fallback is allowed", true, decision.allowed);
      item.check("a gap was produced", "multi-file refactor planning", record.gap.missing_capability);
      item.check("the gap entered the §34 chain", "IMPROVEMENT_TASK", record.backlog.stage);
      item.check("the role is one of §33.3's four", "external_executor", record.usage.role);
      item.check("the backlog file exists", true, fs.existsSync(BACKLOG_PATH));
      const raw = JSON.parse(fs.readFileSync(BACKLOG_PATH, "utf8")) as { version: string; records: unknown[] };
      item.check("it is versioned", "capability-gaps-1", raw.version);
      item.check("it holds the record", 1, raw.records.length);
      item.cite(BACKLOG_PATH);
    });
  });

  it("RC-08 HNS stops being a crutch after the consecutive ceiling", async () => {
    await scenario("RC-08", "§33.3 not a permanent crutch", async (item) => {
      const recovery = recoveryFor(makeEngine());
      const classification = recovery.classify({ detail: "error TS2322: type mismatch" });
      const second = recovery.hns({
        classification, task: "t", missing_capability: "planning", workaround: "w",
        history: { hns_calls: 1, consecutive_hns_calls: 1 }
      });
      item.check("the second consecutive call is still allowed", true, second.decision.allowed);
      const third = recovery.hns({
        classification, task: "t", missing_capability: "planning", workaround: "w",
        history: { hns_calls: 2, consecutive_hns_calls: 2 }
      });
      item.check("the third is refused", false, third.decision.allowed);
      item.check("the refusal cites the crutch rule", true, third.decision.reason.includes("permanent crutch"));
      item.check("the gap is still recorded", "planning", third.record.gap.missing_capability);
      item.check("every usage is recorded, allowed or not", 3, recovery.gaps().length);
      item.check("no usage lacks a gap", true, recovery.gaps().every((entry) => entry.usage.capability_gap.missing_capability.length > 0));
      shared.rc08 = { allowed: [true, second.decision.allowed, third.decision.allowed], total: recovery.gaps().length };
      item.cite("consecutive HNS ceiling");
    });
  });

  it("RC-09 the implementation loop records the §33 classification and the due step", async () => {
    await scenario("RC-09", "§30 repair stage consumes §33", async (item) => {
      const engine = makeEngine();
      const recovery = recoveryFor(engine);
      const review = createReviewEngine({ root: WORK, ledger: () => engine.ledger(), selectFor: (subject) => engine.selectFor(subject) });
      const outcome = await runImplementationLoop({
        node: NODE,
        requirements: [requirement({ id: "R-loop" })],
        engine,
        review: (request) => review.review(request),
        reviewPlan: (subjects) => review.planFor(subjects),
        worker: ({ iteration }) => iteration === 1
          ? { changes: [{ path: "src/gateway.ts", content: "export const gateway = (): number => \"full\";\n" }], note: "first attempt does not compile" }
          : { changes: [{ path: "src/gateway.ts", content: GATEWAY }], note: "second attempt compiles" },
        recover: ({ gateFailures, findings }) => {
          if (!gateFailures.length && !findings.length) return undefined;
          const classification = recovery.classify({
            ...(gateFailures[0]?.gate ? { gate: gateFailures[0].gate } : {}),
            ...(gateFailures[0]?.detail ? { detail: gateFailures[0].detail } : {}),
            workspace: recovery.observe(gateFailures[0]?.detail ?? "")
          });
          const plan = planRecovery(classification);
          const progress = advanceRecovery(plan, []);
          return {
            failure_class: classification.failure_class,
            severity: classification.severity,
            reason: classification.reason,
            ...(progress.next ? { next_step: progress.next } : {}),
            hard_blocker: progress.hard_blocker,
            ...(plan.requires_owner ? { requires_owner: plan.requires_owner } : {})
          };
        }
      });
      const first = outcome.iterations[0];
      const second = outcome.iterations[1];
      item.check("the first iteration's failure was classified", "BUILD", first?.recovery?.failure_class);
      item.check("the due step was the local repair", "LOCAL_RECOVERY", first?.recovery?.next_step);
      item.check("the classification is not a hard blocker yet", false, first?.recovery?.hard_blocker);
      item.check("the repair iteration ran", true, (outcome.iterations.length ?? 0) >= 2);
      item.check("the repaired iteration no longer fails the gate", true, (second?.gates ?? []).every((gate) => gate.result !== "FAIL"));
      item.check("the loop still refuses COMPLETED without full coverage", "INCOMPLETE", outcome.label);
      item.check("the record carries the reason", true, (first?.recovery?.reason ?? "").length > 0);
      shared.rc09 = {
        iterations: outcome.iterations.map((iteration) => ({
          gates: iteration.gates,
          blocking: iteration.findings.blocking_detail.map((finding) => `${finding.severity}:${finding.subject}`),
          recovery: iteration.recovery?.failure_class ?? "NONE",
          label: iteration.label
        })),
        label: outcome.label
      };
      item.cite("runImplementationLoop recover() → iteration record");
    });
  });

  it("RC-10 recovery never reports success it did not earn", async () => {
    await scenario("RC-10", "§2.3 recovery is not a completion", async (item) => {
      const recovery = recoveryFor(makeEngine());
      const unknown = recovery.classify({ detail: "something went sideways" });
      item.check("an unrecognised failure stays UNKNOWN", "UNKNOWN", unknown.failure_class);
      item.check("with low confidence rather than a guess", true, unknown.confidence <= 0.2);
      const plan = planRecovery(unknown);
      item.check("it still offers a bounded path", true, plan.next !== undefined || plan.requires_owner !== undefined);
      item.check("and always ends at the Hard Blocker", "HARD_BLOCKER", plan.steps.at(-1)?.step);
      const exhausted = advanceRecovery(plan, plan.steps.filter((step) => step.applicable).flatMap((step) => Array.from({ length: Math.max(step.budget, 1) }, () => ({ step: step.step, outcome: "FAIL" }) as RecoveryAttempt)));
      item.check("an exhausted ladder reports a hard blocker, not a recovery", true, exhausted.hard_blocker);
      item.check("the plan itself never claims a result", false, "recovered" in plan);
      item.check("a fresh engine still sees the durable gaps", 3, recoveryFor(makeEngine()).gaps().length);
      shared.rc10 = { unknown: unknown.failure_class, exhausted: exhausted.hard_blocker, gaps: recoveryFor(makeEngine()).gaps().length };
      item.cite("UNKNOWN + exhausted ladder + durable gaps");
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_10_RECOVERY",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    workspace: {
      git_initialized: initialized.status === 0,
      git_commit: committed.status === 0,
      typescript_toolchain: fs.existsSync(path.join(MODULES, "typescript", "bin", "tsc"))
    },
    recovery: shared,
    backlog: fs.existsSync(BACKLOG_PATH)
      ? (JSON.parse(fs.readFileSync(BACKLOG_PATH, "utf8")) as { records: { gap: { missing_capability: string; failure_class: string; severity: string }; usage: { role: string; allowed: boolean } }[] }).records
          .map((record) => ({ capability: record.gap.missing_capability, class: record.gap.failure_class, severity: record.gap.severity, role: record.usage.role, allowed: record.usage.allowed }))
      : [],
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  // Keep the fixture's §31.3 ledger next to the report: the classification
  // evidence is the tool output recorded there.
  if (fs.existsSync(LEDGER_PATH)) fs.copyFileSync(LEDGER_PATH, path.join(REPORT_DIR, "recovery-ledger.json"));
  fs.writeFileSync(path.join(REPORT_DIR, "recovery.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "recovery.md"), [
    "# checkpoint-1 §33 recovery acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Capability gaps recorded: ${report.backlog.length}`,
    "",
    `Totals: PASS ${report.totals.pass} / FAIL ${report.totals.fail}`,
    "",
    "| Item | Verdict | Observations |",
    "| --- | --- | --- |",
    ...report.requirementResults.map((entry) => `| ${entry.id} | ${entry.verdict} | ${entry.observations.filter((observation) => observation.ok).length}/${entry.observations.length} |`),
    ""
  ].join("\n"), "utf8");
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
  expect(report.requirementResults.map((entry) => `${entry.id}:${entry.verdict}`)).toEqual(report.requirementResults.map((entry) => `${entry.id}:PASS`));
});
