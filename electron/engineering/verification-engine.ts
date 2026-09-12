/**
 * Update-Plan/checkpoint-1.md §30/§31 — the host side of the verification engine.
 *
 * The pure decision layer (`src/shared/verification.ts`) says which rungs a
 * requirement must climb. This module is the only place that touches the machine:
 * it applies bounded change units (§30.1/§30.3), proves what a worker really did
 * (§30.2: git diff, file existence, syntax, typecheck, target tests), climbs the
 * ladder cheapest-first, and writes every result into the §31.3 Evidence Ledger.
 *
 * Three rules the code enforces rather than documents:
 *   1. Nothing is written outside the node's granted files. `applyChangeUnit`
 *      preflights the whole unit and refuses it whole (§30.3 atomicity).
 *   2. A gate that cannot run is recorded NOT_RUN/SKIPPED with the reason. It is
 *      never recorded as a pass, and the ledger never gains an entry for a rung
 *      that did not execute.
 *   3. Commands are not strings from a model: they are the allowlisted argv that
 *      `runAllowedCommand` computes from the host's own toolchain (§9).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { runAllowedCommand, type AllowedCommand, type CommandEvidence } from "./command-runner";
import { assertMutationAllowed } from "../self-evolution/mutation-guard";
import type { VerificationGate } from "../../src/shared/execution-planner";
import {
  emptyLedger,
  recordEvidence,
  summarizeLedger,
  type EvidenceEntry,
  type EvidenceEnvironment,
  type EvidenceLedgerFile,
  type GateOutcome
} from "../../src/shared/evidence-ledger";
import {
  boundedScopeFor,
  changeUnitProblems,
  evidenceInputsForRun,
  ladderOutcome,
  planVerification,
  selectGates,
  verifyChangeClaims,
  type ChangeClaim,
  type ChangeObservation,
  type ClaimVerdict,
  type GateRun,
  type GateSelection,
  type LadderOutcome,
  type VerificationCommands,
  type VerificationHarnesses,
  type VerificationPlanFile,
  type VerifiableRequirement,
  type WorkerScope
} from "../../src/shared/verification";

export const VERIFICATION_LEDGER_FILE = "verification-ledger.json";

export interface RawRun {
  passed: boolean;
  exitCode: number | null;
  output: string;
}

export interface ChangeUnit {
  /** Repository-relative path plus the exact content the worker wants written. */
  changes: { path: string; content: string }[];
}

export interface AppliedChange {
  path: string;
  before_sha256: string | null;
  after_sha256: string;
  before: string | null;
}

export interface ApplyResult {
  applied: boolean;
  problems: string[];
  changes: AppliedChange[];
  /** Restores the exact previous bytes. Only meaningful when `applied`. */
  rollback: () => { restored: string[]; removed: string[] };
}

export interface ClaimVerification {
  verdicts: ClaimVerdict[];
  observations: ChangeObservation[];
  /** §30.2's first check, reported honestly when git cannot answer. */
  git: { available: boolean; detail: string; changed: string[] };
}

export interface RequirementVerification {
  selection: GateSelection;
  outcome: LadderOutcome;
  entries: EvidenceEntry[];
}

export interface EngineConfig {
  root: string;
  /** Where the §31.3 ledger lives. Defaults to `<root>/artifacts/acceptance/`. */
  ledgerPath?: string;
  /** Host-declared commands (from the §29 PlanContext). */
  commands?: VerificationCommands;
  /** Test targets per rung; empty means "this rung has no target on this host". */
  targets?: { syntax?: string[]; unit?: string[]; module?: string[]; integration?: string[] };
  /** Rungs only an attached harness can climb. */
  harnesses?: VerificationHarnesses;
  host?: string;
  runtimes?: Record<string, string>;
  now?: () => Date;
  /** Test seams; production uses the real allowlisted runner and real git. */
  runAllowed?: (command: AllowedCommand, files?: string[]) => Promise<CommandEvidence>;
  runRaw?: (executable: string, args: string[], cwd: string) => Promise<RawRun>;
}

