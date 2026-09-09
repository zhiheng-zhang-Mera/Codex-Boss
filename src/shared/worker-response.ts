/**
 * R43 Phase H (R-801): worker response contract (pure).
 *
 * A worker (DS-Hns, web AI, future codex worker) may only report
 * MODEL_DONE / PARTIAL / FAILED / BLOCKED (or raise a question). There is NO
 * worker status called GLOBAL_COMPLETE: text that claims global completion is
 * advisory content at best — only Boss acceptance gates (verification plan
 * PASS, council/evidence gates, real audit/build/test convergence) may end a
 * task. This module classifies worker text so callers can refuse to treat a
 * self-claim of completion as completion.
 */

export type WorkerVerdict = "MODEL_DONE" | "PARTIAL" | "FAILED" | "BLOCKED" | "QUESTION";

const GLOBAL_COMPLETE_CLAIMS = [
  "global_complete", "global complete", "everything is done", "the goal is fully complete",
  "全部完成", "整体完成", "所有任务已完成", "宣告完成", "无需再做任何工作"
];

const BLOCKED_CLAIMS = ["cannot proceed without", "blocked by", "unavailable and i cannot", "缺少", "被阻塞", "无法继续，因为", "requires external"];
const QUESTION_CLAIMS = ["? 是否", "please confirm", "请确认", "should i", "要不要", "是否继续"];

/** Classifies worker text; a global-completion self-claim is NEVER a terminal
 *  status — it downgrades to MODEL_DONE (advisory) and the caller must still
 *  pass its own acceptance gates. */
export function classifyWorkerVerdict(text: string): WorkerVerdict {
  const lower = text.toLowerCase();
  if (BLOCKED_CLAIMS.some((token) => lower.includes(token))) return "BLOCKED";
  if (QUESTION_CLAIMS.some((token) => lower.includes(token))) return "QUESTION";
  if (GLOBAL_COMPLETE_CLAIMS.some((token) => lower.includes(token))) return "MODEL_DONE"; // advisory only
  return "MODEL_DONE";
}

/** True when worker text claims completion — must never shortcut acceptance. */
export function workerClaimsGlobalCompletion(text: string): boolean {
  const lower = text.toLowerCase();
  return GLOBAL_COMPLETE_CLAIMS.some((token) => lower.includes(token));
}
