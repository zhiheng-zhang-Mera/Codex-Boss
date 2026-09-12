/**
 * Update-Plan/checkpoint-1.md §41 — the CI repair loop (host side).
 *
 * The loop the plan draws, executed with the real machinery built so far:
 *
 *   read CI (§39 gateway) → PASS? → else parse (§41) → classify (§33) →
 *   repair (the §30/§32 implementation loop) → local verify (§31 ladder) →
 *   push (the §38/§39/§40 runner) → read CI again.
 *
 * It stops at PASS or at a Hard Blocker: the attempt budget comes from §33.2's
 * recovery steps, so a repeated identical failure cannot be retried forever, and a
 * terminal failure is never repaired.
 */
import fs from "node:fs";
import path from "node:path";
import { parseCiFailure, planCiRepair, ciVerdict, loopOutcome, type CiRepairPlan, type CiRunDescriptor, type ParsedCiFailure } from "../../src/shared/ci-repair";
import { recordEvidence, type EvidenceLedgerFile } from "../../src/shared/evidence-ledger";
import type { RecoveryAttempt } from "../../src/shared/recovery";
import type { GitHubGateway } from "../github/github-gateway";
import type { GitHubResult } from "../../src/shared/github-machine";
import type { ReleaseRunner, ReleaseInput } from "./release-runner";
import type { VerificationEngine } from "./verification-engine";

export const CI_REPAIR_RECORD_FILE = "ci-repair-record.json";
export const DEFAULT_MAX_CI_ATTEMPTS = 3;

export interface CiReadResult {
  ok: boolean;
  conclusion?: string;
  run_id?: number;
  reason?: string;
  /** The log of the failing job, when it could be fetched. */
  log?: string;
}

export interface CiRepairLoopConfig {
  root: string;
  /** Reads the latest CI result for a branch: the real gateway, or a test seam. */
  readCi: (branch: string) => Promise<CiReadResult>;
  /** The §39/§40 runner used to push the repair. */
  release: ReleaseRunner;
  engine: VerificationEngine;
  gateway?: GitHubGateway;
  repository?: string;
  recordPath?: string;
  now?: () => Date;
}

export interface CiRepairInput {
  task_id: string;
  branch: string;
  slug: string;
  base_branch: string;
  candidate_id: string;
  goal: string;
  requirements: readonly { id: string; text: string; state: string }[];
  evidence: readonly string[];
  tests: readonly string[];
  known_limitations: readonly string[];
  risk: string;
  rollback: string;
  summary: string;
  /** The bounded worker that repairs what CI reported. */
  repair: (input: { plan: CiRepairPlan; parsed: ParsedCiFailure; attempt: number }) => Promise<{ changed_files: string[]; note?: string } | undefined>;
  /**
   * The commit/checkpoint inputs the push needs, evaluated **at push time**: the
   * repair changed the tree, so the §38 checkpoint must be taken after it rather
   * than reused from before.
   */
  releaseInput: () => Omit<ReleaseInput, "summary" | "paths">;
  maxAttempts?: number;
}

export interface CiAttemptRecord {
  attempt: number;
  run_id?: number;
  conclusion?: string;
  step?: string;
  failure_class?: string;
  signature?: string;
  local_gates: { gate: string; result: string }[];
  repaired_files: string[];
  pushed: boolean;
  commit_sha?: string;
  note?: string;
  decision?: CiRepairPlan["decision"];
}

export interface CiRepairRecord {
  schemaVersion: 1;
  version: "ci-repair-record-1";
  task_id: string;
  branch: string;
  outcome: "PASS" | "HARD_BLOCKER" | "IN_PROGRESS";
  attempts: CiAttemptRecord[];
  plan?: CiRepairPlan;
  reasons: string[];
  created_at: string;
}

export interface CiRepairLoop {
  run(input: CiRepairInput): Promise<CiRepairRecord>;
  record(): CiRepairRecord | undefined;
}

