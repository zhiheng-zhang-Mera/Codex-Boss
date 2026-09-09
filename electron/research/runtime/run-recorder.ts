import path from "node:path";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import type { ResearchCommandSpec } from "../../../src/shared/research-command";
import { prepareResearchCommand } from "./environment-manager";
import { runStructuredProcess } from "./process-runner";
import type { ResearchRuntime } from "./research-runtime";
import { EvidenceGraph, type PrimaryRunRecord } from "../evidence/evidence-graph";

/**
 * Primary-run recorder (plan 9-6 Phase 6→10 glue). Composes the pieces the
 * phases shipped separately: run a *real* allow-listed experiment through the
 * ResearchRuntime, capture the provenance fields the plan requires for every
 * primary experiment run (protocol hash, git commit/dirty, command/args,
 * environment fingerprint, dependency-lock hash, seed, input/output/stdout
 * hashes, metrics, duration, hardware, timestamp), and persist a
 * PrimaryRunRecord through the EvidenceGraph — bound to the frozen protocol
 * hash. Fail-closed: an unfrozen protocol, a non-allow-listed command, or a
 * missing declared input file never produces a run record (evidence > vote;
 * no fabricated runs).
 */

export interface GitProbe {
  commit: string;
  dirty: boolean;
}

/** Probes the workspace git state; never throws (no repo → commit "unknown"). */
export async function probeGit(cwd: string): Promise<GitProbe> {
  const commit = await runStructuredProcess({ executable: "git", args: ["rev-parse", "HEAD"], cwd, purpose: "TEST", timeoutMs: 10000 });
  const status = await runStructuredProcess({ executable: "git", args: ["status", "--porcelain"], cwd, purpose: "TEST", timeoutMs: 10000 });
  return { commit: commit.code === 0 ? commit.output.trim() : "unknown", dirty: status.code === 0 && status.output.trim().length > 0 };
}

export interface PrimaryExperimentOptions {
  experimentId: string;
  protocolHash: string;
  spec: ResearchCommandSpec;
  seed?: number;
  /** Declared input files whose content hashes become inputHashes (missing file → throws). */
  inputFiles?: string[];
  /** Explicit dependency-lock path; when omitted the recorder looks for the usual lockfiles in cwd. */
  dependencyLock?: string;
  /** Extracts metrics from the run output; default parses `METRICS <json>` lines. */
  metricsFromOutput?: (output: string) => Record<string, number>;
}

export interface RecordedExperiment {
  record: PrimaryRunRecord;
  passed: boolean;
}

const LOCKFILE_CANDIDATES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hashFile(file: string): string {
  return hashText(fs.readFileSync(file, "utf8"));
}

function parseMetricsFromOutput(output: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^METRICS (.*)$/.exec(line.trim());
    if (!match) continue;
    const value = JSON.parse(match[1]) as unknown;
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) if (typeof entry === "number") metrics[key] = entry;
    }
  }
  return metrics;
}

function environmentFingerprint(spec: ResearchCommandSpec): string {
  const overrides = Object.fromEntries(Object.entries(spec.environment ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return hashText(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, overrides }));
}

export class PrimaryRunRecorder {
  constructor(private readonly evidence: EvidenceGraph, private readonly runtime: ResearchRuntime) {}

  async run(researchId: string, options: PrimaryExperimentOptions): Promise<RecordedExperiment> {
    const spec = prepareResearchCommand(options.spec);
    const result = await this.runtime.run(spec);
    const output = result.output;
    const metrics = (options.metricsFromOutput ?? parseMetricsFromOutput)(output);
    const outputHash = hashText(output);
    const stdoutStderrHash = hashText(output);

    // Fail-closed provenance: a declared input that vanished must not be
    // silently dropped from the record.
    const inputHashes = (options.inputFiles ?? []).map((file) => {
      if (!fs.existsSync(file)) throw new Error(`Declared input file missing: ${file}`);
      return hashFile(file);
    });

    let dependencyLockHash = "none";
    if (options.dependencyLock) dependencyLockHash = hashFile(options.dependencyLock);
    else {
      const found = LOCKFILE_CANDIDATES.map((name) => path.join(spec.cwd, name)).find((file) => fs.existsSync(file));
      if (found) dependencyLockHash = hashFile(found);
    }

    const git = await probeGit(spec.cwd);
    const record: PrimaryRunRecord = {
      // File/id naming is never timestamp-based (user requirement): stable
      // experiment + seed + short random nonce.
      runId: `${options.experimentId}-seed${options.seed ?? 0}-${randomBytes(3).toString("hex")}`,
      experimentId: options.experimentId,
      protocolHash: options.protocolHash,
      gitCommit: git.commit,
      gitDirty: git.dirty,
      command: [spec.executable, ...spec.args],
      environmentFingerprint: environmentFingerprint(spec),
      dependencyLockHash,
      seed: options.seed ?? 0,
      inputHashes,
      outputHash,
      stdoutStderrHash,
      metrics,
      durationMs: result.durationMs,
      hardware: `${process.platform}-${process.arch}`,
      timestamp: new Date().toISOString(),
      passed: result.passed
    };
    this.evidence.addRun(researchId, record);
    return { record, passed: result.passed };
  }
}