export interface VerificationEngine {
  readonly root: string;
  readonly environment: EvidenceEnvironment;
  ledger(): EvidenceLedgerFile;
  /** §30.1: the write/command scope a §29 plan node grants its worker. */
  scopeFor(node: { allowed_files: readonly string[]; requirements: readonly string[]; verification?: { commands?: readonly string[] } }): WorkerScope;
  applyChangeUnit(scope: Pick<WorkerScope, "allowed_files">, unit: ChangeUnit): ApplyResult;
  /** §30.2: what the worker actually did, checked against git and the disk. */
  verifyClaims(claims: readonly ChangeClaim[], applied?: readonly AppliedChange[]): ClaimVerification;
  /** §31.2: the plan for one requirement on this host. */
  selectFor(requirement: VerifiableRequirement): GateSelection;
  /** §31.1: climbs the ladder for one selection and records every rung. */
  verifyRequirement(selection: GateSelection): Promise<RequirementVerification>;
  /** §31.2 for a whole graph, then §31.1 for every requirement. */
  verifyGraph(nodes: readonly VerifiableRequirement[]): Promise<{ plan: VerificationPlanFile; results: RequirementVerification[] }>;
  /**
   * Records an externally produced harness report (theme preview, benchmark,
   * desktop black box) as evidence for the given requirements. The file is
   * hashed, so the entry points at a real artifact.
   */
  ingestReport(input: { path: string; gate: VerificationGate; requirement_ids: string[]; passed: boolean; detail?: string }): EvidenceEntry | undefined;
  save(): string;
}

function defaultLedgerPath(root: string): string {
  return path.join(root, "artifacts", "acceptance", VERIFICATION_LEDGER_FILE);
}