export function createCiRepairLoop(config: CiRepairLoopConfig): CiRepairLoop {
  const root = fs.realpathSync(config.root);
  const now = config.now ?? (() => new Date());
  const recordPath = config.recordPath ?? path.join(root, "artifacts", "acceptance", CI_REPAIR_RECORD_FILE);
  let record: CiRepairRecord | undefined = load(recordPath);

  return {
    record: () => record,
    async run(input) {
      const maxAttempts = Math.max(1, Math.min(5, input.maxAttempts ?? DEFAULT_MAX_CI_ATTEMPTS));
      const attempts: CiAttemptRecord[] = [];
      const reasons: string[] = [];
      const recoveryAttempts: RecoveryAttempt[] = [];
      let outcome: CiRepairRecord["outcome"] = "IN_PROGRESS";
      let lastPlan: CiRepairPlan | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const read = await config.readCi(input.branch);
        const verdict = ciVerdict({ ok: read.ok, ...(read.conclusion !== undefined ? { conclusion: read.conclusion } : {}), ...(read.reason !== undefined ? { reason: read.reason } : {}) });
        if (verdict.passed) {
          attempts.push({ attempt, ...(read.run_id !== undefined ? { run_id: read.run_id } : {}), conclusion: read.conclusion, local_gates: [], repaired_files: [], pushed: false });
          outcome = "PASS";
          reasons.push(verdict.reason);
          break;
        }
        if (!read.ok || !read.log) {
          // A CI read that failed cannot be repaired: it is not evidence of a code
          // defect, and guessing at a cause would be worse than stopping.
          attempts.push({ attempt, ...(read.run_id !== undefined ? { run_id: read.run_id } : {}), local_gates: [], repaired_files: [], pushed: false });
          outcome = "HARD_BLOCKER";
          reasons.push(verdict.reason);
          break;
        }

        const parsed = parseCiFailure({ log: read.log, descriptor: { branch: input.branch, ...(read.run_id !== undefined ? {} : {}) } satisfies CiRunDescriptor });
        const plan = planCiRepair({ parsed, attempts: recoveryAttempts });
        lastPlan = plan;
        const base: CiAttemptRecord = {
          attempt,
          ...(read.run_id !== undefined ? { run_id: read.run_id } : {}),
          ...(read.conclusion !== undefined ? { conclusion: read.conclusion } : {}),
          ...(parsed.step ? { step: parsed.step } : {}),
          failure_class: plan.failure_class,
          signature: plan.signature,
          local_gates: [],
          repaired_files: [],
          pushed: false,
          decision: plan.decision
        };
        if (plan.decision === "HARD_BLOCKER") {
          attempts.push(base);
          outcome = "HARD_BLOCKER";
          reasons.push(...plan.reasons);
          break;
        }

        const repaired = await input.repair({ plan, parsed, attempt });
        base.repaired_files = repaired?.changed_files ?? [];
        if (repaired?.note) base.note = repaired.note;

        // §41 "local verify": the gates the classification demands.
        let gatesPassed = true;
        for (const gate of plan.local_gates) {
          const requirement = { id: `${input.task_id}-ci`, type: "FUNCTIONAL" as const, text: "the repository passes the gate CI failed", visual: false };
          const selection = config.engine.selectFor(requirement);
          const wanted = selection.gates.filter((decision) => decision.gate === gate);
          if (!wanted.length) { base.local_gates.push({ gate, result: "NOT_RUN" }); gatesPassed = false; continue; }
          const result = await config.engine.verifyRequirement({ ...selection, gates: wanted });
          const status = result.outcome.outcome;
          base.local_gates.push({ gate, result: status });
          if (status !== "PASS") gatesPassed = false;
        }
        recoveryAttempts.push({ step: "LOCAL_RECOVERY", outcome: gatesPassed ? "PASS" : "FAIL", detail: `attempt ${attempt}` });
        if (!gatesPassed) {
          reasons.push(`§41: attempt ${attempt} did not pass the local gate(s) ${plan.local_gates.join(", ")}, so nothing was pushed`);
          attempts.push(base);
          const next = planCiRepair({ parsed, attempts: recoveryAttempts });
          lastPlan = next;
          if (next.decision === "HARD_BLOCKER") { outcome = "HARD_BLOCKER"; reasons.push(...next.reasons); break; }
          continue;
        }

        // §41 "push": through the §38/§39/§40 runner, with release state read now.
        const release = await config.release.run({
          ...input.releaseInput(),
          summary: input.summary,
          ...(base.repaired_files.length ? { paths: base.repaired_files } : {})
        });
        base.pushed = release.pushed;
        if (release.commit_sha) base.commit_sha = release.commit_sha;
        attempts.push(base);
        if (!release.pushed) {
          reasons.push(`§41: attempt ${attempt} could not be pushed (${release.decision}): ${release.reasons.join("; ")}`);
          outcome = "HARD_BLOCKER";
          break;
        }
        reasons.push(`§41: attempt ${attempt} pushed ${release.commit_sha?.slice(0, 12) ?? "a commit"} to ${input.branch}; CI will be read again`);
      }

      if (outcome === "IN_PROGRESS") {
        // The loop ran out of attempts without a green CI: that is a Hard Blocker.
        outcome = "HARD_BLOCKER";
        reasons.push(`§41: ${attempts.length} attempt(s) were used without a green CI, so the loop stops at the Hard Blocker`);
      }
      record = {
        schemaVersion: 1,
        version: "ci-repair-record-1",
        task_id: input.task_id,
        branch: input.branch,
        outcome,
        attempts,
        ...(lastPlan ? { plan: lastPlan } : {}),
        reasons,
        created_at: now().toISOString()
      };
      fs.mkdirSync(path.dirname(recordPath), { recursive: true });
      fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf8");
      // §31.3: the CI read and its classification are evidence too.
      const ledger: EvidenceLedgerFile = config.engine.ledger();
      recordEvidence(ledger, {
        requirement_ids: [input.task_id],
        gate: "INTEGRATION",
        command: "ci read + classify",
        environment: config.engine.environment,
        result: outcome === "PASS" ? "PASS" : "FAIL",
        captured_at: now().toISOString(),
        detail: reasons.join(" | ").slice(0, 400)
      });
      config.engine.save();
      return record;
    }
  };
}

