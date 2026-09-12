/**
 * checkpoint-1 §35/§36 (checkpoint-12) — candidate + Guardian acceptance (GD-01..GD-10).
 *
 * The Guardian is driven with artifacts a real run produced: a real §31.3 ledger
 * from the verification engine, real files on disk (scanned by the real secret
 * scanner), a real git working tree whose deletions `git status` reports, a real
 * compiled-contract override, and real theme packages validated by the §20
 * validator.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { createCandidateGuardian, readThemePackage, significantTerms, type CandidateEvaluationInput } from "../../electron/engineering/candidate-guardian";
import { createVerificationEngine } from "../../electron/engineering/verification-engine";
import { advanceLifecycle, GUARDIAN_CHECKS, TASK_LIFECYCLE, THEME_GUARDIAN_CHECKS } from "../../src/shared/candidate-gate";
import type { VerifiableRequirement } from "../../src/shared/verification";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-candidate-acceptance-"));
const WORK = path.join(ROOT, "workspace");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");
const LEDGER_PATH = path.join(WORK, "artifacts", "acceptance", "verification-ledger.json");
const RECORD_PATH = path.join(WORK, "artifacts", "acceptance", "candidate-record.json");
const THEME_DIR = path.join(WORK, "artifacts", "themes", "user-neon");

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
 * a real workspace
 * ------------------------------------------------------------------ */