export function createVerificationEngine(config: EngineConfig): VerificationEngine {
  const root = fs.realpathSync(config.root);
  const now = config.now ?? (() => new Date());
  const ledgerPath = config.ledgerPath ?? defaultLedgerPath(root);
  const runAllowed = config.runAllowed ?? ((command: AllowedCommand, files: string[] = []) => runAllowedCommand(root, command, files));
  const runRaw = config.runRaw ?? ((executable: string, args: string[], cwd: string) => rawRun(executable, args, cwd));
  const environment: EvidenceEnvironment = {
    host: config.host ?? "local-host",
    platform: `${process.platform}-${process.arch}`,
    workspace: root,
    runtimes: config.runtimes ?? { node: process.version, ...(process.versions.electron ? { electron: process.versions.electron } : {}) }
  };
  let ledger: EvidenceLedgerFile = loadLedger(ledgerPath);

  const sha256 = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");
  const absolute = (relative: string): string => path.resolve(root, relative);
  const stamp = (): string => now().toISOString();

  /** §30.2's first check. Synchronous: no verdict is issued before git answers. */
  const git = (): { available: boolean; detail: string; changed: string[] } => {
    const result = rawRun("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], root);
    if (!result.passed) return { available: false, detail: result.output.trim().slice(0, 400) || "git status failed", changed: [] };
    const changed = result.output
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+$/, ""))
      .filter((line) => line.length > 3)
      .map((line) => {
        const raw = line.slice(3).trim();
        const renamed = raw.includes(" -> ") ? raw.split(" -> ").pop()! : raw;
        return renamed.replace(/^"|"$/g, "").replace(/\\/g, "/");
      });
    return { available: true, detail: `git reports ${changed.length} changed path(s)`, changed };
  };

  return {
    root,
    environment,
    ledger: () => ledger,
    scopeFor(node) {
      const scope = scopeFromNode(node);
      return { ...scope, workspace: root };
    },
    applyChangeUnit(scope, unit) {
      const problems = changeUnitProblems(unit, scope);
      if (problems.length) return { applied: false, problems, changes: [], rollback: () => ({ restored: [], removed: [] }) };
      // §7.3: this is a production mutating seam, so it passes the same host-level
      // assertion as every other write boundary — the Stable Boss repository may
      // not be written without an EvolutionRunContext, whatever the scope says.
      assertMutationAllowed(root);
      const prepared = unit.changes.map((change) => {
        const target = absolute(change.path);
        const exists = fs.existsSync(target);
        const before = exists ? fs.readFileSync(target, "utf8") : null;
        return { change, target, before, beforeSha: before === null ? null : sha256(before) };
      });
      const written: typeof prepared = [];
      try {
        for (const entry of prepared) {
          fs.mkdirSync(path.dirname(entry.target), { recursive: true });
          const temp = path.join(path.dirname(entry.target), `.${path.basename(entry.target)}.${process.pid}.${written.length}.tmp`);
          fs.writeFileSync(temp, entry.change.content, "utf8");
          fs.renameSync(temp, entry.target);
          written.push(entry);
        }
      } catch (error) {
        // §30.3 atomicity: a half-applied unit is rolled back before it is reported.
        for (const entry of [...written].reverse()) {
          if (entry.before === null) { try { fs.unlinkSync(entry.target); } catch { /* already gone */ } }
          else fs.writeFileSync(entry.target, entry.before, "utf8");
        }
        return { applied: false, problems: [`the change unit failed while writing: ${error instanceof Error ? error.message : String(error)}`], changes: [], rollback: () => ({ restored: [], removed: [] }) };
      }
      const changes: AppliedChange[] = written.map((entry) => ({
        path: entry.change.path,
        before_sha256: entry.beforeSha,
        after_sha256: sha256(entry.change.content),
        before: entry.before
      }));
      return {
        applied: true,
        problems: [],
        changes,
        rollback: () => {
          const restored: string[] = [];
          const removed: string[] = [];
          for (const entry of [...written].reverse()) {
            if (entry.before === null) { fs.rmSync(entry.target, { force: true }); removed.push(entry.change.path); }
            else { fs.writeFileSync(entry.target, entry.before, "utf8"); restored.push(entry.change.path); }
          }
          return { restored, removed };
        }
      };
    },
    verifyClaims(claims, applied) {
      const status = git();
      const appliedHashes = new Map((applied ?? []).map((change) => [change.path, change]));
      const paths = [...new Set([...claims.map((claim) => claim.path), ...status.changed])].sort();
      const observations: ChangeObservation[] = paths.map((relative) => {
        const target = absolute(relative);
        const exists = fs.existsSync(target) && fs.statSync(target).isFile();
        const observation: ChangeObservation = { path: relative, exists, modified: status.changed.includes(relative) };
        if (exists) {
          const sha = sha256(fs.readFileSync(target, "utf8"));
          observation.sha256 = sha;
          // §30.2: the applied change unit is evidence too. A unit that restored the
          // committed content leaves no diff against HEAD, so without this a real
          // change would be denied by git alone.
          const record = appliedHashes.get(relative);
          if (record) observation.changed_by_unit = record.before_sha256 !== record.after_sha256 && sha === record.after_sha256;
        }
        return observation;
      });
      const verdicts = status.available
        ? verifyChangeClaims(claims, observations)
        : claims.map((claim) => ({
            path: claim.path,
            ok: false,
            problem: `git is unavailable, so §30.2 cannot confirm the modification: ${status.detail}`
          }));
      return { verdicts, observations, git: status };
    },
    selectFor(requirement) {
      return selectGates({
        requirement,
        ...(config.commands ? { commands: config.commands } : {}),
        ...(config.harnesses ? { harnesses: config.harnesses } : {})
      });
    },
    async verifyRequirement(selection) {
      const runs: GateRun[] = [];
      const capture = (gate: VerificationGate, command: string, result: GateOutcome, extra: Partial<GateRun> = {}): void => {
        runs.push({ gate, command, result, ...extra });
      };
      for (const decision of selection.gates) {
        const gate = decision.gate;
        if (runs.some((run) => run.gate === gate)) continue;
        const started = Date.now();
        const outcome = await runGate(gate, decision.command);
        capture(gate, outcome.command, outcome.result, { ...outcome.extra, duration_ms: Date.now() - started });
        // §31.1: a failed rung ends the climb — the rungs above it are meaningless.
        if (outcome.result === "FAIL") break;
      }
      const outcome = ladderOutcome(selection, runs);
      const captured = stamp();
      const entries: EvidenceEntry[] = [];
      for (const input of evidenceInputsForRun(selection, outcome, environment, captured)) {
        entries.push(recordEvidence(ledger, input).entry);
      }
      // §47: the ledger is durable state, so it is written before the verdict is
      // returned — a crash after a gate ran must not lose the fact that it ran.
      this.save();
      return { selection, outcome, entries };
    },
    async verifyGraph(nodes) {
      const plan = planVerification({
        requirements: { nodes: nodes as never },
        ...(config.commands ? { commands: config.commands } : {}),
        ...(config.harnesses ? { harnesses: config.harnesses } : {}),
        now: stamp()
      });
      const results: RequirementVerification[] = [];
      for (const selection of plan.requirements) {
        const node = nodes.find((entry) => entry.id === selection.requirement_id);
        // §28.3: a quarantined requirement is planned but never verified.
        if (node?.state === "QUARANTINED") continue;
        results.push(await this.verifyRequirement(selection));
      }
      return { plan, results };
    },
    ingestReport(input) {
      const target = realReportPath(root, input.path);
      if (!target) return undefined;
      const content = fs.readFileSync(target, "utf8");
      const { entry } = recordEvidence(ledger, {
        requirement_ids: input.requirement_ids,
        gate: input.gate,
        command: `harness report ${input.path}`,
        environment,
        result: input.passed ? "PASS" : "FAIL",
        captured_at: stamp(),
        artifact: input.path,
        artifact_hash: sha256(content),
        detail: input.detail ?? `external ${input.gate} harness report`
      });
      this.save();
      return entry;
    },
    save() {
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), "utf8");
      return ledgerPath;
    }
  };

  /* ---------------- gate execution ---------------- */

  async function runGate(gate: VerificationGate, described: string | undefined): Promise<{ command: string; result: GateOutcome; extra: Partial<GateRun> }> {
    const skip = (reason: string): { command: string; result: GateOutcome; extra: Partial<GateRun> } => ({ command: described ?? gate, result: "SKIPPED", extra: { detail: reason } });
    if (gate === "SYNTAX") {
      const files = syntaxTargets();
      if (!files.length) return skip("no JavaScript-family file was granted, and node --check cannot parse TypeScript (the TYPECHECK rung covers it)");
      const failures: string[] = [];
      for (const file of files) {
        const raw = await runRaw(process.execPath, ["--check", absolute(file)], root);
        if (!raw.passed) failures.push(`${file}: ${raw.output.trim().slice(0, 200)}`);
      }
      return failures.length
        ? { command: `node --check ${files.join(" ")}`, result: "FAIL", extra: { exit_code: 1, detail: failures.join("; ") } }
        : { command: `node --check ${files.join(" ")}`, result: "PASS", extra: { exit_code: 0, detail: `checked ${files.length} file(s)` } };
    }
    if (gate === "TYPECHECK") return fromCommand("typecheck", []);
    if (gate === "UNIT") return (await targets("unit")) ?? skip("the workspace declares no unit test target");
    if (gate === "MODULE") return (await targets("module")) ?? skip("the workspace declares no module-level test target");
    if (gate === "INTEGRATION") return (await targets("integration")) ?? skip("the workspace declares no integration test target");
    if (gate === "FULL") return fromCommand("test", []);
    if (gate === "BUILD") return fromCommand("build", []);
    if (gate === "BENCHMARK" || gate === "RUNTIME" || gate === "BLACKBOX" || gate === "VISUAL") {
      if (ledger.entries.some((entry) => entry.gate === gate && entry.artifact)) {
        const best = ledger.entries.filter((entry) => entry.gate === gate && entry.artifact).sort((left, right) => left.captured_at.localeCompare(right.captured_at)).pop()!;
        return { command: best.command, result: best.result, extra: { artifact: best.artifact, artifact_hash: best.hash, detail: "reused an already ingested harness report" } };
      }
      return skip(`no ${gate} harness is attached; run the harness (or ingest its report) before claiming this rung`);
    }
    return skip(`${gate} has no host implementation`);
  }

  function syntaxTargets(): string[] {
    return (config.targets?.syntax ?? config.targets?.unit ?? [])
      .filter((file) => /\.(?:m?js|cjs|jsx)$/i.test(file));
  }

  function targets(kind: "unit" | "module" | "integration"): Promise<{ command: string; result: GateOutcome; extra: Partial<GateRun> }> | undefined {
    const files = config.targets?.[kind] ?? [];
    if (!files.length) return undefined;
    return fromCommand("test", files);
  }

  async function fromCommand(command: AllowedCommand, files: string[]): Promise<{ command: string; result: GateOutcome; extra: Partial<GateRun> }> {
    const evidence = await runAllowed(command, files);
    const argv = evidence.args.length ? [process.execPath, ...evidence.args].join(" ") : `${command} (no local tooling)`;
    // The ledger row is the evidence a §33 classifier reads, so the detail keeps
    // the diagnostic lines rather than a tail of timing summaries: an error-shaped
    // line is worth more than "duration_ms 30.5".
    const lines = evidence.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const diagnostic = lines.filter((line) => /error|fail|not ok|assertionerror|✖|×|TS\d{4}|cannot find/i.test(line)).slice(0, 4);
    const detail = (diagnostic.length ? diagnostic : lines.slice(-3)).join(" | ").slice(0, 600);
    return {
      command: argv,
      result: evidence.passed ? "PASS" : "FAIL",
      extra: {
        ...(evidence.exitCode !== null ? { exit_code: evidence.exitCode } : {}),
        detail: detail || `${command} produced no output`
      }
    };
  }

}

