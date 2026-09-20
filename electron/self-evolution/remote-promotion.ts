import type { EvolutionHostOperations } from "./host-operations";
import type { EmergencyControl } from "../emergency-control/emergency-control";
import type { PromotionController } from "../promotion-gate/promotion-controller";
import type { PromotionState } from "../../src/shared/root-authority/promotion-state";

/**
 * The remote half of a promotion — the part that talks to GitHub — extracted from the Self-Evolution
 * coordinator so that it is one implementation with one caller and can be driven by live acceptance as well
 * as by an autonomous run.
 *
 * The sequence is fixed by the exact-SHA contract: push the Candidate branch, open the pull request, read
 * EVERY required check for the candidate SHA, then let `PromotionController.evaluate` decide. `evaluate` is
 * the only thing that may move the run, and this module never merges on its own: `beginPromotion` and the
 * merge happen only after `evaluate` returned `PROMOTABLE`, so a change set that touches a Root Surface stops
 * at `WAITING_FOR_ROOT_OWNER` here — with the branch pushed and the pull request open — and no later step in
 * this function runs.
 *
 * ## Why the required checks are waited for (and why that is not a weakening)
 *
 * CI cannot have finished one second after a pull request is opened, so reading the checks exactly once at
 * that moment measures the *absence* of evidence rather than its content: every real promotion would be
 * decided `required-checks-not-passed`, and the Root-Surface ceiling would be unreachable behind a red gate.
 * The wait below is bounded, and it only ever waits for a check that has not reported yet. A check that has
 * reported and is not `success` — or that reports a different SHA — stops the wait immediately, so the delay
 * cannot outlive a known failure, and an expired window is reported as pending evidence, never as a pass.
 */

/**
 * The outcome vocabulary a Self-Evolution run can end in. Declared here because this module produces most of
 * these values; the coordinator re-exports its own public report type against the same union.
 */
export type SelfEvolutionOutcome =
  | "NOT_SELF"
  | "EMERGENCY_STOPPED"
  | "BLOCKED_EXTERNAL"
  | "WAITING_FOR_ROOT_OWNER"
  | "PROMOTED"
  | "REJECTED"
  | "ROLLED_BACK"
  | "CANDIDATE_FAILED";

/** The shape of the `promote.readCheck` host answer this module needs. */
interface ReadCheckAnswer {
  status: string;
  value?: { conclusion: string | null; pending?: string[]; missing?: string[] };
  reason?: string;
  requiredExternalAction?: string;
  /** Required checks that have not reached a terminal conclusion yet. */
  pending?: string[];
  /** Required checks that have not reported at all yet. */
  missing?: string[];
  /** Required checks that completed with a conclusion other than `success`. */
  notSuccessful?: string[];
  /** Required checks whose newest run belongs to a different SHA. */
  foreignSha?: string[];
}

interface RemotePromotionOptions {
  /** How long to wait for the required checks to report. Bounded; defaults to 30 minutes. */
  ciWaitMs?: number;
  /** Poll interval while waiting. Defaults to 15 seconds. */
  ciPollMs?: number;
  /** Injectable clock, so the wait is testable without sleeping. */
  now?: () => number;
  /** Injectable sleep, so the wait is testable without sleeping. */
  sleep?: (ms: number) => Promise<void>;
}

interface RemotePromotionInput {
  host: EvolutionHostOperations;
  promotion: PromotionController;
  emergency: EmergencyControl;
  candidateHeadSha: string;
  /** The candidate branch that is pushed. Never the protected base branch. */
  branch: string;
  /** The run this promotion belongs to, for the pull request title. */
  request: { runId?: string; objective: string };
  /** The authoritative change set read from git, used for the protected-surface assessment. */
  changedFiles: readonly string[];
  /** Whether the independent review left no high finding for the engineering loop to reflow. */
  reviewerClean: boolean;
  /** Set when the host already knows the credential is missing; nothing is pushed. */
  blockedReason?: string;
}

interface RemotePromotionResult {
  outcome: SelfEvolutionOutcome;
  blockedExternal?: string;
}

const DEFAULT_CI_WAIT_MS = 30 * 60_000;
const DEFAULT_CI_POLL_MS = 15_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True while the required checks may still change their mind: something has not reported yet, and nothing has
 * reported a terminal failure. A completed `failure`, or a run bound to another SHA, is not pending.
 */
export function requiredChecksArePending(answer: ReadCheckAnswer): boolean {
  if (answer.status === "OK") return false;
  const pending = (answer.pending?.length ?? 0) + (answer.missing?.length ?? 0);
  if (pending === 0) return false;
  return (answer.notSuccessful?.length ?? 0) === 0 && (answer.foreignSha?.length ?? 0) === 0;
}

/**
 * Pushes, opens the pull request, reads every required check for the candidate SHA, and lets the promotion
 * controller decide. Returns the outcome; the caller persists it.
 */