const GATEWAY = "export const gateway = (): string => \"full\";\n";
const CREDS = "const key = \"AKIAIOSFODNN7EXAMPLE\";\nexport const creds = key;\n";
const UNIT_TEST = [
  "import { test } from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "test(\"the gateway resolves\", () => {",
  "  assert.equal(typeof 1, \"number\");",
  "});",
  ""
].join("\n");

for (const directory of ["src", "tests", "artifacts/acceptance", "artifacts/themes/user-neon"]) fs.mkdirSync(path.join(WORK, directory), { recursive: true });
fs.writeFileSync(path.join(WORK, ".gitignore"), "artifacts/\nnode_modules/\n", "utf8");
fs.writeFileSync(path.join(WORK, "package.json"), JSON.stringify({ name: "candidate-fixture", private: true, scripts: { typecheck: "tsc --noEmit", test: "node --test" } }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler", skipLibCheck: true }, include: ["src"] }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), GATEWAY, "utf8");
fs.writeFileSync(path.join(WORK, "src", "legacy.ts"), "export const legacy = 1;\n", "utf8");
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
const requirement = (overrides: Partial<VerifiableRequirement & { state: string }> = {}) => ({
  id: "R-gateway", type: "FUNCTIONAL", text: "the gateway adapter returns a receipt", visual: false, state: "IMPLEMENTED", ...overrides
});

function engine(): ReturnType<typeof createVerificationEngine> {
  return createVerificationEngine({ root: WORK, ledgerPath: LEDGER_PATH, commands: COMMANDS, targets: TARGETS, harnesses: {}, host: "acceptance-host" });
}
function guardian(overrides: Partial<Parameters<typeof createCandidateGuardian>[0]> = {}) {
  const verification = engine();
  return createCandidateGuardian({ root: WORK, ledger: () => verification.ledger(), recordPath: RECORD_PATH, ...overrides });
}
/** Verifies a requirement for real, so the ledger holds the evidence the gate reads. */
async function verify(id: string, content?: { path: string; content: string }, allowed = "src/gateway.ts"): Promise<void> {
  const verification = engine();
  if (content) verification.applyChangeUnit(verification.scopeFor({ allowed_files: [allowed], requirements: [id] }), { changes: [content] });
  await verification.verifyRequirement(verification.selectFor(requirement({ id })));
}
const baseInput = (overrides: Partial<CandidateEvaluationInput> = {}): CandidateEvaluationInput => ({
  taskId: "task-candidate",
  state: "CANDIDATE",
  requirements: [requirement()],
  goal: { text: "the gateway adapter returns a receipt", deliverables: ["gateway adapter"] },
  written_files: ["src/gateway.ts"],
  allowed_files: ["src/gateway.ts"],
  ...overrides
});
const shared: Record<string, unknown> = {};

describe("checkpoint-12 §35/§36 candidate acceptance", () => {
  it("GD-01 §35 refuses to jump from RUNNING straight to ACCEPTED", async () => {
    await scenario("GD-01", "§35 the lifecycle is not optional", async (item) => {
      item.check("the lifecycle is the plan's six states", JSON.stringify(["RUNNING", "IMPLEMENTED", "VERIFYING", "REVIEWING", "CANDIDATE", "ACCEPTED"]), JSON.stringify([...TASK_LIFECYCLE]));
      const refused = advanceLifecycle("RUNNING", "ACCEPTED");
      item.check("the jump is refused", false, refused.accepted);
      item.check("and the state does not move", "RUNNING", refused.state);
      item.check("the refusal names the legal transitions", true, refused.reason.includes("IMPLEMENTED"));
      let state = "RUNNING" as const;
      const trail: string[] = [state];
      for (const event of ["IMPLEMENTED", "VERIFIED", "REVIEWED", "CANDIDATED", "ACCEPTED"] as const) {
        const step = advanceLifecycle(state, event);
        expect(step.accepted).toBe(true);
        state = step.state;
        trail.push(state);
      }
      item.check("the legal path reaches ACCEPTED", JSON.stringify([...TASK_LIFECYCLE]), JSON.stringify(trail));
      shared.gd01 = { trail, refused: refused.reason };
      item.cite("advanceLifecycle");
    });
  });

  it("GD-02 a candidate with no observations cannot be released", async () => {
    await scenario("GD-02", "§36 a check nobody ran is not a pass", async (item) => {
      const gate = guardian({ reviewCovered: () => true });
      const evaluation = gate.evaluate({ ...baseInput(), requirements: [], goal: { text: "", deliverables: [] }, written_files: [], allowed_files: [] });
      item.check("the Guardian refuses", "REPAIR", evaluation.evaluation.verdict.verdict);
      item.check("the empty goal is a failure, not a gap in the check", true, evaluation.evaluation.verdict.blocking.includes("GOAL_COMPLIANCE"));
      item.check("and a ledger with no rows cannot clear the candidate", true, evaluation.evaluation.verdict.blocking.includes("EVIDENCE_COMPLETENESS"));
      item.check("nothing is released", false, evaluation.evaluation.verdict.released);
      item.check("the record still owes the release permission", true, evaluation.record.awaiting_release_permission);
      shared.gd02 = { verdict: evaluation.evaluation.verdict.verdict, blocking: evaluation.evaluation.verdict.blocking };
      item.cite("evaluateGuardian NOT_RUN →blocker");
    });
  });

  it("GD-03 a fully evidenced candidate is released and recorded durably", async () => {
    await scenario("GD-03", "§35 CANDIDATE →ACCEPTED with evidence", async (item) => {
      await verify("R-gateway");
      const gate = guardian({ reviewCovered: () => true });
      const steps = [
        { state: "IMPLEMENTED" as const, at: "2026-01-01T00:00:01.000Z", reason: "code complete", evidence: ["ev-1"] },
        { state: "VERIFYING" as const, at: "2026-01-01T00:00:02.000Z", reason: "ladder run", evidence: ["ev-2"] },
        { state: "REVIEWING" as const, at: "2026-01-01T00:00:03.000Z", reason: "review done", evidence: ["review-1"] },
        { state: "CANDIDATE" as const, at: "2026-01-01T00:00:04.000Z", reason: "awaiting release", evidence: [] }
      ];
      const evaluation = gate.evaluate(baseInput({ steps }));
      item.check("the Guardian releases", "ACCEPTED", evaluation.evaluation.verdict.verdict);
      item.check("every §36 check passed", JSON.stringify([...GUARDIAN_CHECKS]), JSON.stringify(evaluation.evaluation.verdict.checks.map((check) => check.check)));
      item.check("and each names what it inspected", true, evaluation.evaluation.verdict.checks.every((check) => check.inspected.length > 0));
      item.check("no check is NOT_RUN", 0, evaluation.evaluation.verdict.checks.filter((check) => check.verdict === "NOT_RUN").length);
      item.check("the record keeps the candidate state and the granted release", true, evaluation.record.awaiting_release_permission === true && evaluation.record.guardian.released);
      const advanced = gate.advance("CANDIDATE", "ACCEPTED");
      item.check("the lifecycle event also lands on ACCEPTED", "ACCEPTED", advanced.state);
      const saved = gate.save();
      item.check("the record is durable", true, fs.existsSync(saved));
      const raw = JSON.parse(fs.readFileSync(saved, "utf8")) as { state: string; guardian: { released: boolean } };
      item.check("and records the state and the release", true, raw.state === "CANDIDATE" && raw.guardian.released);
      shared.gd03 = { verdict: evaluation.evaluation.verdict.verdict, checks: evaluation.evaluation.verdict.checks.length, saved: true };
      item.cite(RECORD_PATH);
    });
  });

  it("GD-04 a real credential shape in a written file blocks the candidate", async () => {
    await scenario("GD-04", "§36 secret scan", async (item) => {
      fs.writeFileSync(path.join(WORK, "src", "creds.ts"), CREDS, "utf8");
      const gate = guardian({ reviewCovered: () => true });
      const evaluation = gate.evaluate(baseInput({ written_files: ["src/gateway.ts", "src/creds.ts"], allowed_files: ["src/gateway.ts", "src/creds.ts"] }));
      const check = evaluation.evaluation.verdict.checks.find((entry) => entry.check === "SECRET_SCAN")!;
      item.check("the scanner found the credential shape", "FAIL", check.verdict);
      item.check("and names the file and the shape", true, check.reasons[0].includes("src/creds.ts") && check.reasons[0].includes("aws-access-key"));
      item.check("it blocks the release", true, evaluation.evaluation.verdict.blocking.includes("SECRET_SCAN"));
      item.check("the repair input names the check", true, evaluation.repair.includes("SECRET_SCAN"));
      fs.rmSync(path.join(WORK, "src", "creds.ts"));
      shared.gd04 = { verdict: check.verdict, reasons: check.reasons };
      item.cite("scanSecrets over the written files");
    });
  });

  it("GD-05 a file written outside the grant blocks the candidate", async () => {
    await scenario("GD-05", "§36 scope validation", async (item) => {
      const gate = guardian({ reviewCovered: () => true });
      const evaluation = gate.evaluate(baseInput({
        written_files: ["src/gateway.ts", "src/stowaway.ts"],
        allowed_files: ["src/gateway.ts"],
        refused: ["src/elsewhere.ts is outside the granted scope"]
      }));
      const check = evaluation.evaluation.verdict.checks.find((entry) => entry.check === "SCOPE_VALIDATION")!;
      item.check("the out-of-scope write is caught", "FAIL", check.verdict);
      item.check("the refusal is carried too", true, check.reasons.some((reason) => reason.includes("src/elsewhere.ts")));
      item.check("it blocks", true, evaluation.evaluation.verdict.blocking.includes("SCOPE_VALIDATION"));
      shared.gd05 = { reasons: check.reasons };
      item.cite("scope validation against the grant");
    });
  });

  it("GD-06 an unverified requirement or an uncovered review blocks the candidate", async () => {
    await scenario("GD-06", "§36 evidence completeness", async (item) => {
      const gate = guardian({ reviewCovered: () => false });
      const evaluation = gate.evaluate(baseInput({
        requirements: [requirement({ id: "R-gateway" }), requirement({ id: "R-never", text: "the ledger survives a restart" })]
      }));
      const check = evaluation.evaluation.verdict.checks.find((entry) => entry.check === "EVIDENCE_COMPLETENESS")!;
      item.check("the uncovered review is caught", true, check.reasons.some((reason) => reason.includes("§32 review did not cover")));
      item.check("the requirement with no evidence is caught", true, check.reasons.some((reason) => reason.includes("R-never")));
      item.check("it blocks", true, evaluation.evaluation.verdict.blocking.includes("EVIDENCE_COMPLETENESS"));
      const covered = guardian({ reviewCovered: () => true }).evaluate(baseInput());
      item.check("with full coverage and evidence it passes", "PASS", covered.evaluation.verdict.checks.find((entry) => entry.check === "EVIDENCE_COMPLETENESS")?.verdict);
      shared.gd06 = { blocked: check.reasons };
      item.cite("§31.3 ledger + §32 coverage");
    });
  });

  it("GD-07 a real deletion that the Owner never approved blocks the candidate", async () => {
    await scenario("GD-07", "§36 destructive change check", async (item) => {
      fs.rmSync(path.join(WORK, "src", "legacy.ts"));
      const gate = guardian({ reviewCovered: () => true });
      const unapproved = gate.evaluate(baseInput({ written_files: ["src/gateway.ts"], allowed_files: ["src/gateway.ts", "src/legacy.ts"] }));
      const check = unapproved.evaluation.verdict.checks.find((entry) => entry.check === "DESTRUCTIVE_CHANGE_CHECK")!;
      item.check("git's deletion is seen", "FAIL", check.verdict);
      item.check("the reason names the file", true, check.reasons.some((reason) => reason.includes("src/legacy.ts")));
      const approved = guardian({ reviewCovered: () => true }).evaluate(baseInput({ written_files: ["src/gateway.ts"], allowed_files: ["src/gateway.ts", "src/legacy.ts"], approved_removals: ["src/legacy.ts"] }));
      item.check("an Owner-approved removal passes", "PASS", approved.evaluation.verdict.checks.find((entry) => entry.check === "DESTRUCTIVE_CHANGE_CHECK")?.verdict);
      git("checkout", "--", "src/legacy.ts");
      shared.gd07 = { unapproved: check.reasons, approved: approved.evaluation.verdict.checks.find((entry) => entry.check === "DESTRUCTIVE_CHANGE_CHECK")?.verdict };
      item.cite("git status deletions + Owner approvals");
    });
  });

  it("GD-08 an Owner override the work does not reflect blocks the candidate", async () => {
    await scenario("GD-08", "§36 Owner override compliance", async (item) => {
      const overrides = [{ text: "use installments of 3, not 12", supersedes: ["DELIVERABLES"] }];
      const ignored = guardian({ reviewCovered: () => true }).evaluate(baseInput({ overrides }));
      const check = ignored.evaluation.verdict.checks.find((entry) => entry.check === "OWNER_OVERRIDE_COMPLIANCE")!;
      item.check("the ignored override is caught", "FAIL", check.verdict);
      item.check("and quoted back", true, check.reasons[0].includes("installments of 3"));
      const honoured = guardian({ reviewCovered: () => true }).evaluate(baseInput({
        overrides,
        requirements: [requirement({ id: "R-override", text: "support installments of 3 at checkout" })]
      }));
      item.check("a reflected override passes", "PASS", honoured.evaluation.verdict.checks.find((entry) => entry.check === "OWNER_OVERRIDE_COMPLIANCE")?.verdict);
      shared.gd08 = { ignored: check.reasons, honoured: "PASS" };
      item.cite("contract overrides vs served requirements");
    });
  });

  it("GD-09 the four theme checks read real packages", async () => {
    await scenario("GD-09", "§36 theme checks", async (item) => {
      const tokens = Object.fromEntries(["--boss-bg-root", "--boss-bg-surface", "--boss-bg-elevated", "--boss-text-primary", "--boss-text-muted", "--boss-accent", "--boss-border", "--boss-radius"].map((token) => [token, token === "--boss-radius" ? "8px" : token.includes("text") ? "#f2f5f7" : "#101418"]));
      // The reader-facing pairs must clear their contrast thresholds for the
      // package to validate; a muted text colour keeps the WARN pair honest.
      tokens["--boss-text-muted"] = "#9aa4ae";
      tokens["--boss-on-accent"] = "#06121c";
      fs.writeFileSync(path.join(THEME_DIR, "theme.json"), JSON.stringify({ schemaVersion: 1, id: "user-neon", name: "Neon", type: "CUSTOM", version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", builtIn: false, deletable: true }), "utf8");
      fs.writeFileSync(path.join(THEME_DIR, "tokens.json"), JSON.stringify(tokens), "utf8");
      fs.writeFileSync(path.join(THEME_DIR, "overrides.json"), "[]", "utf8");
      fs.writeFileSync(path.join(THEME_DIR, "metadata.json"), JSON.stringify({ schemaVersion: 1, createdBy: "GENERATED", notes: [], basedOn: "builtin-dark" }), "utf8");
      const clean = readThemePackage({ id: "user-neon", directory: THEME_DIR })!;
      item.check("a self-contained package reads clean", true, clean.error_diagnostics === 0);
      item.check("materialized tokens make it independent", false, clean.references_other_theme);
      item.check("it is not a built-in", false, clean.built_in);
      const evaluation = guardian({ reviewCovered: () => true }).evaluate(baseInput({ themes: [{ id: "user-neon", directory: THEME_DIR }] }));
      item.check("the Guardian requires the theme checks", JSON.stringify([...THEME_GUARDIAN_CHECKS]), JSON.stringify(evaluation.evaluation.verdict.checks.filter((check) => THEME_GUARDIAN_CHECKS.includes(check.check as never)).map((check) => check.check)));
      item.check("a clean theme passes all four", true, evaluation.evaluation.verdict.checks.filter((check) => THEME_GUARDIAN_CHECKS.includes(check.check as never)).every((check) => check.verdict === "PASS"));

      // Now the package carries executable content: the §20 validator must see it.
      fs.writeFileSync(path.join(THEME_DIR, "overrides.css"), "body { background: url(javascript:alert(1)); }\n", "utf8");
      const payload = readThemePackage({ id: "user-neon", directory: THEME_DIR })!;
      item.check("the validator sees the executable payload", true, payload.executable_payload_diagnostics > 0);
      item.check("and marks the fallback plan invalid", false, payload.fallback_plan_valid);
      const blocked = guardian({ reviewCovered: () => true }).evaluate(baseInput({ themes: [{ id: "user-neon", directory: THEME_DIR }] }));
      item.check("the candidate is refused", "REPAIR", blocked.evaluation.verdict.verdict);
      item.check("naming the payload check", true, blocked.evaluation.verdict.blocking.includes("NO_EXECUTABLE_PAYLOAD"));
      const unread = guardian({ reviewCovered: () => true }).evaluate(baseInput({ theme_required: true }));
      item.check("a theme lane with nothing read is NOT_RUN, not a pass", true, unread.evaluation.verdict.blocking.includes("THEME_ISOLATION"));
      fs.rmSync(path.join(THEME_DIR, "overrides.css"));
      shared.gd09 = { clean: clean.error_diagnostics, payload: payload.executable_payload_diagnostics, blocked: blocked.evaluation.verdict.blocking };
      item.cite("readThemePackage + validateThemePackage");
    });
  });

  it("GD-10 a refused Guardian sends the Candidate back to review, with the checks named", async () => {
    await scenario("GD-10", "§36 Candidate →Repair", async (item) => {
      const gate = guardian({ reviewCovered: () => false });
      const evaluation = gate.evaluate(baseInput({ written_files: ["src/gateway.ts", "src/stowaway.ts"], allowed_files: ["src/gateway.ts"] }));
      item.check("the Guardian refuses", "REPAIR", evaluation.evaluation.verdict.verdict);
      item.check("the repair input is the blocking checks", true, evaluation.repair.length > 0);
      item.check("they are §36 check ids", true, evaluation.repair.every((check) => [...GUARDIAN_CHECKS, ...THEME_GUARDIAN_CHECKS].includes(check as never)));
      const step = gate.advance("CANDIDATE", "REPAIR");
      item.check("the lifecycle returns to REVIEWING", "REVIEWING", step.state);
      item.check("the record keeps the refusal", "REPAIR", evaluation.record.guardian.verdict);
      item.check("and the release permission stays owed", true, evaluation.record.awaiting_release_permission);
      item.check("scoring is not a completion", false, evaluation.evaluation.verdict.released);
      shared.gd10 = { verdict: evaluation.evaluation.verdict.verdict, blocking: evaluation.repair, next: step.state };
      item.cite("Guardian verdict →repair input →lifecycle");
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_12_CANDIDATE_GUARDIAN",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    workspace: {
      git_initialized: initialized.status === 0,
      git_commit: committed.status === 0,
      typescript_toolchain: fs.existsSync(path.join(MODULES, "typescript", "bin", "tsc")),
      record_written: fs.existsSync(RECORD_PATH)
    },
    checklist: { base: [...GUARDIAN_CHECKS], theme: [...THEME_GUARDIAN_CHECKS] },
    candidate: fs.existsSync(RECORD_PATH)
      ? (() => {
          const raw = JSON.parse(fs.readFileSync(RECORD_PATH, "utf8")) as { state: string; guardian: { verdict: string; blocking: string[]; released: boolean } };
          return { state: raw.state, guardian: raw.guardian.verdict, released: raw.guardian.released, blocking: raw.guardian.blocking };
        })()
      : undefined,
    candidateSteps: shared,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "candidate-guardian.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "candidate-guardian.md"), [
    "# checkpoint-1 §35/§36 candidate + Guardian acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Checklist: ${[...GUARDIAN_CHECKS, ...THEME_GUARDIAN_CHECKS].length} checks (${GUARDIAN_CHECKS.length} base + ${THEME_GUARDIAN_CHECKS.length} theme)`,
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

void significantTerms;
