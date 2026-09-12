/**
 * Update-Plan/checkpoint-1.md §39 + §40 — publishing: branch, commit, PR.
 *
 * §39.1 fixes the branch name (`boss/<task-id>/<slug>`), §39.2 says a commit must
 * be tied to its Task, Requirements, Candidate and Evidence, and §40 says a PR must
 * carry the goal, what changed, requirements, tests, evidence, known limitations,
 * risk and rollback — plus four theme sections when the Theme Engine is involved.
 *
 * The doctrine shows up as refusals: a commit message without its trailers is not
 * a commit Boss may make, a PR body missing a section is not a PR Boss may open, and
 * §38's checkpoint guard is a *precondition* of the sequence rather than advice —
 * `planRelease` will not emit a remote write it cannot justify.
 *
 * Pure: no fs, no network, no clock.
 */
import { contentHashOf } from "./workbook";
import type { VersionImpact } from "./version-impact";
import type { CheckpointRecord } from "./git-checkpoint";

export const PUBLISH_VERSION = "publish-plan-1" as const;

/* ------------------------------------------------------------------ *
 * §39.1 branch policy
 * ------------------------------------------------------------------ */

export const BRANCH_PREFIX = "boss";

/** A slug keeps letters, digits and single hyphens, and stays short. */
export function slugify(text: string, limit = 48): string {
  const slug = text
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, limit)
    .replace(/-+$/g, "");
  return slug || "task";
}

/** §39.1: `boss/<task-id>/<slug>`. */
export function branchNameFor(input: { task_id: string; slug: string }): string {
  const taskId = input.task_id.trim().toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!taskId) throw new Error("§39.1: a branch needs a task id");
  return `${BRANCH_PREFIX}/${taskId}/${slugify(input.slug)}`;
}

export interface BranchPolicyCheck {
  ok: boolean;
  task_id?: string;
  slug?: string;
  reason: string;
}

/** A branch Boss may write to is one Boss itself named, or the base it started from is not allowed. */
export function checkBranchPolicy(branch: string): BranchPolicyCheck {
  const parts = branch.split("/");
  if (parts.length !== 3) return { ok: false, reason: `§39.1: "${branch}" is not boss/<task-id>/<slug>` };
  const [prefix, taskId, slug] = parts as [string, string, string];
  if (prefix !== BRANCH_PREFIX) return { ok: false, reason: `§39.1: "${branch}" must start with ${BRANCH_PREFIX}/` };
  if (!taskId || !slug) return { ok: false, reason: `§39.1: "${branch}" needs both a task id and a slug` };
  if (!/^[a-z0-9._-]+$/.test(taskId)) return { ok: false, reason: `§39.1: task id "${taskId}" is not a safe path segment` };
  if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, reason: `§39.1: slug "${slug}" is not a safe path segment` };
  if (BRANCH_PREFIX === branch) return { ok: false, reason: `§39.1: "${branch}" is protected` };
  return { ok: true, task_id: taskId, slug, reason: `§39.1: "${branch}" follows the branch policy` };
}

/* ------------------------------------------------------------------ *
 * §39.2 commit policy
 * ------------------------------------------------------------------ */

export const COMMIT_TRAILERS = ["Task", "Requirements", "Candidate", "Evidence"] as const;
export type CommitTrailer = (typeof COMMIT_TRAILERS)[number];

export interface CommitInput {
  summary: string;
  /** Optional longer explanation, in the Owner's terms. */
  detail?: string;
  task_id: string;
  requirements: readonly string[];
  candidate_id: string;
  /** Evidence pointers: §31.3 ledger rows, review ids, checkpoint id. */
  evidence: readonly string[];
  /** §37 impact, carried so a release commit explains its own weight. */
  version_impact?: VersionImpact;
}

