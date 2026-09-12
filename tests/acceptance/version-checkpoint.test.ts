/**
 * checkpoint-1 §37/§38 (checkpoint-13) — version impact + Git checkpoint (VC-01..VC-08).
 *
 * The store runs real git in a real repository: the checkpoint records the actual
 * HEAD/branch/diff, the impact assessment reads each changed file's exported
 * symbols from `git show HEAD:<path>` and from disk, and the rollback really
 * restores the working tree.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { createGitCheckpointStore } from "../../electron/engineering/git-checkpoint";
import { createVerificationEngine } from "../../electron/engineering/verification-engine";
import { suggestedVersion } from "../../src/shared/version-impact";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-checkpoint-acceptance-"));
const WORK = path.join(ROOT, "workspace");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");
const CHECKPOINT_DIR = path.join(WORK, "artifacts", "acceptance", "checkpoints");
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
 * a real repository with real history
 * ------------------------------------------------------------------ */

const GATEWAY = "export const gateway = (): string => \"full\";\nexport const parse = (value: string): string => value.trim();\n";
for (const directory of ["src/shared", "src/renderer", "tests", "docs", "artifacts/acceptance"]) fs.mkdirSync(path.join(WORK, directory), { recursive: true });
fs.writeFileSync(path.join(WORK, ".gitignore"), "artifacts/\nnode_modules/\n", "utf8");
fs.writeFileSync(path.join(WORK, "package.json"), JSON.stringify({ name: "checkpoint-fixture", version: "1.4.2", private: true }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "src", "shared", "api.ts"), GATEWAY, "utf8");
fs.writeFileSync(path.join(WORK, "src", "shared", "theme.ts"), "export const THEME_SCHEMA_VERSION = 1;\n", "utf8");
fs.writeFileSync(path.join(WORK, "src", "renderer", "app.tsx"), "export const App = (): string => \"v1\";\n", "utf8");
fs.writeFileSync(path.join(WORK, "tests", "api.test.mjs"), "export const ok = true;\n", "utf8");
fs.writeFileSync(path.join(WORK, "docs", "readme.md"), "# fixture\n", "utf8");

