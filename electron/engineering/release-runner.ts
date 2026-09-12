/**
 * Update-Plan/checkpoint-1.md §39/§40 — the publishing runner.
 *
 * Executes the release the plan describes, for real:
 *
 *   1. §38's guard must allow the write, otherwise nothing happens;
 *   2. a branch named by §39.1's policy is created and the change is staged;
 *   3. §39.2's commit message carries Task/Requirements/Candidate/Evidence;
 *   4. the branch is pushed to the configured remote;
 *   5. §40's pull request is opened through the real `GitHubGateway`, whose
 *      transport is injected — so a test can prove the exact REST calls and bodies
 *      Boss would send without touching the network.
 *
 * The runner never invents the remote: without a configured remote (or with the
 * gateway unavailable) it reports what it could not do instead of pretending.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contentHashOf } from "../../src/shared/workbook";
import {
  buildCommitMessage,
  buildPullRequestBody,
  checkBranchPolicy,
  planRelease,
  type CommitInput,
  type PullRequestInput,
  type ReleasePlan
} from "../../src/shared/publish-plan";
import { guardGitHubWrite, type CheckpointRecord } from "../../src/shared/git-checkpoint";
import type { GitHubGateway } from "../github/github-gateway";
import type { GitHubResult } from "../../src/shared/github-machine";

export const RELEASE_RECORD_FILE = "release-record.json";

export interface ReleaseRunnerConfig {
  root: string;
  /** The git remote the branch is pushed to (a path or a URL). */
  remote?: string;
  /** The remote's repository name (`owner/name`) for the gateway calls. */
  repository?: string;
  gateway?: GitHubGateway;
  recordPath?: string;
  now?: () => Date;
  /** Test seam: overrides the git invocation. */
  git?: (args: string[]) => { ok: boolean; out: string };
}

export interface ReleaseInput {
  task_id: string;
  candidate_id: string;
  slug: string;
  goal: string;
  base_branch: string;
  requirements: readonly { id: string; text: string; state: string }[];
  evidence: readonly string[];
  tests: readonly string[];
  known_limitations: readonly string[];
  risk: string;
  rollback: string;
  summary: string;
  detail?: string;
  version_impact?: CommitInput["version_impact"];
  /** Files to stage, relative to the root. Empty means "everything". */
  paths?: readonly string[];
  theme?: PullRequestInput["theme"];
  checkpoints: readonly CheckpointRecord[];
  current: { head: string; branch: string; diff_hash: string };
}

export interface ReleaseRecord {
  schemaVersion: 1;
  version: "release-record-1";
  task_id: string;
  branch: string;
  base_branch: string;
  checkpoint_id?: string;
  commit_sha?: string;
  pushed: boolean;
  pull_request?: { number?: number; url?: string; body_hash: string; title: string };
  plan_hash: string;
  steps: { step: string; done: boolean; detail: string }[];
  decision: "PUBLISHED" | "REFUSED" | "PARTIAL";
  reasons: string[];
  created_at: string;
}

export interface ReleaseRunner {
  /** §38 + §39 + §40 as a plan, without touching anything. */
  plan(input: ReleaseInput): ReleasePlan;
  /** Executes the plan that the guard allows. */
  run(input: ReleaseInput): Promise<ReleaseRecord>;
  record(): ReleaseRecord | undefined;
  /** Deliberately local work for the repair loop (§41) — never a remote write. */
  readRemoteCommit(branch: string): string | undefined;
}