/** §39.2: the commit Boss makes, with everything a reviewer needs to trace it. */
export function buildCommitMessage(input: CommitInput): string {
  const summary = input.summary.trim().split(/\r?\n/)[0]?.slice(0, 100) ?? "";
  const lines: string[] = [summary || `task ${input.task_id}`, ""];
  if (input.detail?.trim()) lines.push(input.detail.trim(), "");
  if (input.version_impact) lines.push(`Version-Impact: ${input.version_impact}`, "");
  for (const trailer of COMMIT_TRAILERS) {
    const value = trailer === "Task" ? input.task_id
      : trailer === "Requirements" ? input.requirements.join(", ")
        : trailer === "Candidate" ? input.candidate_id
          : input.evidence.join(", ");
    lines.push(`${trailer}: ${value}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export interface CommitPolicyCheck {
  ok: boolean;
  missing: CommitTrailer[];
  requirements: string[];
  evidence: string[];
  reason: string;
}

/** §39.2: a commit without its trailers is refused, not committed and fixed later. */
export function validateCommitMessage(message: string): CommitPolicyCheck {
  const missing: CommitTrailer[] = [];
  const value = (trailer: CommitTrailer): string => {
    const match = new RegExp(`^${trailer}:\\s*(.+)$`, "m").exec(message);
    return match?.[1]?.trim() ?? "";
  };
  const requirements = value("Requirements").split(",").map((entry) => entry.trim()).filter(Boolean);
  const evidence = value("Evidence").split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const trailer of COMMIT_TRAILERS) if (!value(trailer)) missing.push(trailer);
  if (missing.length) return { ok: false, missing, requirements, evidence, reason: `§39.2: the commit does not name ${missing.join(", ")}` };
  if (!requirements.length) return { ok: false, missing: ["Requirements"], requirements, evidence, reason: "§39.2: the commit names no requirement, so nothing traces it to the goal" };
  if (!evidence.length) return { ok: false, missing: ["Evidence"], requirements, evidence, reason: "§39.2: the commit cites no evidence" };
  return { ok: true, missing: [], requirements, evidence, reason: `§39.2: the commit traces ${requirements.length} requirement(s) and ${evidence.length} evidence pointer(s)` };
}

/* ------------------------------------------------------------------ *
 * §40 pull request body
 * ------------------------------------------------------------------ */

export const PR_SECTIONS = [
  "Goal",
  "What changed",
  "Requirements",
  "Tests",
  "Evidence",
  "Known limitations",
  "Risk",
  "Rollback"
] as const;

export const THEME_PR_SECTIONS = ["UI surfaces affected", "Visual evidence", "Fallback behavior", "Theme migration"] as const;

export interface PullRequestInput {
  goal: string;
  what_changed: readonly string[];
  requirements: readonly { id: string; text: string; state: string }[];
  tests: readonly string[];
  evidence: readonly string[];
  known_limitations: readonly string[];
  risk: string;
  rollback: string;
  /** §40: present when the change involves the Theme Engine. */
  theme?: {
    surfaces: readonly string[];
    visual_evidence: readonly string[];
    fallback: string;
    migration: string;
  };
}

function section(title: string, body: readonly string[] | string): string {
  const text = Array.isArray(body)
    ? (body as readonly string[]).filter((line) => line.trim()).map((line) => `- ${line}`).join("\n")
    : (body as string).trim();
  return `## ${title}\n\n${text || "_(none)_"}\n`;
}

/** §40: the PR body, in the plan's order, with the theme sections when they apply. */
export function buildPullRequestBody(input: PullRequestInput): string {
  const parts = [
    section("Goal", input.goal),
    section("What changed", input.what_changed),
    section("Requirements", input.requirements.map((requirement) => `${requirement.id} (${requirement.state}): ${requirement.text}`)),
    section("Tests", input.tests),
    section("Evidence", input.evidence),
    section("Known limitations", input.known_limitations),
    section("Risk", input.risk),
    section("Rollback", input.rollback)
  ];
  if (input.theme) {
    parts.push(
      section("UI surfaces affected", input.theme.surfaces),
      section("Visual evidence", input.theme.visual_evidence),
      section("Fallback behavior", input.theme.fallback),
      section("Theme migration", input.theme.migration)
    );
  }
  return parts.join("\n");
}

export interface PullRequestCheck {
  ok: boolean;
  missing: string[];
  empty: string[];
  requires_theme_sections: boolean;
  reason: string;
}

/** §40: every required section must be present and non-empty; `_(none)_` is not a section body. */
export function validatePullRequestBody(body: string, options: { theme?: boolean } = {}): PullRequestCheck {
  const required = [...PR_SECTIONS, ...(options.theme ? THEME_PR_SECTIONS : [])];
  const missing: string[] = [];
  const empty: string[] = [];
  for (const title of required) {
    const match = new RegExp(`^## ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").exec(body);
    if (!match) { missing.push(title); continue; }
    const rest = body.slice(match.index + match[0].length);
    const nextHeading = rest.search(/^## /m);
    const filled = (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest).trim();
    if (!filled) empty.push(title);
  }
  const ok = missing.length === 0 && empty.length === 0;
  return {
    ok,
    missing,
    empty,
    requires_theme_sections: options.theme === true,
    reason: ok
      ? `§40: the PR body carries all ${required.length} required section(s)`
      : `§40: the PR body is missing ${missing.join(", ") || "nothing"}${empty.length ? ` and leaves ${empty.join(", ")} empty` : ""}`
  };
}

/* ------------------------------------------------------------------ *
 * the release sequence
 * ------------------------------------------------------------------ */

export const RELEASE_STEPS = ["CHECKPOINT", "BRANCH", "COMMIT", "PUSH", "PULL_REQUEST", "READ_CI"] as const;
export type ReleaseStep = (typeof RELEASE_STEPS)[number];

export interface ReleasePlanInput {
  task_id: string;
  slug: string;
  goal: string;
  requirements: readonly string[];
  candidate_id: string;
  evidence: readonly string[];
  /** §38: the guard's verdict for the remote write. */
  checkpoint?: { allowed: boolean; reason: string; record?: CheckpointRecord };
  /** §39.1: the base branch the work branched from. */
  base_branch: string;
  commit?: CommitInput;
  pull_request?: PullRequestInput;
  theme?: boolean;
}

export interface ReleasePlanStep {
  step: ReleaseStep;
  ready: boolean;
  detail: string;
}

export interface ReleasePlan {
  schemaVersion: 1;
  version: typeof PUBLISH_VERSION;
  allowed: boolean;
  branch: string;
  base_branch: string;
  steps: ReleasePlanStep[];
  commit_message?: string;
  pull_request_body?: string;
  hash: string;
  reasons: string[];
}

/**
 * §38 + §39 + §40 as one sequence.
 *
 * The first step that cannot be justified stops the plan: no checkpoint means no
 * branch, an off-policy branch name means no push, a commit that loses its trailers
 * means no commit, and a PR body with a hole means no PR.
 */
export function planRelease(input: ReleasePlanInput): ReleasePlan {
  const reasons: string[] = [];
  const steps: ReleasePlanStep[] = [];
  const branch = (() => {
    try { return branchNameFor({ task_id: input.task_id, slug: input.slug }); } catch { return ""; }
  })();
  const branchCheck = branch ? checkBranchPolicy(branch) : { ok: false, reason: "§39.1: the branch name could not be derived" };

  const checkpointReady = input.checkpoint?.allowed === true;
  steps.push({ step: "CHECKPOINT", ready: checkpointReady, detail: input.checkpoint?.reason ?? "§38: no checkpoint guard result was supplied" });
  if (!checkpointReady) reasons.push(input.checkpoint?.reason ?? "§38: no checkpoint covers this release");

  steps.push({ step: "BRANCH", ready: branchCheck.ok, detail: branchCheck.reason });
  if (!branchCheck.ok) reasons.push(branchCheck.reason);

  const commit = input.commit ? buildCommitMessage(input.commit) : undefined;
  const commitCheck = commit ? validateCommitMessage(commit) : { ok: false, reason: "§39.2: no commit was planned", missing: [], requirements: [], evidence: [] };
  steps.push({ step: "COMMIT", ready: commitCheck.ok, detail: commitCheck.reason });
  if (!commitCheck.ok) reasons.push(commitCheck.reason);

  const pushReady = checkpointReady && branchCheck.ok && commitCheck.ok;
  steps.push({ step: "PUSH", ready: pushReady, detail: pushReady ? `push ${branch} to the remote` : "§38/§39: the precondition above is not satisfied" });

  const prBody = input.pull_request ? buildPullRequestBody(input.pull_request) : undefined;
  const prCheck = prBody ? validatePullRequestBody(prBody, { theme: input.theme ?? Boolean(input.pull_request?.theme) }) : { ok: false, reason: "§40: no pull request was planned" };
  steps.push({ step: "PULL_REQUEST", ready: pushReady && prCheck.ok, detail: prCheck.reason });
  if (!prCheck.ok) reasons.push(prCheck.reason);

  const readCi = pushReady && prCheck.ok;
  steps.push({ step: "READ_CI", ready: readCi, detail: readCi ? "read the checks for the pushed commit and repair if they fail (§41)" : "§41: nothing was pushed to check" });

  const allowed = steps.every((step) => step.ready);
  const plan: Omit<ReleasePlan, "hash"> = {
    schemaVersion: 1,
    version: PUBLISH_VERSION,
    allowed,
    branch,
    base_branch: input.base_branch,
    steps,
    ...(commit ? { commit_message: commit } : {}),
    ...(prBody ? { pull_request_body: prBody } : {}),
    reasons: allowed ? [`§39/§40: ${branch} is ready to publish`] : reasons
  };
  return { ...plan, hash: contentHashOf(JSON.stringify(plan)) };
}