export async function promoteCandidateOverGitHub(
  input: RemotePromotionInput,
  options: RemotePromotionOptions = {}
): Promise<RemotePromotionResult> {
  const { host, promotion, emergency, candidateHeadSha, branch, changedFiles, reviewerClean } = input;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const ciWaitMs = options.ciWaitMs ?? DEFAULT_CI_WAIT_MS;
  const ciPollMs = options.ciPollMs ?? DEFAULT_CI_POLL_MS;
  const title = `Autonomous evolution ${input.request.runId ?? ""}`.trim();

  // No dedicated Boss identity: the run parks in BLOCKED_EXTERNAL with the
  // exact external action the Owner must take. Nothing is pushed.
  if (input.blockedReason) {
    const parked = await promotion.evaluate({
      binding: { candidateHeadSha, ciValidatedSha: null, prHeadSha: null, promotionSha: candidateHeadSha },
      requiredChecksPassed: false,
      branchUpToDate: true,
      reviewerClean,
      changedFiles
    });
    return { outcome: mapPromotionOutcome(parked.state), blockedExternal: input.blockedReason };
  }

  // before PR creation
  emergency.assertCandidateCreationAllowed();

  const push = await host.execute<{ status: string; reason?: string; requiredExternalAction?: string; value?: { sha: string } }>({
    kind: "promote.pushBranch",
    branch,
    sha: candidateHeadSha
  });
  if (push.status !== "OK") {
    const reason = push.requiredExternalAction ?? push.reason ?? "push failed";
    promotion.setExternalBlocker(reason);
    const parked = await promotion.evaluate({
      binding: { candidateHeadSha, ciValidatedSha: null, prHeadSha: null, promotionSha: candidateHeadSha },
      requiredChecksPassed: false,
      branchUpToDate: true,
      reviewerClean,
      changedFiles
    });
    return { outcome: mapPromotionOutcome(parked.state), blockedExternal: reason };
  }

  const opened = await host.execute<{ status: string; value?: { number: number; headSha: string }; reason?: string; requiredExternalAction?: string }>({
    kind: "promote.openPullRequest",
    head: branch,
    title,
    body: `Owner goal: ${input.request.objective}`
  });
  if (opened.status !== "OK" || !opened.value) {
    const reason = opened.requiredExternalAction ?? opened.reason ?? "pull request creation failed";
    promotion.setExternalBlocker(reason);
    const parked = await promotion.evaluate({
      binding: { candidateHeadSha, ciValidatedSha: null, prHeadSha: null, promotionSha: candidateHeadSha },
      requiredChecksPassed: false,
      branchUpToDate: true,
      reviewerClean,
      changedFiles
    });
    return { outcome: mapPromotionOutcome(parked.state), blockedExternal: reason };
  }
  promotion.recordPullRequest(opened.value.number, opened.value.headSha);

  const readCheck = () => host.execute<ReadCheckAnswer>({ kind: "promote.readCheck", sha: opened.value!.headSha });
  const deadline = now() + ciWaitMs;
  let check = await readCheck();
  while (requiredChecksArePending(check) && now() < deadline) {
    await sleep(ciPollMs);
    check = await readCheck();
  }
  const checked = check.status === "OK" && check.value?.conclusion === "success";
  // The exact-SHA gate has the last word: a stale PASS may not promote.
  const evaluated = await promotion.evaluate({
    binding: { candidateHeadSha, ciValidatedSha: checked ? opened.value.headSha : null, prHeadSha: opened.value.headSha, promotionSha: candidateHeadSha },
    requiredChecksPassed: checked,
    branchUpToDate: true,
    reviewerClean,
    changedFiles
  });
  if (evaluated.state !== "PROMOTABLE") return { outcome: mapPromotionOutcome(evaluated.state) };

  // before beginPromotion
  emergency.assertPromotionAllowed();
  promotion.beginPromotion();
  // immediately before merge
  emergency.assertPromotionAllowed();
  const head = await host.execute<{ status: string; value?: { headSha: string }; reason?: string }>({ kind: "promote.readPullRequest", prNumber: opened.value.number });
  if (head.status !== "OK" || head.value?.headSha !== candidateHeadSha) {
    promotion.setExternalBlocker("PR head SHA changed after validation; the previous CI PASS is void");
    const stale = await promotion.evaluate({
      binding: { candidateHeadSha, ciValidatedSha: null, prHeadSha: head.value?.headSha ?? null, promotionSha: candidateHeadSha },
      requiredChecksPassed: false,
      branchUpToDate: true,
      reviewerClean,
      changedFiles
    });
    return { outcome: mapPromotionOutcome(stale.state) };
  }
  const merged = await host.execute<{ status: string; value?: { sha: string }; reason?: string; requiredExternalAction?: string }>({
    kind: "promote.merge",
    prNumber: opened.value.number,
    sha: candidateHeadSha,
    title
  });
  if (merged.status !== "OK") {
    const reason = merged.requiredExternalAction ?? merged.reason ?? "merge failed";
    promotion.markBlockedExternal(reason);
    return { outcome: "BLOCKED_EXTERNAL", blockedExternal: reason };
  }
  promotion.completePromotion(candidateHeadSha);
  return { outcome: "PROMOTED" };
}

function mapPromotionOutcome(state: PromotionState): SelfEvolutionOutcome {
  switch (state) {
    case "PROMOTED":
      return "PROMOTED";
    case "WAITING_FOR_ROOT_OWNER":
      return "WAITING_FOR_ROOT_OWNER";
    case "BLOCKED_EXTERNAL":
      return "BLOCKED_EXTERNAL";
    case "ROLLED_BACK":
      return "ROLLED_BACK";
    default:
      return "REJECTED";
  }
}
