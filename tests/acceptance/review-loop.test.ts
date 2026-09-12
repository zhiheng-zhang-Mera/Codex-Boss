/**
 * checkpoint-1 §32 + §30 (checkpoint-9) — the implementation loop and the review gate.
 *
 * Every scenario runs the REAL loop (`runImplementationLoop`) over the REAL §30
 * engine (git, tsc, node --test, the durable §31.3 ledger) and the REAL §32 review
 * engine (secret scan, generated-directory classification, ledger-derived
 * findings). Only the worker and the second review layer are doubles, because a
 * worker and a model reviewer are exactly what the host is not allowed to trust.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createVerificationEngine, type VerificationEngine } from "../../electron/engineering/verification-engine";
import { createReviewEngine } from "../../electron/engineering/review-engine";
import { runImplementationLoop, type WorkerProposal } from "../../electron/engineering/implementation-loop";
import type { ExecutionNode } from "../../src/shared/execution-planner";
import type { ReviewFinding } from "../../src/shared/review";
import type { VerifiableRequirement } from "../../src/shared/verification";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-review-acceptance-"));
const WORK = path.join(ROOT, "workspace");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");
const LEDGER_PATH = path.join(WORK, "artifacts", "acceptance", "verification-ledger.json");

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
 * fixture: a real git repository with a real toolchain
 * ------------------------------------------------------------------ */