export function createReleaseRunner(config: ReleaseRunnerConfig): ReleaseRunner {
  const root = fs.realpathSync(config.root);
  const now = config.now ?? (() => new Date());
  const recordPath = config.recordPath ?? path.join(root, "artifacts", "acceptance", RELEASE_RECORD_FILE);
  const git = config.git ?? ((args: string[]) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  });
  let record: ReleaseRecord | undefined = load(recordPath);

  const planFor = (input: ReleaseInput): ReleasePlan => planRelease({
    task_id: input.task_id,
    slug: input.slug,
    goal: input.goal,
    requirements: input.requirements.map((requirement) => requirement.id),
    candidate_id: input.candidate_id,
    evidence: input.evidence,
    base_branch: input.base_branch,
    checkpoint: guardGitHubWrite({ checkpoints: input.checkpoints, task_id: input.task_id, current: input.current, operation: "PUSH" }),
    commit: {
      summary: input.summary,
      ...(input.detail ? { detail: input.detail } : {}),
      task_id: input.task_id,
      requirements: input.requirements.map((requirement) => requirement.id),
      candidate_id: input.candidate_id,
      evidence: input.evidence,
      ...(input.version_impact ? { version_impact: input.version_impact } : {})
    },
    pull_request: {
      goal: input.goal,
      what_changed: [input.summary, ...(input.detail ? [input.detail] : [])],
      requirements: input.requirements,
      tests: input.tests,
      evidence: input.evidence,
      known_limitations: input.known_limitations,
      risk: input.risk,
      rollback: input.rollback,
      ...(input.theme ? { theme: input.theme } : {})
    },
    ...(input.theme ? { theme: true } : {})
  });

  return {
    plan: planFor,
    record: () => record,
    readRemoteCommit(branch) {
      if (!config.remote) return undefined;
      const remote = /^[A-Za-z]:[\\/]|^\//.test(config.remote) || config.remote.startsWith(".")
        ? config.remote
        : config.remote;
      const result = spawnSync("git", ["--git-dir", remote, "log", "-1", "--pretty=%H%n%B", branch], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
      return result.status === 0 ? `${result.stdout ?? ""}`.trim() : undefined;
    },
    async run(input) {
      const plan = planFor(input);
      const steps: ReleaseRecord["steps"] = [];
      const reasons: string[] = [];
      const checkpoint = plan.steps.find((step) => step.step === "CHECKPOINT");
      const guard = guardGitHubWrite({ checkpoints: input.checkpoints, task_id: input.task_id, current: input.current, operation: "PUSH" });
      if (!plan.allowed) {
        const refused: ReleaseRecord = {
          schemaVersion: 1,
          version: "release-record-1",
          task_id: input.task_id,
          branch: plan.branch,
          base_branch: input.base_branch,
          pushed: false,
          plan_hash: plan.hash,
          steps: plan.steps.map((step) => ({ step: step.step, done: false, detail: step.detail })),
          decision: "REFUSED",
          reasons: plan.reasons,
          created_at: now().toISOString()
        };
        record = refused;
        persist();
        return refused;
      }
      void checkpoint;

      // §39.1: the policy-named branch, from the base the work started on.
      const branchCheck = checkBranchPolicy(plan.branch);
      if (!branchCheck.ok) reasons.push(branchCheck.reason);
      git(["checkout", "-B", plan.branch]);
      steps.push({ step: "BRANCH", done: true, detail: `on ${plan.branch}` });

      // §39.2: stage and commit with the trailers the plan built.
      git(["add", ...(input.paths?.length ? [...input.paths] : ["--all"])]);
      const commitFile = path.join(root, "artifacts", "acceptance", `.commit-${Date.now()}.txt`);
      fs.mkdirSync(path.dirname(commitFile), { recursive: true });
      fs.writeFileSync(commitFile, plan.commit_message ?? buildCommitMessage({
        summary: input.summary, task_id: input.task_id, requirements: input.requirements.map((requirement) => requirement.id),
        candidate_id: input.candidate_id, evidence: input.evidence
      }), "utf8");
      const commit = git(["commit", "--quiet", "-F", commitFile]);
      fs.rmSync(commitFile, { force: true });
      const commitSha = git(["rev-parse", "HEAD"]).out.trim();
      steps.push({ step: "COMMIT", done: commit.ok, detail: commit.ok ? `commit ${commitSha.slice(0, 12)}` : commit.out.slice(0, 200) });
      if (!commit.ok) reasons.push(`§39.2: the commit failed: ${commit.out.slice(0, 200)}`);

      // The push goes to the configured remote, and only when one exists.
      let pushed = false;
      if (commit.ok && config.remote) {
        const push = git(["push", config.remote, plan.branch]);
        pushed = push.ok;
        steps.push({ step: "PUSH", done: push.ok, detail: push.ok ? `pushed ${plan.branch} to the remote` : push.out.slice(0, 200) });
        if (!push.ok) reasons.push(`§39: the push failed: ${push.out.slice(0, 200)}`);
      } else {
        steps.push({ step: "PUSH", done: false, detail: config.remote ? "no commit to push" : "no remote is configured, so nothing was pushed" });
        if (!config.remote) reasons.push("§39: no remote is configured; the work stays local");
      }

      // §40: the pull request, through the real gateway when one is attached.
      let pullRequest: ReleaseRecord["pull_request"];
      const prReady = pushed && config.gateway && config.repository;
      if (prReady) {
        const body = plan.pull_request_body ?? buildPullRequestBody({
          goal: input.goal, what_changed: [input.summary], requirements: input.requirements, tests: input.tests,
          evidence: input.evidence, known_limitations: input.known_limitations, risk: input.risk, rollback: input.rollback
        });
        const result: GitHubResult<Record<string, unknown>> = await config.gateway!.createPullRequest(config.repository!, {
          head: plan.branch,
          base: input.base_branch,
          title: input.summary.slice(0, 120),
          body
        });
        if (result.ok) {
          const number = typeof result.value.number === "number" ? result.value.number : undefined;
          const url = typeof result.value.html_url === "string" ? result.value.html_url : undefined;
          pullRequest = { ...(number !== undefined ? { number } : {}), ...(url ? { url } : {}), body_hash: contentHashOf(body), title: input.summary.slice(0, 120) };
          steps.push({ step: "PULL_REQUEST", done: true, detail: `opened #${number ?? "?"}` });
        } else {
          steps.push({ step: "PULL_REQUEST", done: false, detail: `${result.code}: ${result.message}` });
          reasons.push(`§40: the pull request was refused (${result.code}): ${result.message}`);
        }
      } else {
        steps.push({ step: "PULL_REQUEST", done: false, detail: !pushed ? "nothing was pushed, so no pull request was opened" : "no gateway or repository is configured" });
      }

      const decision: ReleaseRecord["decision"] = pullRequest ? "PUBLISHED" : pushed ? "PARTIAL" : "REFUSED";
      const releaseRecord: ReleaseRecord = {
        schemaVersion: 1,
        version: "release-record-1",
        task_id: input.task_id,
        branch: plan.branch,
        base_branch: input.base_branch,
        ...(guard.checkpoint ? { checkpoint_id: guard.checkpoint.id } : {}),
        ...(commit.ok ? { commit_sha: commitSha } : {}),
        pushed,
        ...(pullRequest ? { pull_request: pullRequest } : {}),
        plan_hash: plan.hash,
        steps,
        decision,
        reasons: reasons.length ? reasons : ["§39/§40: the branch, commit and pull request were published"],
        created_at: now().toISOString()
      };
      record = releaseRecord;
      persist();
      return releaseRecord;
    }
  };

  function persist(): void {
    if (!record) return;
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf8");
  }
}

function load(recordPath: string): ReleaseRecord | undefined {
  if (!fs.existsSync(recordPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath, "utf8")) as ReleaseRecord;
    return parsed?.version === "release-record-1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
