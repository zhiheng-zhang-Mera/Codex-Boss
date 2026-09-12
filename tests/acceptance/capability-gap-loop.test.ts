/**
 * checkpoint-1 §34 (checkpoint-11) — capability gap → self improvement (CG-01..CG-10).
 *
 * The fixture is a real git repository with a real toolchain and a capability it
 * genuinely does not have. The chain is walked with real machinery: the gaps come
 * from a real §33.3 backlog, the probe is `probeCapability` over a real world
 * model, the implementation stage is the §30 loop, the regression test is a real
 * ladder climb, and the knowledge update goes through the real §5.3 gate.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { createRecoveryEngine } from "../../electron/engineering/recovery-engine";
import { createImprovementLoop, type ImprovementLoop } from "../../electron/engineering/improvement-loop";
import { KnowledgeBase } from "../../electron/knowledge/knowledge-base";
import { createVerificationEngine } from "../../electron/engineering/verification-engine";
import { aggregateGaps, chainProblems, qualifiesForImprovement, CAPABILITY_CHAIN } from "../../src/shared/capability-gap";
import type { CapabilityGap } from "../../src/shared/recovery";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-capability-acceptance-"));
const WORK = path.join(ROOT, "workspace");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");
const LEDGER_PATH = path.join(WORK, "artifacts", "acceptance", "verification-ledger.json");
const GAP_PATH = path.join(WORK, "artifacts", "acceptance", "capability-gaps.json");
const REGISTRY_PATH = path.join(WORK, "artifacts", "acceptance", "capability-registry.json");
const KNOWLEDGE_PATH = path.join(WORK, "artifacts", "acceptance", "knowledge-base.json");

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
 * a real workspace that genuinely lacks a capability
 * ------------------------------------------------------------------ */

