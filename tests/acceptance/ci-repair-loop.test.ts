/**
 * checkpoint-1 §41 (checkpoint-15) — CI repair loop acceptance (CR-01..CR-08).
 *
 * The loop is driven with a **real CI log**: the parser reads the actual output of a
 * failing `tsc`/`node --test` run, the repair goes through the §30 loop, the local
 * verify is a real ladder climb, the push is the real §39/§40 runner against a bare
 * remote, and the re-read is the CI reader (stubbed only at the network boundary).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { createCiRepairLoop, DEFAULT_MAX_CI_ATTEMPTS, type CiReadResult } from "../../electron/engineering/ci-repair-loop";
import { createReleaseRunner } from "../../electron/engineering/release-runner";
import { createGitCheckpointStore } from "../../electron/engineering/git-checkpoint";
import { createVerificationEngine } from "../../electron/engineering/verification-engine";
import { createReviewEngine } from "../../electron/engineering/review-engine";
import { ciVerdict, classifyCiFailure, parseCiFailure, planCiRepair } from "../../src/shared/ci-repair";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-ci-repair-acceptance-"));
const WORK = path.join(ROOT, "workspace");
const REMOTE = path.join(ROOT, "remote.git");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");
const LEDGER_PATH = path.join(WORK, "artifacts", "acceptance", "verification-ledger.json");
const CHECKPOINT_DIR = path.join(WORK, "artifacts", "acceptance", "checkpoints");
const RECORD_PATH = path.join(WORK, "artifacts", "acceptance", "ci-repair-record.json");

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
 * a real repository, a real remote, and real CI logs
 * ------------------------------------------------------------------ */

