import fs from "node:fs";
import path from "node:path";
import type { EngineeringFinding, EngineeringGoalContract, ReviewerFinding } from "../../src/shared/engineering-loop";
import { parseReviewerFindings } from "../../src/shared/engineering-loop";
import type { EngineeringLoopOperations } from "./engineering-loop-driver";
import { ProposalRunner } from "./proposal-runner";
import { engineeringChecksFor } from "./verification-policy";
import { candidateFilesForFinding } from "./finding-scope";

/**
 * Live engineering operations (plan §6.1.1 `live-engineering-operations.ts`).
 *
 * The production implement/review pair for the autonomous engineering loop.
 * `implement` turns one finding into a bounded patch through the real coder
 * role (ProposalRunner + host verification), never an unbounded repo edit;
 * `review` sends the changed diff + acceptance evidence to an independent
 * reviewer role and returns structured findings for reflow (§6.2/§6.3).
 *
 * Workers are injected by the caller (production: RoleRouter dispatch inside
 * the main process — a Web/API/Codex runtime; tests: deterministic editors).
 * The loop contract is enforced here too: a finding with no inferable scope is
 * an honest ABORT, not a whole-repo rewrite.
 */

export interface EngineeringRoleWorker {
  /** Runs one role turn; returns the assistant text or throws with a reason. */
  ask(role: "coder" | "reviewer", prompt: string): Promise<string>;
}

export interface LiveEngineeringOperationsOptions {
  /** Real workspace root (git repo or plain folder). */
  workspace: string;
  /** Frozen goal contract (unchanged across iterations). */
  goal: EngineeringGoalContract;
  /** Role worker used for implement (coder) and review (reviewer). */
  worker: EngineeringRoleWorker;
  /** Max candidate files a single finding may touch (default 40). */
  maxScopeFiles?: number;
}

export interface ImplementOutcome {
  changedFiles: string[];
  error?: string;
  verification?: {
    checksTotal: number;
    checksPassed: number;
    repairs: number;
    diff: string;
  };
}

export interface ReviewOutcome {
  findings: ReviewerFinding[];
  raw: string;
}

/** Concise diff evidence for the reviewer (git diff when available). */
async function diffEvidence(workspace: string, changedFiles: string[]): Promise<string> {
  const root = fs.realpathSync(workspace);
  const gitDir = path.join(root, ".git");
  if (!fs.existsSync(gitDir)) {
    // Plain folder: show the current content of the changed files.
    const parts: string[] = [];
    for (const file of changedFiles) {
      const target = path.join(root, file.split("/").join(path.sep));
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
      const content = fs.readFileSync(target, "utf8");
      parts.push(`--- ${file}\n+++ ${file}\n${content.slice(0, 20000)}`);
    }
    return parts.join("\n").slice(0, 120000);
  }
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    const args = ["diff", "--no-ext-diff", "--", ...changedFiles.slice(0, 50)];
    execFile("git", args, { cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve(String(stdout) + String(stderr));
    });
  });
}

/** Current content of the changed files (reviewer context, bounded). */
function changedFileContext(workspace: string, changedFiles: string[]): string {
  const root = fs.realpathSync(workspace);
  const parts: string[] = [];
  for (const file of changedFiles) {
    const target = path.join(root, file.split("/").join(path.sep));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    if (fs.statSync(target).size > 100000) continue;
    parts.push(`### ${file}\n${fs.readFileSync(target, "utf8")}`);
  }
  return parts.join("\n").slice(0, 160000);
}

export function createLiveEngineeringOperations(options: LiveEngineeringOperationsOptions): Pick<EngineeringLoopOperations, "implement" | "review"> {
  const root = fs.realpathSync(options.workspace);
  const scopeLimit = options.maxScopeFiles ?? 40;

  const implement: EngineeringLoopOperations["implement"] = async (_goal, finding) => {
    const candidates = candidateFilesForFinding(root, finding, { maxFiles: scopeLimit });
    if (!candidates.length) {
      return { changedFiles: [], error: `scope inference found no candidate file for finding ${finding.id} (${finding.area}); aborting bounded patch` };
    }
    // Scope = inferred candidates; the coder sees exactly these files and the
    // required checks are selected by the host, never by the model.
    const checks = engineeringChecksFor(root, candidates);
    const outcome: ImplementOutcome = { changedFiles: [], verification: { checksTotal: checks.length, checksPassed: 0, repairs: 0, diff: "" } };
    try {
      const proposal = await new ProposalRunner((prompt) => options.worker.ask("coder", prompt)).run(
        root,
        `${options.goal.objective}\n\nFINDING ${finding.id} [${finding.area}] ${finding.description}\n${finding.evidence ? "EVIDENCE:\n" + finding.evidence.slice(0, 4000) : ""}`,
        candidates,
        checks
      );
      outcome.changedFiles = proposal.changes.map((change) => change.path);
      outcome.verification = {
        checksTotal: proposal.checks.length,
        checksPassed: proposal.checks.filter((item) => item.passed).length,
        repairs: proposal.repairs,
        diff: proposal.diff.slice(0, 8000)
      };
      if (proposal.status !== "PASS") {
        const failed = proposal.checks.filter((item) => !item.passed).map((item) => `${JSON.stringify(item.check)}: ${item.output.slice(0, 400)}`).join(" | ");
        return { changedFiles: outcome.changedFiles, error: `proposal did not pass host verification: ${failed.slice(0, 2000)}`, verification: outcome.verification };
      }
      return outcome;
    } catch (error) {
      return { changedFiles: outcome.changedFiles, error: `live coder failed: ${String(error).slice(0, 2000)}`, verification: outcome.verification };
    }
  };

  const review: EngineeringLoopOperations["review"] = async (_goal, finding, changedFiles, evidence) => {
    const diff = await diffEvidence(root, changedFiles);
    const filesContext = changedFileContext(root, changedFiles);
    const prompt = [
      "You are an INDEPENDENT engineering reviewer. You do not share the coder's context and must not assume the coder's reasoning.",
      "Original finding:",
      JSON.stringify({ id: finding.id, area: finding.area, description: finding.description, evidence: (finding.evidence ?? "").slice(0, 2000) }),
      "Acceptance evidence after the change:",
      JSON.stringify({ build: evidence.buildPassed ? "PASS" : "FAIL", tests: evidence.testsPassed ? "PASS" : "FAIL" }),
      "Changed files and their current content:",
      filesContext.slice(0, 80000),
      "Diff (if a git workspace):",
      diff.slice(0, 60000),
      "Review ONLY the listed change against the original finding and the acceptance evidence.",
      "Look for: correctness, error handling, security, races, state lifecycle, test weakening, scope violations.",
      'Respond with strict JSON only: {"findings":[{"severity":"CRITICAL|HIGH|MEDIUM|LOW|OPTIONAL","summary":"..."}]}. Empty findings = {"findings":[]}.'
    ].join("\n\n");
    let raw = "";
    try {
      raw = await options.worker.ask("reviewer", prompt);
    } catch (error) {
      raw = `[review worker failed: ${String(error).slice(0, 500)}]`;
    }
    const parsed = parseReviewerFindings(raw);
    return { findings: parsed.findings, raw: parsed.raw };
  };

  return { implement, review };
}

/** Validation-only helper reused by callers that must fail fast on a bad workspace. */
export function assertEngineeringWorkspace(workspace: string): string {
  const root = fs.realpathSync(workspace);
  if (!fs.statSync(root).isDirectory()) throw new Error("Engineering workspace is not a directory");
  return root;
}