const CAPABILITY = "receipt rounding engine";
const GATEWAY = "export const gateway = (): string => \"full\";\n";
const APP_BEFORE = "import { gateway } from \"./gateway\";\nexport const app = (): string => gateway();\n";
const ENGINE_FILE = "src/receipt-rounding-engine.ts";
const ENGINE_OK = "export const receiptRoundingEngine = (cents: number): number => Math.round(cents / 5) * 5;\n";
const ENGINE_BROKEN = "export const receiptRoundingEngine = (cents: number): number => \"cents\";\n";
const APP_WIRED = "import { gateway } from \"./gateway\";\nimport { receiptRoundingEngine } from \"./receipt-rounding-engine\";\nexport const app = (): number => receiptRoundingEngine(107);\n";
const UNIT_TEST = [
  "import { test } from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "test(\"the gateway resolves\", () => {",
  "  assert.equal(typeof 1, \"number\");",
  "});",
  ""
].join("\n");

for (const directory of ["src", "tests", "artifacts/acceptance"]) fs.mkdirSync(path.join(WORK, directory), { recursive: true });
fs.writeFileSync(path.join(WORK, ".gitignore"), "artifacts/\nnode_modules/\n", "utf8");
fs.writeFileSync(path.join(WORK, "package.json"), JSON.stringify({ name: "capability-fixture", private: true }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler", skipLibCheck: true }, include: ["src"] }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), GATEWAY, "utf8");
fs.writeFileSync(path.join(WORK, "src", "app.ts"), APP_BEFORE, "utf8");
fs.writeFileSync(path.join(WORK, "src", "loader.mjs"), "export const loader = () => \"ready\";\n", "utf8");
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

function makeLoop(): ImprovementLoop {
  return createImprovementLoop({
    root: WORK,
    gapBacklogPath: GAP_PATH,
    registryPath: REGISTRY_PATH,
    knowledgePath: KNOWLEDGE_PATH,
    ledger: () => createVerificationEngine({ root: WORK, ledgerPath: LEDGER_PATH, commands: COMMANDS, targets: TARGETS }).ledger(),
    scope: "capability-fixture",
    commands: COMMANDS,
    targets: TARGETS
  });
}
const workerWriting = (changes: { path: string; content: string }[]) => () => ({ changes, claims: changes.map((change) => ({ path: change.path })) });
const gap = (overrides: Partial<CapabilityGap> = {}): CapabilityGap => ({
  missing_capability: CAPABILITY,
  task: "round the receipt total for installments",
  failure: "BUILD: no rounding helper exists",
  workaround: "a human computes the rounding by hand",
  frequency: 1,
  severity: "MEDIUM",
  failure_class: "BUILD",
  ...overrides
});
const shared: Record<string, unknown> = {};

describe("checkpoint-11 §34 capability gap → self improvement", () => {
  it("CG-01 reads the gaps a real §33.3 run recorded", async () => {
    await scenario("CG-01", "§34 the gap record is the chain's input", async (item) => {
      const recovery = createRecoveryEngine({ root: WORK, ledger: () => createVerificationEngine({ root: WORK, ledgerPath: LEDGER_PATH }).ledger(), backlogPath: GAP_PATH });
      const classification = recovery.classify({ detail: "Cannot find module './receipt-rounding-engine'", gate: "TYPECHECK" });
      recovery.hns({ classification, task: "round the receipt total", missing_capability: CAPABILITY, workaround: "compute by hand", role: "fallback" });
      recovery.hns({ classification, task: "round the receipt total", missing_capability: CAPABILITY, workaround: "compute by hand", role: "fallback", history: { hns_calls: 1, consecutive_hns_calls: 1 } });
      item.check("the §33.3 backlog really was written", true, fs.existsSync(GAP_PATH));
      const loop = makeLoop();
      const occurrences = loop.readGaps();
      item.check("both occurrences were read back", 2, occurrences.length);
      item.check("each carries the capability", true, occurrences.every((occurrence) => occurrence.gap.missing_capability === CAPABILITY));
      const aggregates = loop.aggregates();
      item.check("they aggregate into one capability", 1, aggregates.length);
      item.check("with the repeat counted", 2, aggregates[0]?.occurrences);
      shared.cg01 = { occurrences: occurrences.length, aggregates: aggregates.length };
      item.cite(GAP_PATH);
    });
  });

  it("CG-02 applies the 'conditions met' thresholds to real gaps", async () => {
    await scenario("CG-02", "§34 达到条件后", async (item) => {
      const loop = makeLoop();
      const aggregate = loop.aggregates()[0]!;
      const qualification = qualifiesForImprovement(aggregate);
      item.check("a repeated gap qualifies", true, qualification.qualifies);
      item.check("the reasons cite both thresholds", true, qualification.reasons.join(" ").includes("repeat threshold") && qualification.reasons.join(" ").includes("always-worth-it"));
      const single = aggregateGaps([{ gap: gap({ severity: "LOW" }), task: "one-off", recorded_at: "2026-01-01T00:00:00.000Z" }])[0]!;
      item.check("a single low-severity occurrence does not", false, qualifiesForImprovement(single).qualifies);
      const severe = aggregateGaps([{ gap: gap({ severity: "CRITICAL" }), task: "one-off", recorded_at: "2026-01-01T00:00:00.000Z" }])[0]!;
      item.check("a single critical occurrence does", true, qualifiesForImprovement(severe).qualifies);
      shared.cg02 = { repeated: qualification.qualifies, singleLow: qualifiesForImprovement(single).qualifies, singleCritical: qualifiesForImprovement(severe).qualifies };
      item.cite("qualifiesForImprovement");
    });
  });

  it("CG-03 the capability really is missing before any work", async () => {
    await scenario("CG-03", "§6.3 probe as the judge", async (item) => {
      const loop = makeLoop();
      const probe = loop.probe(CAPABILITY);
      item.check("the probe reports MISSING", "MISSING", probe.verdict);
      item.check("and says why", true, probe.evidence.length > 0);
      const task = loop.plan(loop.aggregates()[0]!);
      item.check("the improvement task records the previous verdict", "MISSING", task.previous_verdict);
      item.check("the task names the capability", CAPABILITY, task.capability);
      item.check("the task carries the probe that will judge it", CAPABILITY, task.probe.capability);
      item.check("the task is a DELIVERABLE requirement", "DELIVERABLE", task.requirement.type);
      shared.cg03 = { verdict: probe.verdict, task_id: task.id };
      item.cite("probeCapability over the real world model");
    });
  });

  it("CG-04 a change that moves nothing cannot close the gap", async () => {
    await scenario("CG-04", "§34 closure needs the capability, not effort", async (item) => {
      const loop = makeLoop();
      const outcome = await loop.runTask({
        aggregate: loop.aggregates()[0]!,
        worker: () => undefined,
        allowedFiles: [ENGINE_FILE]
      });
      item.check("the implementation loop proposed nothing", "NOTHING_TO_DO", outcome.loop_label);
      item.check("the probe still reports MISSING", "MISSING", outcome.current_verdict);
      item.check("the gap is not closed", false, outcome.closure.closed);
      item.check("and the label says so", "NOT_CLOSED", outcome.closure.label);
      item.check("the chain returns to implementation", "IMPLEMENTATION", outcome.closure.returns_to);
      item.check("the registry keeps it open", "OPEN", outcome.registry.status);
      item.check("the reason names the probe", true, outcome.closure.reasons.some((reason) => reason.includes("still reports MISSING")));
      shared.cg04 = { verdict: outcome.current_verdict, label: outcome.closure.label, status: outcome.registry.status };
      item.cite("closureFor: probe movement is required");
    });
  });

  it("CG-05 a real implementation that wires the capability closes the gap", async () => {
    await scenario("CG-05", "§34 the whole chain, for real", async (item) => {
      const loop = makeLoop();
      const outcome = await loop.runTask({
        aggregate: loop.aggregates()[0]!,
        worker: workerWriting([
          { path: ENGINE_FILE, content: ENGINE_OK },
          { path: "src/app.ts", content: APP_WIRED }
        ]),
        allowedFiles: [ENGINE_FILE, "src/app.ts"]
      });
      item.check("the module was written", true, fs.existsSync(path.join(WORK, ENGINE_FILE)));
      item.check("the implementation loop applied it", true, outcome.loop_label !== "NOTHING_TO_DO");
      item.check("the probe now finds an implementation", "EXISTS", outcome.current_verdict);
      item.check("the regression test really passed", true, outcome.regression.passed);
      item.check("with §31.3 evidence rows", true, (outcome.regression.evidence_ids ?? []).length > 0);
      item.check("the knowledge update was approved by the §5.3 gate", true, ["ACCEPT", "SUPERSEDE"].includes(outcome.knowledge?.outcome ?? "REJECT"));
      item.check("and it names the capability", true, (outcome.knowledge?.subject ?? "").includes(CAPABILITY));
      item.check("the gap is closed", true, outcome.closure.closed);
      item.check("as a gained capability", "CAPABILITY_GAINED", outcome.closure.label);
      item.check("the registry records the movement", true, outcome.registry.status === "GAINED" && outcome.registry.previous_verdict === "MISSING");
      item.check("the chain was walked in order", JSON.stringify([]), JSON.stringify(chainProblems(outcome.steps)));
      item.check("all six stages are recorded", JSON.stringify([...CAPABILITY_CHAIN]), JSON.stringify(outcome.steps.map((step) => step.stage)));
      shared.cg05 = {
        stages: outcome.steps.map((step) => step.stage),
        verdict: outcome.current_verdict,
        label: outcome.closure.label,
        knowledge: outcome.knowledge?.outcome,
        evidence: (outcome.regression.evidence_ids ?? []).length
      };
      item.cite("runTask: loop → regression → probe → knowledge → registry");
    });
  });

  it("CG-06 a failing regression test blocks closure even when the probe moved", async () => {
    await scenario("CG-06", "§34 a broken implementation is not a gained capability", async (item) => {
      const loop = makeLoop();
      const taxCapability = "tax bracket table";
      const aggregate = aggregateGaps([{
        gap: gap({ missing_capability: taxCapability, severity: "HIGH", task: "compute the tax line" }),
        task: "compute the tax line",
        recorded_at: "2026-01-04T00:00:00.000Z"
      }])[0]!;
      const before = loop.probe(taxCapability).verdict;
      item.check("the second capability really is missing", "MISSING", before);
      const outcome = await loop.runTask({
        aggregate,
        // The module is written and wired, but it does not compile.
        worker: workerWriting([
          { path: "src/tax-bracket-table.ts", content: "export const taxBracketTable = (): number => \"brackets\";\n" },
          { path: "src/report.ts", content: "import { taxBracketTable } from \"./tax-bracket-table\";\nexport const report = (): number => taxBracketTable();\n" }
        ]),
        allowedFiles: ["src/tax-bracket-table.ts", "src/report.ts"]
      });
      item.check("the probe moved", true, outcome.current_verdict !== before);
      item.check("the regression test failed", false, outcome.regression.passed);
      item.check("so the gap is not closed", false, outcome.closure.closed);
      item.check("the reason is the regression test", true, outcome.closure.reasons.some((reason) => reason.includes("regression test did not pass")));
      item.check("the record keeps the failing detail", true, (outcome.regression.detail ?? "").length > 0);
      shared.cg06 = { verdict: outcome.current_verdict, label: outcome.closure.label, reasons: outcome.closure.reasons };
      item.cite("regression gate inside the chain");
    });
  });

  it("CG-07 the knowledge update is the real §5.3 object, stored durably", async () => {
    await scenario("CG-07", "§34 Knowledge Update", async (item) => {
      item.check("the knowledge base file exists", true, fs.existsSync(KNOWLEDGE_PATH));
      const base = new KnowledgeBase(KNOWLEDGE_PATH);
      const active = base.active();
      const gapKnowledge = active.filter((object) => object.type === "CAPABILITY_GAP");
      item.check("CAPABILITY_GAP objects were stored", true, gapKnowledge.length > 0);
      const gained = gapKnowledge.filter((object) => object.subject.includes(CAPABILITY) && !object.subject.includes("token="));
      item.check("the gained capability's fact is active", true, gained.length > 0);
      item.check("as host-verified knowledge", true, gained.every((object) => object.authority === "VERIFIED_HOST" && object.provenance.verification === "VERIFIED"));
      item.check("carrying evidence", true, gained.every((object) => object.provenance.verification_evidence.length > 0));
      item.check("sourced from the probe", true, gained.every((object) => object.source === "capability-probe"));
      const unclosed = gapKnowledge.filter((object) => object.subject.includes("tax bracket table"));
      item.check("an unclosed gap's fact stays unverified", true, unclosed.length > 0 && unclosed.every((object) => object.provenance.verification === "UNVERIFIED"));
      item.check("the gate log shows the outcomes", true, base.gateLog().some((entry) => entry.type === "CAPABILITY_GAP" && (entry.outcome === "ACCEPT" || entry.outcome === "SUPERSEDE")));
      shared.cg07 = { active: active.length, capabilityGaps: gapKnowledge.length, gained: gained.length, unclosed: unclosed.length };
      item.cite(KNOWLEDGE_PATH);
    });
  });

  it("CG-08 a knowledge update the gate refuses also blocks closure", async () => {
    await scenario("CG-08", "§34/§5.3 the gate is a door of the chain", async (item) => {
      const loop = makeLoop();
      const tainted = aggregateGaps([{
        gap: gap({ missing_capability: `${CAPABILITY} token=AKIAIOSFODNN7EXAMPLE`, severity: "HIGH" }),
        task: "round the receipt total",
        recorded_at: "2026-01-02T00:00:00.000Z"
      }])[0]!;
      const outcome = await loop.runTask({ aggregate: tainted, worker: () => undefined, allowedFiles: ["src/never.ts"] });
      item.check("the knowledge gate rejected the candidate", "REJECT", outcome.knowledge?.outcome);
      item.check("because it carried a credential shape", true, (outcome.knowledge?.reasons ?? []).some((reason) => reason.toLowerCase().includes("secret")));
      item.check("the gap is not closed", false, outcome.closure.closed);
      item.check("and the knowledge door is named", true, outcome.closure.reasons.some((reason) => reason.includes("knowledge update was REJECT")));
      shared.cg08 = { knowledge: outcome.knowledge?.outcome, reasons: outcome.closure.reasons };
      item.cite("gateKnowledgeWrite inside the chain");
    });
  });

  it("CG-09 the registry and the chain survive a fresh loop", async () => {
    await scenario("CG-09", "§34 capability registry", async (item) => {
      const loop = makeLoop();
      loop.save();
      const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as { version: string; entries: { key: string; capability: string; verdict: string; previous_verdict: string; status: string }[] };
      item.check("the registry file is versioned", "capability-registry-1", raw.version);
      item.check("it holds one entry per capability", raw.entries.length, new Set(raw.entries.map((entry) => entry.key)).size);
      const gained = raw.entries.find((entry) => entry.capability === CAPABILITY)!;
      item.check("the gained capability is registered", "GAINED", gained.status);
      item.check("with the movement the probe proved", "MISSING -> EXISTS", `${gained.previous_verdict} -> ${gained.verdict}`);
      const fresh = makeLoop().registry();
      item.check("a fresh loop reads it back", raw.entries.length, fresh.length);
      item.check("every entry records a status", true, fresh.every((entry) => ["GAINED", "PARTIAL", "OPEN"].includes(entry.status)));
      item.check("and the gap backlog is still readable", true, makeLoop().readGaps().length > 0);
      shared.cg09 = { entries: raw.entries.length, status: gained.status, movement: `${gained.previous_verdict} -> ${gained.verdict}` };
      item.cite(REGISTRY_PATH);
    });
  });

  it("CG-10 only the gaps whose conditions are met become tasks", async () => {
    await scenario("CG-10", "§34 no task for a one-off", async (item) => {
      const loop = makeLoop();
      const items = [
        { aggregate: loop.aggregates()[0]!, label: "repeated" },
        { aggregate: aggregateGaps([{ gap: gap({ missing_capability: "screenshot diffing", severity: "LOW" }), task: "one-off", recorded_at: "2026-01-03T00:00:00.000Z" }])[0]!, label: "one-off" }
      ];
      const decisions = items.map((entry) => ({ label: entry.label, ...loop.qualification(entry.aggregate) }));
      item.check("the repeated gap qualifies", true, decisions[0]?.qualifies);
      item.check("the one-off does not", false, decisions[1]?.qualifies);
      item.check("and the reason is the threshold", true, (decisions[1]?.reasons ?? []).join(" ").includes("repeat threshold 2"));
      item.check("the one-off is still recorded as a gap", true, loop.readGaps().some((occurrence) => occurrence.gap.missing_capability === CAPABILITY));
      item.check("the registry has no entry for it", false, loop.registry().some((entry) => entry.capability === "screenshot diffing"));
      shared.cg10 = decisions;
      item.cite("qualification gate before any task is planned");
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_11_CAPABILITY_GAP",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    workspace: {
      git_initialized: initialized.status === 0,
      git_commit: committed.status === 0,
      typescript_toolchain: fs.existsSync(path.join(MODULES, "typescript", "bin", "tsc")),
      capability_present_after_chain: fs.existsSync(path.join(WORK, ENGINE_FILE))
    },
    chain: { version: "capability-chain-1", stages: [...CAPABILITY_CHAIN] },
    registry: fs.existsSync(REGISTRY_PATH)
      ? (JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as { entries: { capability: string; previous_verdict: string; verdict: string; status: string }[] }).entries
          .map((entry) => ({ capability: entry.capability, movement: `${entry.previous_verdict} -> ${entry.verdict}`, status: entry.status }))
      : [],
    capabilityGaps: shared,
    knowledge: fs.existsSync(KNOWLEDGE_PATH)
      ? new KnowledgeBase(KNOWLEDGE_PATH).active()
          .filter((object) => object.type === "CAPABILITY_GAP")
          .map((object) => ({ subject: object.subject, verification: object.provenance.verification, authority: object.authority, evidence: object.provenance.verification_evidence.length }))
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
  fs.writeFileSync(path.join(REPORT_DIR, "capability-gap.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "capability-gap.md"), [
    "# checkpoint-1 §34 capability gap acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Registry: ${report.registry.map((entry) => `${entry.capability} ${entry.movement} (${entry.status})`).join("; ") || "empty"}`,
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