function git(...args: string[]): { status: number | null; output: string } {
  const result = spawnSync("git", args, { cwd: WORK, encoding: "utf8", windowsHide: true });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
const initialized = git("init", "--quiet");
git("config", "user.email", "acceptance@example.invalid");
git("config", "user.name", "acceptance");
git("add", "--all");
const committed = git("commit", "--quiet", "-m", "fixture: initial state");
const initialHead = git("rev-parse", "HEAD").output.trim();

const store = () => createGitCheckpointStore({ root: WORK, directory: CHECKPOINT_DIR });
const shared: Record<string, unknown> = {};

describe("checkpoint-13 §37/§38 acceptance", () => {
  it("VC-01 a documentation-only change is NONE and an implementation change is PATCH", async () => {
    await scenario("VC-01", "§37 impact from what changed", async (item) => {
      fs.appendFileSync(path.join(WORK, "docs", "readme.md"), "\nmore docs\n", "utf8");
      const docs = store().assess();
      item.check("documents alone are NONE", "NONE", docs.impact);
      item.check("the host decides, not a worker", "HOST", docs.decided_by);
      git("checkout", "--", "docs/readme.md");
      fs.appendFileSync(path.join(WORK, "src", "shared", "api.ts"), "export const helper = (): number => 1;\n", "utf8");
      const implementation = store().assess();
      item.check("an added export is MINOR", "MINOR", implementation.impact);
      item.check("the API factor is cited with the symbol", true, implementation.findings.some((finding) => finding.factor === "API" && finding.evidence[0]?.includes("#helper")));
      item.check("the assessment is hashed", true, /^[0-9a-f]{64}$/.test(implementation.hash));
      item.check("the suggested bump follows semver", "1.5.0", suggestedVersion(implementation, "1.4.2")?.to);
      git("checkout", "--", "src/shared/api.ts");
      shared.vc01 = { docs: docs.impact, implementation: implementation.impact };
      item.cite("assess() over the real diff");
    });
  });

  it("VC-02 a breaking removal is MAJOR and a worker's softer claim is rejected", async () => {
    await scenario("VC-02", "§37 the worker does not decide", async (item) => {
      fs.writeFileSync(path.join(WORK, "src", "shared", "api.ts"), "export const parse = (value: string): string => value.trim();\n", "utf8");
      const assessment = store().assess({ worker_claim: "PATCH", current_version: "1.4.2" });
      item.check("the removal is MAJOR", "MAJOR", assessment.impact);
      item.check("the worker's PATCH claim is rejected", 1, assessment.rejected_claims.length);
      item.check("with the host's reasoning", true, assessment.rejected_claims[0]?.reason.includes("does not let a worker decide"));
      item.check("the bump is a major", "2.0.0", suggestedVersion(assessment, "1.4.2")?.to);
      const agreeing = store().assess({ worker_claim: "MAJOR" });
      item.check("an agreeing claim is not rejected", 0, agreeing.rejected_claims.length);
      git("checkout", "--", "src/shared/api.ts");
      shared.vc02 = { impact: assessment.impact, rejected: assessment.rejected_claims };
      item.cite("git show HEAD:src/shared/api.ts vs disk");
    });
  });

  it("VC-03 a theme package is NONE/PATCH and the theme contract forces re-assessment", async () => {
    await scenario("VC-03", "§37 theme special cases", async (item) => {
      const themeDir = path.join(WORK, "artifacts", "themes", "neon");
      fs.mkdirSync(themeDir, { recursive: true });
      fs.writeFileSync(path.join(themeDir, "tokens.json"), "{}\n", "utf8");
      const theme = store().assess();
      item.check("a theme package is at most PATCH", true, theme.impact === "NONE" || theme.impact === "PATCH");
      fs.rmSync(themeDir, { recursive: true, force: true });
      fs.appendFileSync(path.join(WORK, "src", "shared", "theme.ts"), "export const neons = 1;\n", "utf8");
      const contract = store().assess();
      item.check("the theme engine contract change demands re-assessment", true, contract.requires_reevaluation);
      item.check("and says so", true, contract.reason.includes("re-assessed"));
      git("checkout", "--", "src/shared/theme.ts");
      shared.vc03 = { theme: theme.impact, reevaluation: contract.requires_reevaluation };
      item.cite("theme_package + theme_engine_contract classification");
    });
  });

  it("VC-04 the checkpoint records the six things §38 asks for, durably", async () => {
    await scenario("VC-04", "§38 HEAD/branch/diff/task/candidate/evidence", async (item) => {
      fs.appendFileSync(path.join(WORK, "src", "renderer", "app.tsx"), "export const v2 = (): number => 2;\n", "utf8");
      const checkpoint = store().create({
        task_id: "task-13",
        candidate_id: "cand-13",
        evidence: ["ev-a", "ev-b"],
        worker_claim: "NONE",
        current_version: "1.4.2"
      });
      item.check("HEAD is the real commit", initialHead, checkpoint.head);
      item.check("the branch is the real one", git("rev-parse", "--abbrev-ref", "HEAD").output.trim(), checkpoint.branch);
      item.check("the diff was captured and hashed", true, /^[0-9a-f]{64}$/.test(checkpoint.diff_hash) && checkpoint.diff_bytes > 0);
      item.check("the task is recorded", "task-13", checkpoint.task_id);
      item.check("the candidate is recorded", "cand-13", checkpoint.candidate_id);
      item.check("the evidence is recorded", JSON.stringify(["ev-a", "ev-b"]), JSON.stringify(checkpoint.evidence));
      item.check("the changed files are recorded", true, checkpoint.changed_files.includes("src/renderer/app.tsx"));
      item.check("the §37 assessment travels with it", "MINOR", checkpoint.version_impact);
      const file = store().save() + path.sep + checkpoint.id + ".json";
      item.check("the record is durable on disk", true, fs.existsSync(file));
      const reloaded = store().checkpoints();
      item.check("a fresh store reads it back", checkpoint.id, reloaded[0]?.id);
      item.check("with the same HEAD", checkpoint.head, reloaded[0]?.head);
      shared.vc04 = { id: checkpoint.id, head: checkpoint.head.slice(0, 12), impact: checkpoint.version_impact, files: checkpoint.changed_files };
      item.cite(file);
    });
  });

  it("VC-05 a GitHub write is refused without a checkpoint and after drift", async () => {
    await scenario("VC-05", "§38 no remote write without a checkpoint", async (item) => {
      const other = store();
      // A different task has no checkpoint at all.
      const noCheckpoint = other.guard("PUSH", "task-never");
      item.check("the push is refused", false, noCheckpoint.allowed);
      item.check("and the reason says why", true, noCheckpoint.reason.includes("no local checkpoint"));
      const allowed = store().guard("PUSH", "task-13");
      item.check("with a current checkpoint the push is allowed", true, allowed.allowed);
      item.check("and it names the checkpoint", true, (allowed.checkpoint?.id ?? "").length > 0);
      fs.appendFileSync(path.join(WORK, "src", "renderer", "app.tsx"), "export const v3 = (): number => 3;\n", "utf8");
      const drifted = store().guard("PUSH", "task-13");
      item.check("after an edit the checkpoint no longer covers the push", false, drifted.allowed);
      item.check("the drift is explained", true, drifted.reason.includes("changed after the checkpoint"));
      shared.vc05 = { refused: noCheckpoint.reason, allowed: allowed.allowed, drifted: drifted.reason };
      item.cite("guardGitHubWrite over the real diff hash");
    });
  });

  it("VC-06 a rollback really restores the working tree", async () => {
    await scenario("VC-06", "§38 rollback to the recorded HEAD", async (item) => {
      const before = fs.readFileSync(path.join(WORK, "src", "renderer", "app.tsx"), "utf8");
      const checkpoint = store().create({ task_id: "task-13", evidence: ["ev-a"] });
      const outcome = store().rollback(checkpoint);
      item.check("the rollback ran", true, outcome.ok);
      item.check("it restored the changed paths", JSON.stringify(checkpoint.changed_files), JSON.stringify(outcome.restored));
      const after = fs.readFileSync(path.join(WORK, "src", "renderer", "app.tsx"), "utf8");
      item.check("the file is back to the committed content", true, after !== before && after.includes("\"v1\""));
      item.check("git reports a clean tree", false, outcome.after.dirty);
      item.check("HEAD did not move", checkpoint.head, outcome.after.head);
      item.check("the plan was the safe path restore", true, outcome.plan.path_restore_sufficient);
      shared.vc06 = { restored: outcome.restored, clean: !outcome.after.dirty };
      item.cite("git checkout <head> -- <paths>");
    });
  });

  it("VC-07 a rollback that would discard commits needs the Owner's approval", async () => {
    await scenario("VC-07", "§38 destructive rollback is gated", async (item) => {
      fs.appendFileSync(path.join(WORK, "src", "shared", "api.ts"), "export const later = (): number => 9;\n", "utf8");
      const checkpoint = store().create({ task_id: "task-13b", evidence: ["ev-b"] });
      git("add", "--all");
      git("commit", "--quiet", "-m", "worker: committed work after the checkpoint");
      const refused = store().rollback(checkpoint);
      item.check("the rollback is refused", false, refused.ok);
      item.check("because commits would be discarded", true, refused.plan.hard_reset?.required === true);
      item.check("and the reason names the Owner", true, refused.plan.reasons.some((reason) => reason.includes("Owner's approval")));
      item.check("nothing was restored", 0, refused.restored.length);
      const approved = store().rollback(checkpoint, { owner_approved_discard: true });
      item.check("with the Owner's approval it runs", true, approved.ok);
      item.check("HEAD is back at the checkpoint", checkpoint.head, approved.after.head);
      item.check("and the later edit is gone", false, fs.readFileSync(path.join(WORK, "src", "shared", "api.ts"), "utf8").includes("later"));
      shared.vc07 = { refused: refused.plan.reasons, approved: approved.ok, head: approved.after.head.slice(0, 12) };
      item.cite("Owner-gated git reset --hard");
    });
  });

  it("VC-08 the §30.3 change-unit rollback and the §38 checkpoint rollback agree", async () => {
    await scenario("VC-08", "two rollback paths, one truth", async (item) => {
      const engine = createVerificationEngine({ root: WORK, ledgerPath: LEDGER_PATH });
      const target = path.join(WORK, "src", "shared", "api.ts");
      const original = fs.readFileSync(target, "utf8");
      const applied = engine.applyChangeUnit(engine.scopeFor({ allowed_files: ["src/shared/api.ts"], requirements: ["R-1"] }), {
        changes: [{ path: "src/shared/api.ts", content: "export const broken = 1;\n" }]
      });
      item.check("the change unit was applied", true, applied.applied);
      const restored = applied.rollback();
      item.check("the §30.3 rollback restored the file", JSON.stringify(["src/shared/api.ts"]), JSON.stringify(restored.restored));
      item.check("byte-identical to before", original, fs.readFileSync(target, "utf8"));
      // Now the §38 path: change it again and restore from the recorded HEAD.
      fs.writeFileSync(target, "export const checkpointed = 2;\n", "utf8");
      const checkpoint = store().create({ task_id: "task-13c" });
      const outcome = store().rollback(checkpoint);
      item.check("the §38 rollback ran", true, outcome.ok);
      item.check("and the file matches the committed HEAD content", true, git("show", "HEAD:src/shared/api.ts").output.replace(/\r\n/g, "\n").trimEnd() === fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n").trimEnd());
      item.check("the working tree is clean again", false, outcome.after.dirty);
      shared.vc08 = { unitRestored: restored.restored, checkpointRestored: outcome.restored };
      item.cite("applyChangeUnit().rollback() + guardGitHubWrite/rollback");
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_13_VERSION_IMPACT_CHECKPOINT",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    workspace: {
      git_initialized: initialized.status === 0,
      git_commit: committed.status === 0,
      head: git("rev-parse", "HEAD").output.trim().slice(0, 12),
      checkpoints_written: fs.existsSync(CHECKPOINT_DIR) ? fs.readdirSync(CHECKPOINT_DIR).length : 0
    },
    impact: {
      docs: (shared.vc01 as { docs?: string })?.docs,
      implementation: (shared.vc01 as { implementation?: string })?.implementation,
      breaking: (shared.vc02 as { impact?: string })?.impact,
      theme: (shared.vc03 as { theme?: string })?.theme,
      reevaluation: (shared.vc03 as { reevaluation?: boolean })?.reevaluation
    },
    checkpoints: shared,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "version-checkpoint.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "version-checkpoint.md"), [
    "# checkpoint-1 §37/§38 version impact + Git checkpoint acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Impact: docs=${report.impact.docs} implementation=${report.impact.implementation} breaking=${report.impact.breaking} theme=${report.impact.theme}`,
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
