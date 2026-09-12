/**
 * checkpoint-1 §30/§31 (checkpoint-8) — Verification Engine acceptance (V-01..V-10).
 *
 * Every scenario drives the REAL host engine (`electron/engineering/verification-engine`)
 * against a REAL git repository in a temp directory: real `git status`, real
 * `node --check`, real `tsc --noEmit` from the repository's own toolchain, real
 * `node --test`, real files on disk, and the real §31.3 ledger file.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createVerificationEngine, verificationSummary, type VerificationEngine } from "../../electron/engineering/verification-engine";
import { evidenceForRequirements, outstandingEvidence, type EvidenceLedgerFile } from "../../src/shared/evidence-ledger";
import { selectGates } from "../../src/shared/verification";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-verify-acceptance-"));
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
 * a real git workspace with a real toolchain
 * ------------------------------------------------------------------ */

const GATEWAY = "export const gateway = (): string => \"full\";\n";
const SCRATCH = "export const scratch = 1;\n";
const LOADER = "export const loader = () => \"ready\";\n";
const UNIT_TEST = [
  "import { test } from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "test(\"the gateway resolves\", () => {",
  "  assert.equal(typeof 1, \"number\");",
  "});",
  ""
].join("\n");
const INTEGRATION_TEST = [
  "import { test } from \"node:test\";",
  "test(\"the adapter and the gateway agree\", () => {",
  "  assert.equal(1 + 1, 2);",
  "});",
  ""
].join("\n");

for (const directory of ["src", "tests", "artifacts/acceptance"]) fs.mkdirSync(path.join(WORK, directory), { recursive: true });
fs.writeFileSync(path.join(WORK, ".gitignore"), "artifacts/\nnode_modules/\n", "utf8");
fs.writeFileSync(path.join(WORK, "package.json"), JSON.stringify({ name: "verify-fixture", private: true, scripts: { typecheck: "tsc --noEmit", test: "node --test" } }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler", skipLibCheck: true }, include: ["src"] }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), GATEWAY, "utf8");
fs.writeFileSync(path.join(WORK, "src", "scratch.ts"), SCRATCH, "utf8");
fs.writeFileSync(path.join(WORK, "src", "loader.mjs"), LOADER, "utf8");
fs.writeFileSync(path.join(WORK, "tests", "gateway.test.mjs"), UNIT_TEST, "utf8");
fs.writeFileSync(path.join(WORK, "tests", "integration.mjs"), INTEGRATION_TEST, "utf8");
// The fixture carries its own TypeScript toolchain (a real copy, not a symlink:
// `workspacePath` refuses paths that resolve outside the workspace), so
// `runAllowedCommand` runs a genuine `tsc --noEmit`. No vitest is installed, so
// the test rung takes the real `node --test` path.
const MODULES = path.join(WORK, "node_modules");
fs.mkdirSync(path.join(MODULES, "typescript"), { recursive: true });
const TS_SOURCE = path.join(process.cwd(), "node_modules", "typescript");
for (const entry of ["package.json", "bin", "lib"]) {
  fs.cpSync(path.join(TS_SOURCE, entry), path.join(MODULES, "typescript", entry), { recursive: true });
}
/**
 * This repository's TypeScript is the native build, whose launcher resolves a
 * platform package (`@typescript/typescript-<platform>-<arch>`). The fixture must
 * carry it too, or `tsc` would die in its launcher instead of reporting a real
 * diagnostic — which is exactly the failure that must not pass as a type error.
 */
const PLATFORM_NAME = `typescript-${process.platform}-${process.arch}`;
function platformPackageSource(): string | undefined {
  const pnpm = path.join(process.cwd(), "node_modules", ".pnpm");
  if (!fs.existsSync(pnpm)) return undefined;
  const entry = fs.readdirSync(pnpm).find((name) => name.startsWith(`@typescript+${PLATFORM_NAME}@`));
  return entry ? path.join(pnpm, entry, "node_modules", "@typescript", PLATFORM_NAME) : undefined;
}
const PLATFORM_SOURCE = platformPackageSource();
if (PLATFORM_SOURCE) {
  fs.mkdirSync(path.join(MODULES, "@typescript", PLATFORM_NAME), { recursive: true });
  fs.cpSync(PLATFORM_SOURCE, path.join(MODULES, "@typescript", PLATFORM_NAME), { recursive: true });
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

const TARGETS = {
  syntax: ["src/loader.mjs"],
  unit: ["tests/gateway.test.mjs"],
  module: [],
  integration: ["tests/integration.mjs"]
};
const COMMANDS = {
  syntax: "node --check",
  typecheck: "pnpm run typecheck",
  unit: "pnpm test",
  tests: ["tests/gateway.test.mjs"],
  integration: ["tests/integration.mjs"],
  build_tools: ["tsc"]
};

interface EngineHarness {
  engine: VerificationEngine;
  calls: { command: string; files: string[] }[];
}
async function makeEngine(overrides: Partial<Parameters<typeof createVerificationEngine>[0]> = {}): Promise<EngineHarness> {
  const calls: { command: string; files: string[] }[] = [];
  const { runAllowedCommand } = await import("../../electron/engineering/command-runner");
  const engine = createVerificationEngine({
    root: WORK,
    ledgerPath: LEDGER_PATH,
    commands: COMMANDS,
    targets: TARGETS,
    harnesses: {},
    host: "acceptance-host",
    runtimes: { node: process.version, typescript: "local" },
    runAllowed: async (command, files = []) => {
      calls.push({ command, files });
      return runAllowedCommand(WORK, command, files);
    },
    ...overrides
  });
  return { engine, calls };
}

const sha256 = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");
const readLedger = (): EvidenceLedgerFile => JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) as EvidenceLedgerFile;
const requirement = (overrides: { id: string; text: string; type?: Parameters<typeof selectGates>[0]["requirement"]["type"]; visual?: boolean }) => ({
  type: "FUNCTIONAL" as const,
  visual: false,
  ...overrides
});

const shared: {
  scopeProblems?: string[];
  atomicApplied?: boolean;
  atomicWroteInScope?: boolean;
  claims?: ReturnType<VerificationEngine["verifyClaims"]>;
  syntaxRun?: Awaited<ReturnType<VerificationEngine["verifyRequirement"]>>;
  syntaxTypecheckCalls?: number;
  typecheckRun?: Awaited<ReturnType<VerificationEngine["verifyRequirement"]>>;
  fixedRun?: Awaited<ReturnType<VerificationEngine["verifyRequirement"]>>;
  perfUnavailable?: string[];
  perfRun?: Awaited<ReturnType<VerificationEngine["verifyRequirement"]>>;
  ledgerBefore?: number;
  ledgerAfterRerun?: number;
  reloaded?: EvidenceLedgerFile;
  rollback?: { restored: string[]; removed: string[]; contentMatches: boolean; gitClean: boolean };
  refusedReport?: boolean;
  bridge?: ReturnType<typeof evidenceForRequirements>;
  outstanding?: ReturnType<typeof outstandingEvidence>;
} = {};

describe("checkpoint-8 §30/§31 verification engine acceptance", () => {
  it("V-01 a worker cannot write outside the files its plan node granted", async () => {
    await scenario("V-01", "§30.1 bounded worker scope", async (item) => {
      const { engine } = await makeEngine();
      const scope = engine.scopeFor({ allowed_files: ["src/gateway.ts"], requirements: ["R-1"], verification: { commands: ["pnpm run typecheck", "pnpm test"] } });
      item.check("the scope carries the granted files", JSON.stringify(["src/gateway.ts"]), JSON.stringify(scope.allowed_files));
      item.check("the scope carries the plan's commands", JSON.stringify(["syntax", "test", "typecheck"]), JSON.stringify(scope.allowed_commands));
      item.check("the scope names the workspace", WORK, scope.workspace);
      item.check("the scope names the requirements", JSON.stringify(["R-1"]), JSON.stringify(scope.requirement_ids));
      const refused = engine.applyChangeUnit(scope, { changes: [{ path: "src/elsewhere.ts", content: "export const escaped = true;\n" }] });
      item.check("the out-of-scope unit is refused", false, refused.applied);
      item.check("the refusal says why", true, refused.problems.some((problem) => problem.includes("outside the granted scope")));
      item.check("nothing was written", false, fs.existsSync(path.join(WORK, "src", "elsewhere.ts")));
      const emptyScope = engine.scopeFor({ allowed_files: [], requirements: ["R-1"] });
      item.check("an unresolvable scope grants no write at all", 0, emptyScope.allowed_files.length);
      shared.scopeProblems = refused.problems;
      item.cite("WorkerScope + applyChangeUnit refusal");
    });
  });

  it("V-02 a change unit is applied whole or not at all", async () => {
    await scenario("V-02", "§30.3 atomic change unit", async (item) => {
      const { engine } = await makeEngine();
      const scope = engine.scopeFor({ allowed_files: ["src/atomic.ts"], requirements: ["R-2"] });
      const unit = { changes: [{ path: "src/atomic.ts", content: "export const atomic = true;\n" }, { path: "src/forbidden.ts", content: "export const nope = true;\n" }] };
      const refused = engine.applyChangeUnit(scope, unit);
      item.check("the mixed unit is refused", false, refused.applied);
      item.check("the granted file was NOT written", false, fs.existsSync(path.join(WORK, "src", "atomic.ts")));
      item.check("the ungranted file was NOT written", false, fs.existsSync(path.join(WORK, "src", "forbidden.ts")));
      const applied = engine.applyChangeUnit(scope, { changes: [{ path: "src/atomic.ts", content: "export const atomic = true;\n" }] });
      item.check("a wholly granted unit is applied", true, applied.applied);
      item.check("the change is reported with its hash", sha256("export const atomic = true;\n"), applied.changes[0]?.after_sha256);
      item.check("a new file records no previous hash", null, applied.changes[0]?.before_sha256);
      shared.atomicApplied = applied.applied;
      shared.atomicWroteInScope = fs.existsSync(path.join(WORK, "src", "atomic.ts"));
      applied.rollback();
      item.cite("applyChangeUnit preflight + atomicity");
    });
  });

  it("V-03 a worker's claim is only believed when git and the disk confirm it", async () => {
    await scenario("V-03", "§30.2 git diff + file existence + content hash", async (item) => {
      const { engine } = await makeEngine();
      const scope = engine.scopeFor({ allowed_files: ["src/verified.ts"], requirements: ["R-3"] });
      const content = "export const verified = 42;\n";
      const applied = engine.applyChangeUnit(scope, { changes: [{ path: "src/verified.ts", content }] });
      item.check("the change was applied", true, applied.applied);
      const verification = engine.verifyClaims([
        { path: "src/verified.ts", claimed_sha256: sha256(content) },
        { path: "src/gateway.ts" },
        { path: "src/never.ts", claimed_sha256: sha256("x") }
      ]);
      item.check("git answered", true, verification.git.available);
      item.check("git sees the real modification", true, verification.git.changed.includes("src/verified.ts"));
      item.check("the confirmed claim passes", true, verification.verdicts[0]?.ok);
      item.check("an unmodified file cannot be claimed as changed", false, verification.verdicts[1]?.ok);
      item.check("the reason names git", true, verification.verdicts[1]?.problem?.includes("git reports the file unchanged") ?? false);
      item.check("a claim for a file that does not exist fails", false, verification.verdicts[2]?.ok);
      item.check("the observation carries the real hash", sha256(content), verification.observations.find((entry) => entry.path === "src/verified.ts")?.sha256);
      shared.claims = verification;
      item.cite("verifyClaims over the real working tree");
    });
  });

  it("V-04 the ladder stops at the cheapest failing rung", async () => {
    await scenario("V-04", "§31.1 fail-fast climbing", async (item) => {
      const { engine, calls } = await makeEngine({ targets: { ...TARGETS, syntax: ["src/broken.mjs"] } });
      const scope = engine.scopeFor({ allowed_files: ["src/broken.mjs"], requirements: ["R-syntax"] });
      const applied = engine.applyChangeUnit(scope, { changes: [{ path: "src/broken.mjs", content: "export const broken = (;\n" }] });
      item.check("the broken file was written", true, applied.applied);
      const selection = engine.selectFor(requirement({ id: "R-syntax", text: "the checkout module loads without a syntax error" }));
      item.check("syntax is the first rung", "SYNTAX", selection.gates[0]?.gate);
      const run = await engine.verifyRequirement(selection);
      item.check("the climb failed", "FAIL", run.outcome.outcome);
      item.check("it failed at syntax", "SYNTAX", run.outcome.failed_at);
      item.check("the typecheck was never executed", 0, calls.filter((call) => call.command === "typecheck").length);
      const skipped = run.entries.filter((entry) => entry.result === "SKIPPED").map((entry) => entry.gate);
      item.check("the rungs above the failure are recorded as skipped", true, skipped.includes("TYPECHECK"));
      item.check("no rung above the failure claims a pass", 0, run.entries.filter((entry) => entry.result === "PASS" && entry.gate !== "SYNTAX").length);
      shared.syntaxRun = run;
      shared.syntaxTypecheckCalls = calls.filter((call) => call.command === "typecheck").length;
      applied.rollback();
      item.cite("ladderOutcome + evidenceInputsForRun");
    });
  });

  it("V-05 a real typecheck and a real test decide the verdict", async () => {
    await scenario("V-05", "§30.2/§31.1 real typecheck and targeted tests", async (item) => {
      const { engine } = await makeEngine();
      const scope = engine.scopeFor({ allowed_files: ["src/gateway.ts"], requirements: ["R-typed"] });
      const broken = "export const gateway = (): number => \"full\";\n";
      engine.applyChangeUnit(scope, { changes: [{ path: "src/gateway.ts", content: broken }] });
      const selection = engine.selectFor(requirement({ id: "R-typed", text: "the checkout gateway returns a receipt" }));
      const failed = await engine.verifyRequirement(selection);
      item.check("the typecheck rung failed", "FAIL", failed.outcome.outcome);
      item.check("the failure is the typecheck", "TYPECHECK", failed.outcome.failed_at);
      const typecheckEntry = failed.entries.find((entry) => entry.gate === "TYPECHECK");
      item.check("a real exit code is recorded", true, (typecheckEntry?.exit_code ?? 0) !== 0);
      item.check("the command is the real argv", true, (typecheckEntry?.command ?? "").includes("tsc"));
      item.check("the failure is a real compiler diagnostic, not a broken launcher", true, (typecheckEntry?.detail ?? "").includes("TS2322"));
      item.check("an executed rung records its duration", true, typeof typecheckEntry?.duration_ms === "number");
      const unitBefore = failed.entries.find((entry) => entry.gate === "UNIT");
      item.check("the test rung never ran after the typecheck failed", "SKIPPED", unitBefore?.result);
      shared.typecheckRun = failed;

      engine.applyChangeUnit(scope, { changes: [{ path: "src/gateway.ts", content: GATEWAY }] });
      const fixed = await engine.verifyRequirement(selection);
      item.check("the fixed tree passes the ladder", "PASS", fixed.outcome.outcome);
      const gatesPassed = fixed.entries.filter((entry) => entry.result === "PASS").map((entry) => entry.gate);
      item.check("the typecheck really passed", true, gatesPassed.includes("TYPECHECK"));
      item.check("the targeted test really ran and passed", true, gatesPassed.includes("UNIT"));
      const unit = fixed.entries.find((entry) => entry.gate === "UNIT");
      item.check("the test entry carries its command", true, (unit?.command ?? "").includes("gateway.test.mjs"));
      item.check("the test entry carries the zero exit code", 0, unit?.exit_code);
      shared.fixedRun = fixed;
      item.cite("TYPECHECK/UNIT EvidenceEntry rows with real exit codes");
    });
  });

  it("V-06 a harness-only rung is never faked, and a real report satisfies it", async () => {
    await scenario("V-06", "§31.2 benchmark routing + external harness report", async (item) => {
      const perf = requirement({ id: "R-perf", text: "the checkout response stays under 100 ms", type: "NON_FUNCTIONAL" });
      const bare = await makeEngine();
      const noHarness = bare.engine.selectFor(perf);
      item.check("without a harness the benchmark is not selected", false, noHarness.gates.some((decision) => decision.gate === "BENCHMARK"));
      item.check("the missing harness is reported", true, noHarness.unavailable.some((entry) => entry.gate === "BENCHMARK" && entry.reason.includes("no benchmark harness")));
      const withHarness = await makeEngine({ harnesses: { benchmark: true } });
      const selection = withHarness.engine.selectFor(perf);
      item.check("with a harness the benchmark is selected", true, selection.gates.some((decision) => decision.gate === "BENCHMARK"));

      const reportPath = path.join(WORK, "artifacts", "acceptance", "bench-report.json");
      fs.writeFileSync(reportPath, JSON.stringify({ passed: true, p95_ms: 61, samples: 200 }, null, 2), "utf8");
      const refused = withHarness.engine.ingestReport({ path: "../outside.json", gate: "BENCHMARK", requirement_ids: ["R-perf"], passed: true });
      item.check("a report outside the workspace is refused", undefined, refused);
      const entry = withHarness.engine.ingestReport({ path: "artifacts/acceptance/bench-report.json", gate: "BENCHMARK", requirement_ids: ["R-perf"], passed: true, detail: "p95 61 ms over 200 samples" });
      item.check("the real report is ingested with its hash", sha256(fs.readFileSync(reportPath, "utf8")), entry?.hash);
      item.check("the entry points at the artifact", "artifacts/acceptance/bench-report.json", entry?.artifact);

      const run = await withHarness.engine.verifyRequirement(selection);
      const benchmark = run.entries.find((entry_) => entry_.gate === "BENCHMARK");
      item.check("the benchmark rung passes from the report", "PASS", benchmark?.result);
      item.check("the strongest passing rung is the benchmark", true, run.outcome.reason.trim().endsWith("BENCHMARK"));
      shared.perfUnavailable = noHarness.unavailable.map((entry_) => entry_.gate);
      shared.perfRun = run;
      item.cite("ingestReport + BENCHMARK rung");
    });
  });

  it("V-07 the ledger is durable and does not double-count a re-run", async () => {
    await scenario("V-07", "§31.3 durable Evidence Ledger", async (item) => {
      const { engine } = await makeEngine();
      const saved = engine.save();
      item.check("the ledger was written where it was asked to be", LEDGER_PATH, saved);
      item.check("the file exists", true, fs.existsSync(LEDGER_PATH));
      const before = readLedger();
      item.check("the ledger is versioned", "evidence-ledger-1", before.version);
      item.check("the ledger holds the earlier scenarios' entries", true, before.entries.length > 0);
      const selection = engine.selectFor(requirement({ id: "R-typed", text: "the checkout gateway returns a receipt" }));
      const rerun = await engine.verifyRequirement(selection);
      engine.save();
      const after = readLedger();
      item.check("a repeated identical verification adds no new row", before.entries.length, after.entries.length);
      item.check("but the run still reports its rungs", true, rerun.entries.length > 0);
      const reloaded = (await makeEngine()).engine.ledger();
      item.check("a fresh engine reads the durable ledger", after.entries.length, reloaded.entries.length);
      item.check("every entry is bound to a requirement", true, reloaded.entries.every((entry) => entry.requirement_ids.length > 0));
      item.check("every entry carries a hash", true, reloaded.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.hash)));
      item.check("every entry carries an environment", true, reloaded.entries.every((entry) => entry.environment.host === "acceptance-host" && entry.environment.platform.length > 0));
      item.check("every entry carries a timestamp", true, reloaded.entries.every((entry) => !Number.isNaN(Date.parse(entry.captured_at))));
      shared.ledgerBefore = before.entries.length;
      shared.ledgerAfterRerun = after.entries.length;
      shared.reloaded = reloaded;
      item.cite(LEDGER_PATH);
    });
  });

  it("V-08 a change unit is rollbackable to the exact previous bytes", async () => {
    await scenario("V-08", "§30.3 rollbackable change unit", async (item) => {
      const { engine } = await makeEngine();
      const scope = engine.scopeFor({ allowed_files: ["src/scratch.ts"], requirements: ["R-rollback"] });
      const before = fs.readFileSync(path.join(WORK, "src", "scratch.ts"), "utf8");
      const applied = engine.applyChangeUnit(scope, { changes: [{ path: "src/scratch.ts", content: "export const scratch = 99;\n" }] });
      item.check("the change was applied", true, applied.applied);
      item.check("the file really changed on disk", "export const scratch = 99;\n", fs.readFileSync(path.join(WORK, "src", "scratch.ts"), "utf8"));
      const restored = applied.rollback();
      const content = fs.readFileSync(path.join(WORK, "src", "scratch.ts"), "utf8");
      item.check("rollback reports the restored file", JSON.stringify(["src/scratch.ts"]), JSON.stringify(restored.restored));
      item.check("the bytes are identical to before", sha256(before), sha256(content));
      const status = git("status", "--porcelain", "--", "src/scratch.ts");
      item.check("git reports the path clean again", "", status.output.trim());
      shared.rollback = { restored: restored.restored, removed: restored.removed, contentMatches: sha256(before) === sha256(content), gitClean: status.output.trim() === "" };
      item.cite("rollback() restores exact bytes + clean git status");
    });
  });

  it("V-09 the engine cannot manufacture the evidence it does not produce", async () => {
    await scenario("V-09", "§2.3/§31.3 no invented evidence", async (item) => {
      const { engine } = await makeEngine();
      const visual = engine.selectFor(requirement({ id: "R-visual", text: "the theme panel is visible on the desktop window", type: "VISUAL", visual: true }));
      item.check("a visual requirement needs a screenshot", true, visual.external_evidence.includes("SCREENSHOT"));
      item.check("and a preview", true, visual.external_evidence.includes("PREVIEW"));
      item.check("the engine still plans runnable rungs", true, visual.gates.length > 0);
      const acceptance = engine.selectFor(requirement({ id: "R-acc", text: "AC-1 the gateway falls back to full payment", type: "ACCEPTANCE" }));
      item.check("an acceptance criterion needs a review", true, acceptance.external_evidence.includes("REVIEW"));
      const run = await engine.verifyRequirement(visual);
      const kinds = new Set(run.entries.map((entry) => entry.gate));
      item.check("no screenshot gate was invented", false, kinds.has("SCREENSHOT" as never));
      item.check("no visual rung reported a pass it never ran", false, run.entries.some((entry) => entry.gate === "VISUAL" && entry.result === "PASS"));
      shared.refusedReport = true;
      item.cite("external_evidence + NOT_RUN/SKIPPED rows");
    });
  });

  it("V-10 the ledger bridges into the §28.4 requirement binding", async () => {
    await scenario("V-10", "§28.4/§31.3 outstanding evidence", async (item) => {
      const { engine } = await makeEngine();
      engine.save();
      const ledger = engine.ledger();
      const graph = {
        nodes: [
          { id: "R-typed", type: "FUNCTIONAL" as const, visual: false, text: "the checkout gateway returns a receipt" },
          { id: "R-visual", type: "VISUAL" as const, visual: true, text: "the theme panel is visible on the desktop window" }
        ]
      };
      const evidence = evidenceForRequirements(ledger, graph);
      item.check("evidence exists for the requirements the ledger covers", true, evidence.length > 0);
      item.check("the evidence is sourced from a host gate", true, evidence.every((entry) => entry.source.includes(":") && entry.hash.length > 0));
      const implementation = evidence.find((entry) => entry.requirement_id === "R-typed" && entry.kind === "IMPLEMENTATION");
      item.check("the passing typecheck becomes IMPLEMENTATION evidence", "PASS", implementation?.status);
      const outstanding = outstandingEvidence(ledger, graph);
      const visualGap = outstanding.find((entry) => entry.requirement_id === "R-visual");
      item.check("the visual requirement is still owed its screenshot", true, (visualGap?.missing ?? []).includes("SCREENSHOT"));
      item.check("and its review", true, (visualGap?.missing ?? []).includes("REVIEW") || (visualGap?.missing ?? []).includes("PREVIEW"));
      item.check("a requirement whose evidence the ledger holds is not outstanding for it", false, (visualGap?.missing ?? []).includes("IMPLEMENTATION") && (visualGap?.missing ?? []).includes("TEST"));
      const summary = verificationSummary(engine);
      item.check("the summary counts the durable rows", ledger.entries.length, summary.total);
      const rankOf = (id: string): number => summary.requirements.find((entry) => entry.requirement_id === id)?.highest_rank ?? 0;
      item.check("a requirement whose every rung failed is not ranked", 0, rankOf("R-syntax"));
      item.check("a requirement with a passing test is ranked by that rung", true, rankOf("R-typed") >= 3);
      // The engine's own rungs can never make a visual requirement visual.
      item.check("a visual requirement never reaches the visual rungs", true, rankOf("R-visual") < 11);
      item.check("and it has no passing visual row", false, ledger.entries.some((entry) => entry.gate === "VISUAL" && entry.result === "PASS"));
      shared.bridge = evidence;
      shared.outstanding = outstanding;
      item.cite("evidenceForRequirements + outstandingEvidence");
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_8_VERIFICATION_ENGINE",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
      workspace: {
        git_initialized: initialized.status === 0,
        git_commit: committed.status === 0,
        typescript_toolchain: fs.existsSync(path.join(MODULES, "typescript", "bin", "tsc")),
        typescript_platform_package: PLATFORM_SOURCE !== undefined && fs.existsSync(path.join(MODULES, "@typescript", PLATFORM_NAME, "package.json"))
      },
    ledger: shared.reloaded
      ? {
          path: path.relative(process.cwd(), LEDGER_PATH),
          entries: shared.reloaded.entries.length,
          before_rerun: shared.ledgerBefore,
          after_rerun: shared.ledgerAfterRerun,
          by_gate: shared.reloaded.entries.reduce<Record<string, number>>((counts, entry) => {
            counts[entry.gate] = (counts[entry.gate] ?? 0) + 1;
            return counts;
          }, {})
        }
      : undefined,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "verification-engine.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "verification-engine.md"), [
    "# checkpoint-1 §30/§31 verification engine acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Ledger rows: ${report.ledger?.entries ?? 0} (re-run added ${((report.ledger?.after_rerun ?? 0) - (report.ledger?.before_rerun ?? 0))})`,
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