/** Default raw runner for the syntax rung and the §30.2 git check. */
function rawRun(executable: string, args: string[], cwd: string): RawRun {
  const result = spawnSync(executable, args, { cwd, windowsHide: true, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) return { passed: false, exitCode: null, output: String(result.error) };
  return { passed: result.status === 0, exitCode: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function scopeFromNode(node: { allowed_files: readonly string[]; requirements: readonly string[]; verification?: { commands?: readonly string[] } }): WorkerScope {
  // §30.1: one rule for worker scope, shared with the pure layer so the host and
  // the acceptance suite cannot drift apart.
  return boundedScopeFor(node);
}

function loadLedger(ledgerPath: string): EvidenceLedgerFile {
  if (!fs.existsSync(ledgerPath)) return emptyLedger();
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as EvidenceLedgerFile;
    if (parsed?.version !== emptyLedger().version || !Array.isArray(parsed.entries)) return emptyLedger();
    return parsed;
  } catch {
    // A corrupt ledger is not silently treated as empty evidence: the caller sees
    // an empty ledger and the file is left untouched for inspection on save().
    return emptyLedger();
  }
}

/** A report path that escapes the root is refused, never read. */
function realReportPath(root: string, relative: string): string | undefined {
  const target = path.resolve(root, relative);
  const normalizedRoot = root.endsWith(path.sep) ? root : root + path.sep;
  if (!target.startsWith(normalizedRoot)) return undefined;
  return fs.existsSync(target) ? target : undefined;
}

/** Kept for callers that only need the §31.3 summary of a run. */
export function verificationSummary(engine: VerificationEngine): ReturnType<typeof summarizeLedger> {
  return summarizeLedger(engine.ledger());
}
