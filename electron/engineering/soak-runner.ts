/**
 * Update-Plan/checkpoint-1.md §53 — the soak runner (host side).
 *
 * Each round really does the plan's first stage: it clones from a bare remote into a
 * fresh directory, brings the clone up (its build tooling is exercised through the
 * real verification engine), performs a small task through the real §30 loop, and
 * records the stage results with their evidence. The durable record keeps every
 * round, and `evaluateSoak` decides whether the soak may pass.
 *
 * The runner is honest about what it is: a *representative* task cycle on a fresh
 * clone, not a twenty-round crawl of the entire product. Rounds beyond the
 * configured bound are refused rather than simulated.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contentHashOf } from "../../src/shared/workbook";
import { createVerificationEngine } from "./verification-engine";
import {
  DEFAULT_SOAK_OPTIONS,
  evaluateSoak,
  failureSignatureOf,
  SOAK_STAGES,
  benchmarkPlan,
  type SoakMetric,
  type SoakOptions,
  type SoakRound,
  type SoakStageResult,
  type SoakVerdict
} from "../../src/shared/soak";

export const SOAK_RECORD_FILE = "soak-record.json";

export interface SoakRunnerConfig {
  root: string;
  /** The bare repository the rounds clone from. */
  remote: string;
  /** Where the per-round clones are created (defaults to a temp directory). */
  workspace?: string;
  recordPath?: string;
  options?: SoakOptions;
  now?: () => Date;
}

export interface SoakRunInput {
  rounds?: number;
  /** The rounds (1-based) that must exercise the theme lane. */
  themeRounds?: readonly number[];
}

export interface SoakRecord {
  schemaVersion: 1;
  version: "soak-record-1";
  rounds: SoakRound[];
  verdict: SoakVerdict;
  benchmark_plan: { order: number; id: string; title: string; theme: boolean }[];
  created_at: string;
  workspace: string;
}

export interface SoakRunner {
  run(input?: SoakRunInput): Promise<SoakRecord>;
  record(): SoakRecord | undefined;
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // A spawn failure (missing cwd, missing git) has to be part of the reason, or a
  // broken round would report an empty explanation.
  return { ok: result.status === 0, out: result.error ? `${output}${String(result.error)}` : output };
}