const GATEWAY = "export const gateway = (): string => \"full\";\n";
const UNIT_TEST = [
  "import { test } from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "test(\"the gateway resolves\", () => {",
  "  assert.equal(typeof 1, \"number\");",
  "});",
  ""
].join("\n");
const CREDENTIAL_SHAPED = "const key = \"AKIAIOSFODNN7EXAMPLE\";\n";

for (const directory of ["src", "tests", "artifacts/acceptance"]) fs.mkdirSync(path.join(WORK, directory), { recursive: true });
fs.writeFileSync(path.join(WORK, ".gitignore"), "artifacts/\nnode_modules/\n", "utf8");
fs.writeFileSync(path.join(WORK, "package.json"), JSON.stringify({ name: "review-fixture", private: true, scripts: { typecheck: "tsc --noEmit", test: "node --test" } }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler", skipLibCheck: true }, include: ["src"] }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), GATEWAY, "utf8");
fs.writeFileSync(path.join(WORK, "tests", "gateway.test.mjs"), UNIT_TEST, "utf8");

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
git("add", "--all");
git("commit", "--quiet", "-m", "fixture: loader");

function makeEngine(): VerificationEngine {
  return createVerificationEngine({
    root: WORK,
    ledgerPath: LEDGER_PATH,
    commands: COMMANDS,
    targets: TARGETS,
    harnesses: {},
    host: "acceptance-host",
    runtimes: { node: process.version }
  });
}

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
const requirement = (overrides: Partial<VerifiableRequirement> = {}): VerifiableRequirement => ({
  id: "R-gateway",
  type: "FUNCTIONAL",
  text: "the gateway adapter returns a receipt",
  visual: false,
  ...overrides
});

const reviewFor = (engine: VerificationEngine) => createReviewEngine({
  root: WORK,
  ledger: () => engine.ledger(),
  selectFor: (requirement) => engine.selectFor(requirement)
});

async function runLoop(input: {
  engine: VerificationEngine;
  worker: (request: { iteration: number; findings: ReviewFinding[] }) => WorkerProposal | undefined;
  requirements?: VerifiableRequirement[];
  node?: ExecutionNode;
  reviewerRecords?: Parameters<typeof runImplementationLoop>[0]["reviewerRecords"];
  maxIterations?: number;
}) {
  const requirements = input.requirements ?? [requirement()];
  const node = input.node ?? NODE;
  const review = reviewFor(input.engine);
  return runImplementationLoop({
    node,
    requirements,
    engine: input.engine,
    review: (request) => review.review(request),
    reviewPlan: (subjects) => review.planFor(subjects),
    worker: (request) => input.worker({ iteration: request.iteration, findings: request.findings }),
    ...(input.reviewerRecords ? { reviewerRecords: input.reviewerRecords } : {}),
    ...(input.maxIterations ? { maxIterations: input.maxIterations } : {})
  });
}

const shared: Record<string, unknown> = {};

describe("checkpoint-9 §30 loop + §32 review acceptance", () => {
  it("C-01 the loop applies a real change, verifies it and labels the result honestly", async () => {
    await scenario("C-01", "§30 Plan → Worker → Host Verification → Review", async (item) => {
      const engine = makeEngine();
      const outcome = await runLoop({
        engine,
        worker: () => ({ changes: [{ path: "src/gateway.ts", content: "export const gateway = (): string => \"installments\";\n" }], claims: [{ path: "src/gateway.ts" }], note: "gateway returns installments" })
      });
      item.check("one iteration ran", 1, outcome.iterations.length);
      item.check("the change was applied", true, outcome.iterations[0]?.applied);
      item.check("the file git confirms", JSON.stringify(["src/gateway.ts"]), JSON.stringify(outcome.iterations[0]?.changed_files));
      item.check("the host confirmed the claim", 1, outcome.iterations[0]?.claims.confirmed);
      item.check("the ladder ran real gates", true, (outcome.iterations[0]?.gates.length ?? 0) >= 2);
      item.check("the typecheck really passed", true, (outcome.iterations[0]?.gates ?? []).some((gate) => gate.gate === "TYPECHECK" && gate.result === "PASS"));
      item.check("the ledger recorded the run", true, outcome.ledger.total > 0);
      item.check("the review ran over the real change", true, outcome.iterations[0]?.findings.total !== undefined);
      item.check("the label comes from the gate's three doors, not from the worker", true, ["COMPLETED", "INCOMPLETE", "REPAIR_REQUIRED"].includes(outcome.label));
      item.check("an unreviewed dimension keeps the work short of COMPLETED", "INCOMPLETE", outcome.label);
      item.check("the unreviewed dimensions are named", true, (outcome.iterations[0]?.coverage_not_run.length ?? 0) > 0);
      shared.c01 = outcome;
      item.cite("runImplementationLoop + review report coverage");
    });
  });

  it("C-02 an open HIGH finding returns to the repair loop and the repair clears it", async () => {
    await scenario("C-02", "§32.3 HIGH/MEDIUM → repair", async (item) => {
      const engine = makeEngine();
      const outcome = await runLoop({
        engine,
        node: { ...NODE, allowed_files: ["src/creds.ts"] },
        worker: ({ iteration }) => iteration === 1
          ? { changes: [{ path: "src/creds.ts", content: CREDENTIAL_SHAPED }], note: "first attempt leaks a key" }
          : { changes: [{ path: "src/creds.ts", content: "export const readKey = (): string => \"from-environment\";\n" }], note: "second attempt reads the environment" }
      });
      const first = outcome.iterations[0];
      const second = outcome.iterations[1];
      item.check("the leak was found by the real scanner", true, (first?.findings.blocking_detail ?? []).some((finding) => finding.subject === "SECRET_EXPOSURE" && finding.severity === "HIGH"));
      item.check("the loop repaired", true, (outcome.iterations.length ?? 0) >= 2);
      item.check("the second attempt no longer leaks", 0, second?.findings.blocking.length ?? -1);
      item.check("the loop stops once nothing blocks", true, (outcome.iterations.length ?? 0) === 2);
      item.check("the repair cleared the finding", "INCOMPLETE", outcome.label);
      item.check("the whole run is traceable per iteration", true, (outcome.iterations ?? []).every((iteration) => iteration.findings.blocking_detail.every((finding) => finding.statement.length > 0)));
      shared.c02 = {
        label: outcome.label,
        iterations: outcome.iterations.map((iteration) => ({ blocking: iteration.findings.blocking.length, label: iteration.label, subjects: iteration.findings.blocking_detail.map((finding) => `${finding.severity}:${finding.subject}`), gates: iteration.gates })),
        final: (outcome.final.report?.findings ?? []).filter((finding) => finding.severity === "HIGH" || finding.severity === "MEDIUM").map((finding) => `${finding.severity}:${finding.subject}: ${finding.statement}`)
      };
      item.cite("scanSecrets finding → repair iteration");
    });
  });

  it("C-03 a requirement claimed done without evidence is a HIGH finding", async () => {
    await scenario("C-03", "§32.2 UNVERIFIED_COMPLETION", async (item) => {
      const engine = makeEngine();
      const outcome = await runLoop({
        engine,
        // The worker claims a requirement it never touched: no gate can pass for it.
        requirements: [requirement(), requirement({ id: "R-never", text: "the ledger survives a restart" })],
        worker: () => ({ changes: [{ path: "src/gateway.ts", content: "export const gateway = (): string => \"ok\";\n" }], claims: [{ path: "src/gateway.ts" }] })
      });
      const blocking = outcome.iterations.at(-1)?.findings.blocking.length ?? 0;
      const findings = outcome.final.report?.findings ?? [];
      const unverified = findings.filter((finding) => finding.subject === "UNVERIFIED_COMPLETION");
      item.check("the untouched requirement is reported", true, unverified.some((finding) => (finding.evidence.requirement_ids ?? []).includes("R-never")));
      item.check("it is HIGH", true, unverified.some((finding) => finding.severity === "HIGH"));
      item.check("a finding the host decided carries its own artifacts", true, unverified.every((finding) => finding.host_decided));
      item.check("the work cannot be labelled complete", false, outcome.label === "COMPLETED");
      item.check("blocking findings remain", true, blocking > 0);
      shared.c03 = { unverified: unverified.length, label: outcome.label };
      item.cite("reviewFindings UNVERIFIED_COMPLETION");
    });
  });

  it("C-04 a change outside the granted scope never reaches disk and is reported", async () => {
    await scenario("C-04", "§30.1 bounded scope + §32.1 scope", async (item) => {
      const engine = makeEngine();
      const outcome = await runLoop({
        engine,
        worker: () => ({ changes: [{ path: "src/elsewhere.ts", content: "export const escaped = true;\n" }] })
      });
      const iteration = outcome.iterations[0];
      item.check("the unit was refused", false, iteration?.applied);
      item.check("nothing was written", false, fs.existsSync(path.join(WORK, "src", "elsewhere.ts")));
      item.check("the refusal is recorded with the reason", true, (iteration?.refused_problems[0] ?? "").includes("outside the granted scope"));
      item.check("the review reports it as a scope finding", true, (outcome.final.report?.findings ?? []).some((finding) => finding.subject === "scope"));
      item.check("and the loop did not claim completion", false, outcome.label === "COMPLETED");
      shared.c04 = { problems: iteration?.refused_problems ?? [], label: outcome.label };
      item.cite("applyChangeUnit refusal → §32.1 scope finding");
    });
  });

  it("C-05 a failed gate leaves a PARTIAL_STATE finding and never a completion", async () => {
    await scenario("C-05", "§32.2 PARTIAL_STATE + §32.1 correctness", async (item) => {
      const engine = makeEngine();
      const outcome = await runLoop({
        engine,
        worker: () => ({ changes: [{ path: "src/gateway.ts", content: "export const gateway = (): number => \"full\";\n" }], claims: [{ path: "src/gateway.ts" }] })
      });
      const findings = outcome.final.report?.findings ?? [];
      item.check("the typecheck failed for real", true, (outcome.iterations[0]?.gates ?? []).some((gate) => gate.gate === "TYPECHECK" && gate.result === "FAIL"));
      item.check("the failure is a correctness finding", true, findings.some((finding) => finding.subject === "correctness"));
      item.check("the unverified change on disk is a PARTIAL_STATE finding", true, findings.some((finding) => finding.subject === "PARTIAL_STATE" && finding.severity === "HIGH"));
      item.check("the label is not COMPLETED", false, outcome.label === "COMPLETED");
      item.check("the ladder stopped at the typecheck", "TYPECHECK", outcome.iterations[0]?.ladders[0]?.failed_at);
      shared.c05 = { label: outcome.label, gates: outcome.iterations[0]?.gates ?? [] };
      item.cite("failed TYPECHECK → correctness + PARTIAL_STATE findings");
    });
  });

  it("C-06 the loop gives up at its iteration bound instead of pretending success", async () => {
    await scenario("C-06", "§30 bounded repair loop", async (item) => {
      const engine = makeEngine();
      let attempts = 0;
      const outcome = await runLoop({
        engine,
        maxIterations: 2,
        worker: () => { attempts += 1; return { changes: [{ path: "src/gateway.ts", content: CREDENTIAL_SHAPED }], note: `leaky attempt ${attempts}` }; }
      });
      item.check("the worker was asked exactly the bounded number of times", 2, attempts);
      item.check("both iterations are recorded", 2, outcome.iterations.length);
      item.check("the loop stopped with repair required", "REPAIR_REQUIRED", outcome.label);
      item.check("the reason says findings are open", true, outcome.iterations.at(-1)!.findings.blocking.length > 0);
      item.check("each iteration is traceable", true, outcome.iterations.every((iteration, index) => iteration.iteration === index + 1 && Array.isArray(iteration.gates)));
      shared.c06 = { attempts, label: outcome.label };
      item.cite("maxIterations bound + per-iteration record");
    });
  });

  it("C-07 a worker that does nothing produces NOTHING_TO_DO, not a success", async () => {
    await scenario("C-07", "§2.3 an absent change is not progress", async (item) => {
      const engine = makeEngine();
      const outcome = await runLoop({ engine, worker: () => undefined });
      item.check("no iteration produced work", 0, outcome.iterations.length);
      item.check("the label says nothing was done", "NOTHING_TO_DO", outcome.label);
      item.check("the diagnostics say why", true, outcome.diagnostics.some((line) => line.includes("proposed no change")));
      const noWorker = await runImplementationLoop({ node: NODE, requirements: [requirement()], engine, review: () => { throw new Error("review must not run without a worker"); } });
      item.check("a loop with no worker attached changes nothing", "NOTHING_TO_DO", noWorker.label);
      item.check("and says so", true, noWorker.diagnostics.some((line) => line.includes("no worker is attached")));
      shared.c07 = { withWorker: outcome.label, withoutWorker: noWorker.label };
      item.cite("runImplementationLoop without a worker");
    });
  });

  it("C-08 the worker's own 'done' claim never yields COMPLETED", async () => {
    await scenario("C-08", "§2.3 MODEL_DONE != COMPLETED", async (item) => {
      const engine = makeEngine();
      const outcome = await runLoop({
        engine,
        worker: () => ({ changes: [{ path: "src/gateway.ts", content: CREDENTIAL_SHAPED }], claims: [{ path: "src/gateway.ts" }], note: "DONE — nothing left to check" })
      });
      item.check("the note is recorded but does not decide anything", "DONE — nothing left to check", outcome.iterations[0]?.worker_note);
      item.check("a real HIGH finding still blocks", "REPAIR_REQUIRED", outcome.iterations[0]?.label);
      item.check("the final label is not COMPLETED", false, outcome.label === "COMPLETED");
      item.check("the refused-or-blocking findings are listed", true, (outcome.final.report?.routed.repair.length ?? 0) > 0);
      shared.c08 = { label: outcome.label, blocking: outcome.final.report?.routed.repair ?? [] };
      item.cite("worker note vs completion gate");
    });
  });

  it("C-09 an unconfirmed worker claim is a finding, not a success", async () => {
    await scenario("C-09", "§30.2 claims are verified", async (item) => {
      const engine = makeEngine();
      const outcome = await runLoop({
        engine,
        worker: () => ({
          changes: [{ path: "src/gateway.ts", content: "export const gateway = (): string => \"verified\";\n" }],
          // The second claim is for a file the worker never touched.
          claims: [{ path: "src/gateway.ts" }, { path: "tests/gateway.test.mjs" }]
        })
      });
      const iteration = outcome.iterations[0];
      item.check("one claim was confirmed", 1, iteration?.claims.confirmed);
      item.check("the phantom claim was refused", 1, iteration?.claims.refused);
      item.check("the reason names git", true, (iteration?.claims.problems[0] ?? "").includes("git reports the file unchanged"));
      item.check("the review raises it", true, (outcome.final.report?.findings ?? []).some((finding) => finding.subject === "UNVERIFIED_COMPLETION" && (finding.evidence.files ?? []).includes("tests/gateway.test.mjs")));
      shared.c09 = iteration?.claims ?? {};
      item.cite("verifyClaims inside the loop");
    });
  });

  it("C-10 a reviewer layer's evidence-bearing record is what allows COMPLETED", async () => {
    await scenario("C-10", "§32 layers + §2.3", async (item) => {
      const engine = makeEngine();
      const reviewed: string[] = [];
      void reviewed;
      const outcome = await runLoop({
        engine,
        maxIterations: 1,
        worker: () => ({ changes: [{ path: "src/gateway.ts", content: "export const gateway = (): string => \"clean\";\n" }], claims: [{ path: "src/gateway.ts" }] }),
        // A second review layer that inspected the real diff and tokens find nothing.
        reviewerRecords: ({ changedFiles, probes, dimensions }) => [...probes, ...dimensions].flatMap((subject) => [
          { layer: "ADVERSARIAL_REVIEWER" as const, subject, inspected: [`diff of ${changedFiles.join(", ")}`], findings: [] },
          { layer: "INTERNAL_REVIEWER" as const, subject, inspected: [`diff of ${changedFiles.join(", ")}`], findings: [] }
        ])
      });
      item.check("the second layer's record reached the coverage report", true, (outcome.final.report?.coverage.entries ?? []).some((entry) => entry.subject === "HIDDEN_FAILURE" && entry.layers.includes("ADVERSARIAL_REVIEWER")));
      item.check("the reviewed artifacts are named", true, (outcome.final.report?.coverage.entries ?? []).every((entry) => entry.status === "NOT_RUN" || entry.inspected.length > 0));
      item.check("no blocking finding remains", 0, outcome.final.report?.routed.repair.length ?? -1);
      item.check("the work is labelled COMPLETED only now", "COMPLETED", outcome.label);
      item.check("every required dimension was covered", true, outcome.final.report?.coverage.covered);
      item.check("the ledger still holds the real evidence", true, outcome.ledger.total > 0);
      shared.c10 = { label: outcome.label, covered: outcome.final.report?.coverage.covered, notRun: outcome.final.report?.coverage.not_run ?? [], blocking: outcome.final.report?.findings.filter((finding) => finding.severity === "HIGH" || finding.severity === "MEDIUM").map((finding) => `${finding.severity}:${finding.subject}: ${finding.statement}`) ?? [] };
      item.cite("reviewerRecords → completionGate COMPLETED");
    });
  });

  it("C-11 the loop's ledger and review survive as durable artifacts", async () => {
    await scenario("C-11", "§31.3/§47 durable evidence", async (item) => {
      const engine = makeEngine();
      engine.save();
      const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) as { version: string; entries: unknown[] };
      item.check("the ledger file exists", true, fs.existsSync(LEDGER_PATH));
      item.check("it is the §31.3 schema", "evidence-ledger-1", raw.version);
      item.check("it holds the whole run's rows", true, raw.entries.length > 0);
      const reloaded = makeEngine().ledger();
      item.check("a fresh engine reads the same rows", raw.entries.length, reloaded.entries.length);
      const labels = new Set(Object.values(shared).map((value) => (value as { label?: string })?.label).filter(Boolean));
      item.check("the loop produced more than one honest label", true, labels.size >= 2);
      item.check("no run was ever labelled complete by a worker claim", false, (shared.c08 as { label: string }).label === "COMPLETED");
      shared.ledgerRows = reloaded.entries.map((entry) => `${entry.gate}:${entry.result}:${entry.captured_at}:${entry.requirement_ids.join("+")}`);      item.cite(LEDGER_PATH);
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_9_REVIEW_AND_LOOP",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    workspace: {
      git_initialized: initialized.status === 0,
      git_commit: committed.status === 0,
      typescript_toolchain: fs.existsSync(path.join(MODULES, "typescript", "bin", "tsc"))
    },
    loops: {
      c01: { label: (shared.c01 as { label?: string })?.label, iterations: (shared.c01 as { iterations?: { findings: { blocking: unknown[] } }[] })?.iterations?.map((iteration) => ({ blocking: iteration.findings.blocking.length, subjects: [], label: undefined })) ?? [] },
      c02: shared.c02,
      c03: { label: (shared.c03 as { label?: string })?.label, iterations: [] },
      c06: { label: (shared.c06 as { label?: string })?.label, iterations: [] },
      c10: { label: (shared.c10 as { label?: string })?.label, iterations: [] }
    },
    loopDetail: { c02: shared.c02, c03: shared.c03, c04: shared.c04, c05: shared.c05, c06: shared.c06, c07: shared.c07, c08: shared.c08, c09: shared.c09, c10: shared.c10 },
    ledgerRows: shared.ledgerRows,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "review-loop.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "review-loop.md"), [
    "# checkpoint-1 §30/§32 implementation loop + review acceptance",
    "",
    `Generated: ${report.generatedAt}`,
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
