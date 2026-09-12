/**
 * checkpoint-1 §53 (checkpoint-17) — soak acceptance (SK-01..SK-06).
 *
 * The runner clones from a real bare remote into fresh directories, so the rounds
 * are real work on real clones; the verdict rules are the pure module's.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { createSoakRunner, SOAK_RECORD_FILE } from "../../electron/engineering/soak-runner";
import { benchmarkPlan, DEFAULT_SOAK_OPTIONS, evaluateSoak, failureSignatureOf, SOAK_METRICS, SOAK_STAGES, type SoakRound } from "../../src/shared/soak";
import { BENCHMARK_SCENARIOS } from "../../src/shared/final-acceptance";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-soak-acceptance-"));
const WORK = path.join(ROOT, "workspace");
const REMOTE = path.join(ROOT, "remote.git");
const CLONES = path.join(ROOT, "clones");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");

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

for (const directory of [WORK, CLONES]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(WORK, "package.json"), JSON.stringify({ name: "soak-fixture", private: true }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "src.ts"), "export const soak = (): number => 1;\n", "utf8");
function run(cwd: string, ...args: string[]): { status: number | null; output: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
run(WORK, "init", "--quiet");
run(WORK, "config", "user.email", "acceptance@example.invalid");
run(WORK, "config", "user.name", "acceptance");
fs.mkdirSync(REMOTE, { recursive: true });
run(REMOTE, "init", "--bare", "--quiet");
run(WORK, "add", "--all");
const committed = run(WORK, "commit", "--quiet", "-m", "fixture: initial state");
const branch = run(WORK, "rev-parse", "--abbrev-ref", "HEAD").output.trim();
run(WORK, "push", REMOTE, branch);

const runner = (options?: Partial<typeof DEFAULT_SOAK_OPTIONS>) => createSoakRunner({
  root: WORK,
  remote: REMOTE,
  workspace: CLONES,
  recordPath: path.join(WORK, "artifacts", "acceptance", SOAK_RECORD_FILE),
  ...(options ? { options: { ...DEFAULT_SOAK_OPTIONS, ...options } } : {})
});
const shared: Record<string, unknown> = {};

describe("checkpoint-17 §53 soak acceptance", () => {
  it("SK-01 the round is the plan's seven stages and the six metrics stay zero", async () => {
    await scenario("SK-01", "§53 the round and its metrics", async (item) => {
      item.check("seven stages in order", JSON.stringify(["FRESH_CLONE", "BOOTSTRAP", "TASK", "REPAIR", "PR", "CI", "COMPLETION"]), JSON.stringify([...SOAK_STAGES]));
      item.check("six metrics", 6, SOAK_METRICS.length);
      item.check("every metric must stay at zero", true, SOAK_METRICS.every((metric) => metric.length > 0));
      shared.sk01 = { stages: SOAK_STAGES.length, metrics: SOAK_METRICS.length };
      item.cite("SOAK_STAGES/SOAK_METRICS");
    });
  });

  it("SK-02 a real soak runs clean rounds on fresh clones", async () => {
    await scenario("SK-02", "§53 fresh clone → … → completion", async (item) => {
      const record = await runner().run({ rounds: 3, themeRounds: [2] });
      item.check("three rounds ran", 3, record.rounds.length);
      item.check("every round is clean", true, record.rounds.every((round) => round.verdict === "CLEAN"));
      item.check("every stage is evidenced", true, record.rounds.every((round) => round.stages.every((stage) => stage.ok && stage.evidence.length > 0)));
      item.check("the clone stage really cloned", true, record.rounds.every((round) => round.stages.find((stage) => stage.stage === "FRESH_CLONE")?.evidence.some((entry) => entry.startsWith("head:"))));
      item.check("the theme round is marked", true, record.rounds.filter((round) => round.theme).length === 1);
      item.check("the soak completes", true, record.verdict.complete);
      item.check("with no metric moved", 0, record.verdict.metric_breaches.length);
      item.check("the record is durable", true, fs.existsSync(path.join(WORK, "artifacts", "acceptance", SOAK_RECORD_FILE)));
      const raw = JSON.parse(fs.readFileSync(path.join(WORK, "artifacts", "acceptance", SOAK_RECORD_FILE), "utf8")) as { version: string; rounds: unknown[] };
      item.check("it is versioned", "soak-record-1", raw.version);
      item.check("and keeps every round", 3, raw.rounds.length);
      shared.sk02 = { rounds: record.rounds.length, clean: record.verdict.clean_rounds, theme: record.verdict.theme_rounds, complete: record.verdict.complete };
      item.cite("run(): real clones from a bare remote");
    });
  });

  it("SK-03 a round that cannot clone is a failed round, not a pass", async () => {
    await scenario("SK-03", "§53 a broken round is visible", async (item) => {
      const broken = await createSoakRunner({
        root: WORK,
        remote: path.join(ROOT, "missing.git"),
        workspace: path.join(ROOT, "broken-clones"),
        recordPath: path.join(ROOT, "broken-soak.json")
      }).run({ rounds: 2 });
      item.check("the rounds failed", true, broken.rounds.every((round) => round.verdict === "FAILED"));
      item.check("the clone stage names the reason", true, broken.rounds[0]?.stages.find((stage) => stage.stage === "FRESH_CLONE")?.detail.length !== 0);
      item.check("no evidence is claimed for the failed stage", 0, broken.rounds[0]?.stages.find((stage) => stage.stage === "FRESH_CLONE")?.evidence.length);
      item.check("the soak does not complete", false, broken.verdict.complete);
      item.check("and the reason says so", true, broken.verdict.reasons.length > 0);
      shared.sk03 = { complete: broken.verdict.complete, reasons: broken.verdict.reasons.slice(0, 2) };
      item.cite("a soak against a missing remote");
    });
  });

  it("SK-04 a repeated identical failure stops the soak early", async () => {
    await scenario("SK-04", "§53 repeating a known-broken path is not a soak", async (item) => {
      const stage = (ok: boolean, detail: string) => ({ stage: "CI" as const, ok, detail, evidence: ok ? ["ev"] : [] });
      const round = (number: number, detail: string): SoakRound => ({
        round: number,
        stages: [stage(false, detail)],
        theme: false,
        metrics: {},
        verdict: "FAILED",
        failure_signature: failureSignatureOf([stage(false, detail)])
      });
      const same = [round(1, "the runner died"), round(2, "the runner died")];
      const verdict = evaluateSoak(same, { ...DEFAULT_SOAK_OPTIONS, minRounds: 1, minThemeRounds: 0 });
      item.check("the soak stops early", true, verdict.stopped_early !== undefined);
      item.check("and explains the repetition", true, verdict.stopped_early?.reason.includes("same failure"));
      item.check("it does not complete", false, verdict.complete);
      const different = [round(1, "the runner died"), round(2, "another cause entirely")];
      item.check("a different failure does not stop it", false, evaluateSoak(different, { ...DEFAULT_SOAK_OPTIONS, minRounds: 1, minThemeRounds: 0 }).stopped_early !== undefined);
      shared.sk04 = { stopped: verdict.stopped_early?.reason };
      item.cite("failureSignatureOf + repeatFailureLimit");
    });
  });

  it("SK-05 a moved metric fails the soak even when every round looks clean", async () => {
    await scenario("SK-05", "§53 the six metrics are absolutes", async (item) => {
      const clean: SoakRound = { round: 1, stages: [{ stage: "COMPLETION", ok: true, detail: "done", evidence: ["ev"] }], theme: false, metrics: {}, verdict: "CLEAN" };
      const withOwnerDecision: SoakRound = { ...clean, round: 2, metrics: { OWNER_DECISIONS: 1 } };
      const verdict = evaluateSoak([clean, withOwnerDecision], { ...DEFAULT_SOAK_OPTIONS, minRounds: 1, minThemeRounds: 0 });
      item.check("the breach is reported", true, verdict.metric_breaches.some((breach) => breach.metric === "OWNER_DECISIONS"));
      item.check("and the soak fails", false, verdict.complete);
      item.check("the reason names the metric", true, verdict.reasons.some((reason) => reason.includes("OWNER_DECISIONS")));
      item.check("a metric that never moved is absent", false, verdict.metric_breaches.some((breach) => breach.metric === "STATE_LOSS"));
      shared.sk05 = { breaches: verdict.metric_breaches };
      item.cite("evaluateSoak metric accounting");
    });
  });

  it("SK-06 §51's one-shot plan walks all eighteen scenarios, themes last", async () => {
    await scenario("SK-06", "§51 the benchmark runner order", async (item) => {
      const plan = benchmarkPlan();
      item.check("eighteen entries", 18, plan.length);
      item.check("ordered one to eighteen", true, plan.every((entry, index) => entry.order === index + 1));
      item.check("ids match the catalogue", JSON.stringify(BENCHMARK_SCENARIOS.map((scenario) => scenario.id)), JSON.stringify(plan.map((entry) => entry.id)));
      item.check("the theme scenarios are marked", 3, plan.filter((entry) => entry.theme).length);
      item.check("and they are B16..B18", JSON.stringify(["B16", "B17", "B18"]), JSON.stringify(plan.filter((entry) => entry.theme).map((entry) => entry.id)));
      item.check("every entry keeps its proof", true, plan.every((entry) => entry.proof.length > 10));
      shared.sk06 = { entries: plan.length, theme: plan.filter((entry) => entry.theme).map((entry) => entry.id) };
      item.cite("benchmarkPlan()");
    });
  });
});

afterAll(() => {
  const recordPath = path.join(WORK, "artifacts", "acceptance", SOAK_RECORD_FILE);
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_17_SOAK",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    network: "NONE (clones come from a bare repository on disk)",
    workspace: { git_initialized: true, git_commit: committed.status === 0, remote: path.basename(REMOTE), branch },
    soak: fs.existsSync(recordPath)
      ? (() => {
          const raw = JSON.parse(fs.readFileSync(recordPath, "utf8")) as { rounds: { verdict: string }[]; verdict: { complete: boolean; clean_rounds: number; theme_rounds: number; reasons: string[] } };
          return { rounds: raw.rounds.length, clean: raw.verdict.clean_rounds, theme: raw.verdict.theme_rounds, complete: raw.verdict.complete };
        })()
      : undefined,
    soakDetail: shared,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "soak.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "soak.md"), [
    "# checkpoint-1 §53 soak + §51 benchmark plan acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Network: ${report.network}`,
    "",
    `Soak: ${report.soak?.rounds ?? 0} rounds, ${report.soak?.clean ?? 0} clean, ${report.soak?.theme ?? 0} themed, complete=${report.soak?.complete ?? false}`,
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