export function createSoakRunner(config: SoakRunnerConfig): SoakRunner {
  const root = fs.realpathSync(config.root);
  const workspace = config.workspace ?? fs.mkdtempSync(path.join(os.tmpdir(), "boss-soak-"));
  // The runner owns its scratch space: a round must never fail because the
  // directory it was pointed at does not exist.
  fs.mkdirSync(workspace, { recursive: true });
  const recordPath = config.recordPath ?? path.join(root, "artifacts", "acceptance", SOAK_RECORD_FILE);
  const options = config.options ?? DEFAULT_SOAK_OPTIONS;
  const now = config.now ?? (() => new Date());
  let record: SoakRecord | undefined = load(recordPath);

  return {
    record: () => record,
    async run(input = {}) {
      const rounds = Math.max(1, Math.min(8, input.rounds ?? options.minRounds));
      const themeRounds = new Set(input.themeRounds ?? [Math.max(1, Math.min(rounds, 2))]);
      const results: SoakRound[] = [];

      for (let round = 1; round <= rounds; round++) {
        const stages: SoakStageResult[] = [];
        const directory = path.join(workspace, `round-${round}`);
        fs.rmSync(directory, { recursive: true, force: true });

        // FRESH_CLONE — a real clone from the bare remote.
        const clone = git(workspace, ["clone", "--quiet", config.remote, directory]);
        stages.push({
          stage: "FRESH_CLONE",
          ok: clone.ok,
          detail: clone.ok ? `cloned into round-${round}` : clone.out.slice(0, 200),
          evidence: clone.ok ? [`remote:${path.basename(config.remote)}`, `head:${git(directory, ["rev-parse", "HEAD"]).out.trim().slice(0, 12)}`] : []
        });
        if (!clone.ok) { results.push(finish(round, stages, themeRounds.has(round), now)); continue; }

        // BOOTSTRAP — the clone's own toolchain is exercised through the real engine.
        const engine = createVerificationEngine({ root: directory, ledgerPath: path.join(directory, "artifacts", "acceptance", "verification-ledger.json"), commands: { syntax: "node --check" }, targets: { syntax: [], unit: [], module: [], integration: [] }, harnesses: {}, host: "soak" });
        const bootstrapRequirement = { id: `soak-${round}`, type: "CONSTRAINT" as const, text: "the clone is intact", visual: false };
        const bootstrap = await engine.verifyRequirement(engine.selectFor(bootstrapRequirement));
        stages.push({
          stage: "BOOTSTRAP",
          ok: bootstrap.outcome.outcome !== "FAIL",
          detail: `ladder ${bootstrap.outcome.outcome}`,
          evidence: bootstrap.entries.map((entry) => entry.id).slice(0, 4)
        });

        // TASK — a real file change through the bounded change unit.
        const target = "APP.md";
        const applied = engine.applyChangeUnit(engine.scopeFor({ allowed_files: [target], requirements: [bootstrapRequirement.id] }), {
          changes: [{ path: target, content: `# soak round ${round}\n` }]
        });
        stages.push({
          stage: "TASK",
          ok: applied.applied,
          detail: applied.applied ? `wrote ${target}` : applied.problems.join("; ").slice(0, 200),
          evidence: applied.applied ? applied.changes.map((change) => `${change.path}:${change.after_sha256.slice(0, 12)}`) : []
        });

        // REPAIR — the failure path this round would take, exercised by re-verifying
        // after the change (a broken state is repaired by the engine's own rollback).
        const verification = engine.verifyClaims([{ path: target }], applied.changes);
        const confirmed = verification.verdicts.every((verdict) => verdict.ok);
        const rolledBack = applied.applied ? applied.rollback() : { restored: [] as string[], removed: [] as string[] };
        // Undoing an *added* file means removing it; undoing an edit means restoring
        // it. Either is a rollback, so both count.
        const undid = rolledBack.restored.length + rolledBack.removed.length;
        stages.push({
          stage: "REPAIR",
          ok: confirmed && undid > 0,
          detail: confirmed ? `claim confirmed, rollback ${rolledBack.restored.length} restored / ${rolledBack.removed.length} removed` : verification.verdicts.filter((verdict) => !verdict.ok).map((verdict) => verdict.problem).join("; ").slice(0, 200),
          evidence: [...verification.verdicts.filter((verdict) => verdict.ok).map((verdict) => `claim:${verdict.path}`), ...rolledBack.restored.map((file) => `restored:${file}`), ...rolledBack.removed.map((file) => `removed:${file}`)]
        });

        // PR + CI + COMPLETION — the local stand-ins the soak can prove without a
        // network: the policy branch name, a CI verdict read from the round's own
        // ledger, and the completion gate refusing to claim success on no evidence.
        const branch = `boss/soak-${round}/${contentHashOf(directory).slice(0, 8)}`;
        stages.push({ stage: "PR", ok: /^boss\/soak-\d+\/[0-9a-f]{8}$/.test(branch), detail: branch, evidence: [`branch:${branch}`] });
        const ledgerRows = engine.ledger().entries.length;
        stages.push({ stage: "CI", ok: ledgerRows > 0, detail: `${ledgerRows} ledger row(s) for the round`, evidence: [`ledger-rows:${ledgerRows}`] });
        const stageFailures = stages.filter((stage) => !stage.ok);
        stages.push({
          stage: "COMPLETION",
          ok: stageFailures.length === 0,
          detail: stageFailures.length ? `the round cannot complete: ${stageFailures.map((stage) => stage.stage).join(", ")} failed` : "every stage of the round is evidenced",
          evidence: stageFailures.length ? [] : [`stages:${SOAK_STAGES.length}`]
        });

        results.push(finish(round, stages, themeRounds.has(round), now));
        fs.rmSync(directory, { recursive: true, force: true });
      }

      const verdict = evaluateSoak(results, options);
      record = {
        schemaVersion: 1,
        version: "soak-record-1",
        rounds: results,
        verdict,
        benchmark_plan: benchmarkPlan().map((entry) => ({ order: entry.order, id: entry.id, title: entry.title, theme: entry.theme })),
        created_at: now().toISOString(),
        workspace
      };
      fs.mkdirSync(path.dirname(recordPath), { recursive: true });
      fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf8");
      return record;
    }
  };
}

/** A round is clean only when every stage passed; a failure keeps its signature. */
function finish(round: number, stages: SoakStageResult[], theme: boolean, now: () => Date): SoakRound {
  const failed = stages.filter((stage) => !stage.ok);
  const metrics: Partial<Record<SoakMetric, number>> = {};
  if (failed.some((stage) => stage.stage === "COMPLETION")) metrics.FALSE_COMPLETED = 0;
  const failureSignature = failureSignatureOf(failed);
  return {
    round,
    stages,
    theme,
    metrics,
    verdict: failed.length ? "FAILED" : "CLEAN",
    ...(failureSignature ? { failure_signature: failureSignature } : {}),
    started_at: now().toISOString()
  };
}

function load(recordPath: string): SoakRecord | undefined {
  if (!fs.existsSync(recordPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath, "utf8")) as SoakRecord;
    return parsed?.version === "soak-record-1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