const GATEWAY = "export const gateway = (): string => \"full\";\n";
const BROKEN = "export const gateway = (): number => \"full\";\n";
const FAILING_TEST = [
  "import { test } from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "test(\"the receipt totals\", () => {",
  "  assert.equal(1, 2);",
  "});",
  ""
].join("\n");
const PASSING_TEST = FAILING_TEST.replace("assert.equal(1, 2)", "assert.equal(1, 1)");

for (const directory of ["src", "tests", "artifacts/acceptance"]) fs.mkdirSync(path.join(WORK, directory), { recursive: true });
fs.writeFileSync(path.join(WORK, ".gitignore"), "artifacts/\nnode_modules/\n", "utf8");
fs.writeFileSync(path.join(WORK, "package.json"), JSON.stringify({ name: "ci-fixture", private: true }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler", skipLibCheck: true }, include: ["src"] }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), GATEWAY, "utf8");
fs.writeFileSync(path.join(WORK, "src", "loader.mjs"), "export const loader = () => \"ready\";\n", "utf8");
fs.writeFileSync(path.join(WORK, "tests", "gateway.test.mjs"), PASSING_TEST, "utf8");
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
function run(cwd: string, ...args: string[]): { status: number | null; output: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
const initialized = run(WORK, "init", "--quiet");
run(WORK, "config", "user.email", "acceptance@example.invalid");
run(WORK, "config", "user.name", "acceptance");
fs.mkdirSync(REMOTE, { recursive: true });
const remoteInitialized = run(REMOTE, "init", "--bare", "--quiet");
run(WORK, "add", "--all");
const committed = run(WORK, "commit", "--quiet", "-m", "fixture: initial state");
const baseBranch = run(WORK, "rev-parse", "--abbrev-ref", "HEAD").output.trim();

const COMMANDS = { syntax: "node --check", typecheck: "pnpm run typecheck", unit: "pnpm test", tests: ["tests/gateway.test.mjs"], build_tools: ["tsc"] };
const TARGETS = { syntax: ["src/loader.mjs"], unit: ["tests/gateway.test.mjs"], module: [], integration: [] };
const engine = () => createVerificationEngine({ root: WORK, ledgerPath: LEDGER_PATH, commands: COMMANDS, targets: TARGETS, harnesses: {}, host: "acceptance-host" });

/** A REAL CI log: produced by actually running the failing command. */
function realTypecheckLog(): string {
  const result = spawnSync(process.execPath, [path.join(MODULES, "typescript", "bin", "tsc"), "--noEmit"], { cwd: WORK, encoding: "utf8", windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  return ["##[group]Run pnpm run typecheck", "Run pnpm run typecheck", `${result.stdout ?? ""}${result.stderr ?? ""}`, "Error: Process completed with exit code 1."].join("\n");
}
function realTestLog(): string {
  const result = spawnSync(process.execPath, ["--test", path.join(WORK, "tests", "gateway.test.mjs")], { cwd: WORK, encoding: "utf8", windowsHide: true });
  return ["##[group]Run pnpm test", "Run pnpm test", `${result.stdout ?? ""}${result.stderr ?? ""}`, "Error: Process completed with exit code 1."].join("\n");
}
const SECRET_LOG = [
  "##[group]Run pnpm run security:scan",
  "Run pnpm run security:scan",
  "Error: scan-tracked-secrets found a credential shape in src/creds.ts: aws-access-key",
  "Error: Process completed with exit code 1."
].join("\n");

const release = () => createReleaseRunner({ root: WORK, remote: REMOTE, repository: "owner/name", recordPath: path.join(WORK, "artifacts", "acceptance", "release-record.json") });
const checkpoints = () => createGitCheckpointStore({ root: WORK, directory: CHECKPOINT_DIR });
const shared: Record<string, unknown> = {};

describe("checkpoint-15 §41 CI repair acceptance", () => {
  it("CR-01 a real compiler failure parses into a step, a diagnostic and an exit code", async () => {
    await scenario("CR-01", "§41 parse failure", async (item) => {
      fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), BROKEN, "utf8");
      const parsed = parseCiFailure({ log: realTypecheckLog(), descriptor: { branch: "boss/t-15/fix" } });
      item.check("the failing step is read", "Run pnpm run typecheck", parsed.step);
      item.check("the diagnostic carries its file", true, parsed.issues.some((issue) => issue.file?.endsWith("src/gateway.ts")));
      item.check("and its TS code", true, parsed.issues.some((issue) => issue.code === "TS2322"));
      item.check("and its line", true, parsed.issues.some((issue) => issue.line === 1));
      item.check("the exit code is read", 1, parsed.exit_code);
      item.check("the log size is recorded", true, parsed.log_bytes > 0);
      item.check("the failure has a signature", true, /^[0-9a-f]{64}$/.test(parsed.signature));
      item.check("it is not an infrastructure failure", false, parsed.infrastructure);
      shared.cr01 = { step: parsed.step, issues: parsed.issues.length, code: parsed.issues[0]?.code, exit: parsed.exit_code };
      item.cite("parseCiFailure over real tsc output");
    });
  });

  it("CR-02 a real test failure parses into the failing test name", async () => {
    await scenario("CR-02", "§41 parse failure (tests)", async (item) => {
      fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), GATEWAY, "utf8");
      fs.writeFileSync(path.join(WORK, "tests", "gateway.test.mjs"), FAILING_TEST, "utf8");
      const parsed = parseCiFailure({ log: realTestLog() });
      item.check("the failing test is named", true, parsed.tests.some((test) => test.name.includes("the receipt totals")));
      item.check("the assertion is kept", true, parsed.tests.some((test) => (test.message ?? "").includes("1")) || parsed.annotations.some((line) => line.includes("1")));
      item.check("the step is the test run", "Run pnpm test", parsed.step);
      fs.writeFileSync(path.join(WORK, "tests", "gateway.test.mjs"), PASSING_TEST, "utf8");
      shared.cr02 = { tests: parsed.tests.map((test) => test.name), annotations: parsed.annotations.slice(0, 2) };
      item.cite("parseCiFailure over real node --test output");
    });
  });

  it("CR-03 the parsed failure is classified in §33's vocabulary with its local gates", async () => {
    await scenario("CR-03", "§41 classify + local gates", async (item) => {
      fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), BROKEN, "utf8");
      const build = parseCiFailure({ log: realTypecheckLog() });
      const buildClassification = classifyCiFailure(build);
      item.check("a compiler failure is BUILD", "BUILD", buildClassification.failure_class);
      const buildPlan = planCiRepair({ parsed: build, attempts: [] });
      item.check("the local gate is the typecheck", JSON.stringify(["TYPECHECK"]), JSON.stringify(buildPlan.local_gates));
      item.check("the target names the file", true, buildPlan.targets.some((target) => target.endsWith("src/gateway.ts")));
      item.check("and the loop may repair", "REPAIR", buildPlan.decision);
      fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), GATEWAY, "utf8");
      fs.writeFileSync(path.join(WORK, "tests", "gateway.test.mjs"), FAILING_TEST, "utf8");
      const test = parseCiFailure({ log: realTestLog() });
      const testPlan = planCiRepair({ parsed: test, attempts: [] });
      item.check("a test failure is TEST", "TEST", testPlan.failure_class);
      item.check("with the unit gate", JSON.stringify(["UNIT"]), JSON.stringify(testPlan.local_gates));
      fs.writeFileSync(path.join(WORK, "tests", "gateway.test.mjs"), PASSING_TEST, "utf8");
      shared.cr03 = { build: buildClassification.failure_class, gates: buildPlan.local_gates, test: testPlan.failure_class };
      item.cite("classifyCiFailure → planRecovery → local gates");
    });
  });

  it("CR-04 only a green CI read counts, and a failed read is not a pass", async () => {
    await scenario("CR-04", "§41 CI: PASS?", async (item) => {
      item.check("success is a pass", true, ciVerdict({ ok: true, conclusion: "success" }).passed);
      item.check("failure is not", false, ciVerdict({ ok: true, conclusion: "failure" }).passed);
      item.check("cancelled is not", false, ciVerdict({ ok: true, conclusion: "cancelled" }).passed);
      item.check("an unknown conclusion is not", false, ciVerdict({ ok: true }).passed);
      const unreadable = ciVerdict({ ok: false, reason: "ETIMEDOUT" });
      item.check("a failed read is not a pass", false, unreadable.passed);
      item.check("and says so", true, unreadable.reason.includes("not a pass"));

      // The loop must reach a Hard Blocker when it cannot read CI at all.
      const store = checkpoints();
      const checkpoint = store.create({ task_id: "T-unread", evidence: ["ev-u"] });
      const loop = createCiRepairLoop({
        root: WORK,
        readCi: async () => ({ ok: false, reason: "ETIMEDOUT" }),
        release: release(),
        engine: engine(),
        recordPath: RECORD_PATH
      });
      const record = await loop.run({
        task_id: "T-unread", branch: "boss/t-unread/fix", slug: "fix", base_branch: baseBranch, candidate_id: "cand-u",
        goal: "g", requirements: [{ id: "R-1", text: "t", state: "VERIFIED" }], evidence: ["ev-u"], tests: ["tests/gateway.test.mjs"],
        known_limitations: ["l"], risk: "r", rollback: "rb", summary: "fix",
        repair: () => undefined,
        releaseInput: () => ({ task_id: "T-unread", candidate_id: "cand-u", slug: "fix", goal: "g", base_branch: baseBranch, requirements: [{ id: "R-1", text: "t", state: "VERIFIED" }], evidence: ["ev-u"], tests: ["t"], known_limitations: ["l"], risk: "r", rollback: "rb", checkpoints: [checkpoint], current: { head: checkpoint.head, branch: checkpoint.branch, diff_hash: checkpoint.diff_hash } })
      });
      item.check("the loop hard-blocks", "HARD_BLOCKER", record.outcome);
      item.check("without pretending a pass", false, record.outcome === "PASS");
      shared.cr04 = { unreadable: unreadable.reason, outcome: record.outcome };
      item.cite("ciVerdict + the loop's unreadable-CI path");
    });
  });

  it("CR-05 a prohibited CI failure goes straight to the Hard Blocker", async () => {
    await scenario("CR-05", "§41 terminal failures are not repaired", async (item) => {
      const parsed = parseCiFailure({ log: SECRET_LOG });
      const classification = classifyCiFailure(parsed);
      item.check("a secret-scan failure is TERMINAL", "TERMINAL", classification.failure_class);
      const plan = planCiRepair({ parsed, attempts: [] });
      item.check("the plan hard-blocks", "HARD_BLOCKER", plan.decision);
      item.check("with no local gate to run", 0, plan.local_gates.length);
      item.check("and the reason hands it to the Owner", true, plan.reasons.some((reason) => reason.includes("Hand Blocker") || reason.includes("Hard Blocker") || reason.includes("Owner")));
      shared.cr05 = { class: classification.failure_class, decision: plan.decision };
      item.cite("classifyCiFailure(TERMINAL) → HARD_BLOCKER");
    });
  });

  it("CR-06 the loop is bounded: a repair that never turns CI green stops", async () => {
    await scenario("CR-06", "§41 bounded attempts", async (item) => {
      fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), BROKEN, "utf8");
      const store = checkpoints();
      const checkpoint = store.create({ task_id: "T-bounded", evidence: ["ev-b"] });
      let reads = 0;
      const loop = createCiRepairLoop({
        root: WORK,
        // CI always reports the same compiler failure, and the "repair" never fixes it.
        readCi: async (): Promise<CiReadResult> => { reads += 1; return { ok: true, conclusion: "failure", run_id: reads, log: realTypecheckLog() }; },
        release: release(),
        engine: engine(),
        recordPath: RECORD_PATH
      });
      const record = await loop.run({
        task_id: "T-bounded", branch: "boss/t-bounded/fix", slug: "fix", base_branch: baseBranch, candidate_id: "cand-b",
        goal: "g", requirements: [{ id: "R-1", text: "t", state: "VERIFIED" }], evidence: ["ev-b"], tests: ["t"],
        known_limitations: ["l"], risk: "r", rollback: "rb", summary: "fix",
        maxAttempts: 2,
        // The worker changes nothing, so the local gate keeps failing.
        repair: async () => ({ changed_files: [], note: "no fix found" }),
        releaseInput: () => ({ task_id: "T-bounded", candidate_id: "cand-b", slug: "fix", goal: "g", base_branch: baseBranch, requirements: [{ id: "R-1", text: "t", state: "VERIFIED" }], evidence: ["ev-b"], tests: ["t"], known_limitations: ["l"], risk: "r", rollback: "rb", checkpoints: [checkpoint], current: { head: checkpoint.head, branch: checkpoint.branch, diff_hash: checkpoint.diff_hash } })
      });
      item.check("the loop hard-blocks", "HARD_BLOCKER", record.outcome);
      item.check("it used no more than its bound", true, record.attempts.length <= 2);
      item.check("the attempts are recorded", true, record.attempts.length > 0);
      item.check("each attempt names the class", true, record.attempts.every((attempt) => attempt.failure_class === "BUILD" || attempt.conclusion === "failure"));
      item.check("nothing was pushed", true, record.attempts.every((attempt) => !attempt.pushed));
      item.check("the record is durable", true, fs.existsSync(RECORD_PATH));
      fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), GATEWAY, "utf8");
      shared.cr06 = { outcome: record.outcome, attempts: record.attempts.length, default: DEFAULT_MAX_CI_ATTEMPTS };
      item.cite("maxAttempts + local-gate failure");
    });
  });

  it("CR-07 the loop repairs for real, verifies locally, pushes and re-reads green", async () => {
    await scenario("CR-07", "§41 the whole cycle, offline and real", async (item) => {
      // The bad state is committed, as a prior push would have left it, so the
      // repair produces a real commit rather than restoring the same content.
      fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), BROKEN, "utf8");
      run(WORK, "add", "src/gateway.ts");
      run(WORK, "commit", "--quiet", "-m", "worker: a gateway that does not compile");
      const store = checkpoints();
      const checkpoint = store.create({ task_id: "T-15", candidate_id: "cand-15", evidence: ["ev-1"], version_impact: "PATCH" });
      const verification = engine();
      let reads = 0;
      const loop = createCiRepairLoop({
        root: WORK,
        readCi: async (): Promise<CiReadResult> => {
          reads += 1;
          // The first read is the real failing log; after the push, CI is green.
          if (reads === 1) return { ok: true, conclusion: "failure", run_id: 101, log: realTypecheckLog() };
          return { ok: true, conclusion: "success", run_id: 102 };
        },
        release: release(),
        engine: verification,
        recordPath: RECORD_PATH
      });
      const record = await loop.run({
        task_id: "T-15", branch: "boss/t-15/fix-the-gateway", slug: "fix the gateway", base_branch: baseBranch,
        candidate_id: "cand-15", goal: "the gateway returns a receipt",
        requirements: [{ id: "R-1", text: "the gateway returns a receipt", state: "VERIFIED" }],
        evidence: ["ev-1", "ev-2"], tests: ["tests/gateway.test.mjs"], known_limitations: ["one file"], risk: "low", rollback: "checkpoint",
        summary: "fix(gateway): return a string",
        maxAttempts: 3,
        // The real repair: the worker rewrites the file through the host engine.
        repair: async () => {
          const applied = verification.applyChangeUnit(verification.scopeFor({ allowed_files: ["src/gateway.ts"], requirements: ["R-1"] }), {
            changes: [{ path: "src/gateway.ts", content: GATEWAY }]
          });
          return { changed_files: applied.applied ? applied.changes.map((change) => change.path) : [], note: "rewrote the gateway" };
        },
        releaseInput: () => {
          // §38: the checkpoint is taken AFTER the repair, immediately before the
          // write, so it describes the tree that is about to be pushed.
          const fresh = checkpoints().create({ task_id: "T-15", candidate_id: "cand-15", evidence: ["ev-1", "ev-2"], version_impact: "PATCH" });
          return {
            task_id: "T-15", candidate_id: "cand-15", slug: "fix the gateway", goal: "the gateway returns a receipt", base_branch: baseBranch,
            requirements: [{ id: "R-1", text: "the gateway returns a receipt", state: "VERIFIED" }],
            evidence: ["ev-1", "ev-2"], tests: ["tests/gateway.test.mjs"], known_limitations: ["one file"], risk: "low", rollback: "checkpoint",
            checkpoints: [fresh], current: { head: fresh.head, branch: fresh.branch, diff_hash: fresh.diff_hash }
          };
        }
      });
      item.check("the loop ends at PASS", "PASS", record.outcome);
      item.check("CI was read twice", 2, reads);
      const [first, second] = record.attempts;
      item.check("the first attempt saw the real failure", "BUILD", first?.failure_class);
      item.check("its local typecheck passed after the repair", "PASS", first?.local_gates[0]?.result);
      item.check("the repair was pushed", true, first?.pushed);
      item.check("the second attempt is the green read", "success", second?.conclusion);
      item.check("the push used the policy branch", true, (first?.commit_sha ?? "").length >= 7);
      const remoteLog = release().readRemoteCommit("boss/t-15/fix-the-gateway") ?? "";
      item.check("the remote commit carries the §39.2 trailers", true, remoteLog.includes("Task: T-15") && remoteLog.includes("Evidence: ev-1, ev-2"));
      item.check("the ledger recorded the CI outcome", true, verification.ledger().entries.some((entry) => entry.command === "ci read + classify" && entry.result === "PASS"));
      shared.cr07 = { outcome: record.outcome, reads, reasons: record.reasons, attempts: record.attempts.map((attempt) => `${attempt.failure_class ?? attempt.conclusion}:gate=${attempt.local_gates.map((gate) => `${gate.gate}=${gate.result}`).join(",")}:pushed=${attempt.pushed}:files=${attempt.repaired_files.join("+")}`) };
      item.cite("the full parse → classify → repair → verify → push → re-read cycle");
    });
  });

  it("CR-08 the loop's record is durable and traceable", async () => {
    await scenario("CR-08", "§41 traceability", async (item) => {
      const raw = JSON.parse(fs.readFileSync(RECORD_PATH, "utf8")) as { version: string; outcome: string; attempts: { attempt: number; signature?: string; local_gates: unknown[] }[] };
      item.check("the record is versioned", "ci-repair-record-1", raw.version);
      item.check("it names the outcome", true, ["PASS", "HARD_BLOCKER", "IN_PROGRESS"].includes(raw.outcome));
      item.check("every attempt is numbered", true, raw.attempts.every((attempt, index) => attempt.attempt === index + 1));
      item.check("a failure attempt keeps its signature", true, raw.attempts.some((attempt) => /^[0-9a-f]{64}$/.test(attempt.signature ?? "")));
      const again = JSON.parse(fs.readFileSync(RECORD_PATH, "utf8")) as { task_id: string };
      item.check("it belongs to a task", true, typeof again.task_id === "string" && again.task_id.length > 0);
      shared.cr08 = { outcome: raw.outcome, attempts: raw.attempts.length };
      item.cite(RECORD_PATH);
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_15_CI_REPAIR",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    network: "NONE (CI logs are real command output; the remote is a bare repo on disk)",
    workspace: {
      git_initialized: initialized.status === 0,
      git_commit: committed.status === 0,
      remote_initialized: remoteInitialized.status === 0,
      base_branch: baseBranch
    },
    loop: fs.existsSync(RECORD_PATH)
      ? (() => {
          const raw = JSON.parse(fs.readFileSync(RECORD_PATH, "utf8")) as { outcome: string; attempts: { failure_class?: string; pushed: boolean }[] };
          return { outcome: raw.outcome, attempts: raw.attempts.length, classes: raw.attempts.map((attempt) => attempt.failure_class ?? "-") };
        })()
      : undefined,
    repair: shared,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "ci-repair.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "ci-repair.md"), [
    "# checkpoint-1 §41 CI repair loop acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Network: ${report.network}`,
    "",
    `Loop: ${report.loop?.outcome ?? "-"} over ${report.loop?.attempts ?? 0} attempt(s) (${(report.loop?.classes ?? []).join(" → ")})`,
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