/** §39: reads the latest workflow run for a branch through the real gateway. */
export function gatewayCiReader(gateway: GitHubGateway, repository: string): (branch: string) => Promise<CiReadResult> {
  return async (branch) => {
    const runs: GitHubResult<Record<string, unknown>> = await gateway.inspectWorkflowRuns(repository, branch);
    if (!runs.ok) return { ok: false, reason: `${runs.code}: ${runs.message}` };
    const list = Array.isArray((runs.value as { workflow_runs?: unknown[] }).workflow_runs) ? (runs.value as { workflow_runs: Record<string, unknown>[] }).workflow_runs : [];
    const latest = list[0];
    if (!latest) return { ok: false, reason: "no workflow run was found for the branch" };
    const runId = typeof latest.id === "number" ? latest.id : undefined;
    const conclusion = typeof latest.conclusion === "string" ? latest.conclusion : undefined;
    if (conclusion === "success") return { ok: true, conclusion, ...(runId !== undefined ? { run_id: runId } : {}) };
    if (runId === undefined) return { ok: false, conclusion, reason: "the run has no id, so its log cannot be read" };
    const workflow: GitHubResult<Record<string, unknown>> = await gateway.inspectWorkflow(repository, runId);
    if (!workflow.ok) return { ok: false, conclusion, run_id: runId, reason: `${workflow.code}: ${workflow.message}` };
    const jobs = Array.isArray((workflow.value as { jobs?: unknown[] }).jobs) ? (workflow.value as { jobs: Record<string, unknown>[] }).jobs : [];
    const failedJob = jobs.find((job) => job.conclusion === "failure") ?? jobs[0];
    const steps = Array.isArray(failedJob?.steps) ? (failedJob!.steps as Record<string, unknown>[]) : [];
    const failedStep = steps.find((step) => step.conclusion === "failure");
    const log = [
      failedStep ? `##[error]${String(failedStep.name)}` : "",
      ...steps.filter((step) => step.conclusion === "failure").map((step) => `Run ${String(step.name)}`),
      "Error: Process completed with exit code 1."
    ].filter(Boolean).join("\n");
    return { ok: true, conclusion, run_id: runId, log };
  };
}

function load(recordPath: string): CiRepairRecord | undefined {
  if (!fs.existsSync(recordPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath, "utf8")) as CiRepairRecord;
    return parsed?.version === "ci-repair-record-1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export { loopOutcome };
