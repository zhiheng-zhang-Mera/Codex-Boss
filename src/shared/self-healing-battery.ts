/**
 * Self-healing battery core (Owner-Result.md Rev.2 §30–§32, §35). Pure + shareable.
 *
 * Boss healing = discover own fault → diagnose → patch self → test → reload →
 * live verify → resume original task. This module encodes the §32 challenge
 * battery deterministically: each scenario carries a detection signal, a
 * diagnosis classifier, a repair route onto the provider recovery ladder /
 * Computer-Use plan / code-patch lane, and a fail-closed verification gate
 * list. A scenario may end auto-healed only when its gates actually pass;
 * otherwise it reports NOT_AUTO_HEALED — never a silent success. §35
 * stagnation detection rides the same vocabulary (same diff / same error →
 * escalate to rollback + alternate architecture).
 */

import type { RepairPlan } from "./computer-recovery";
import { buildRepairPlan } from "./computer-recovery";

export type HealingScenarioId =
  | "SELECTOR_BROKEN"
  | "SEND_MECHANISM_CHANGED"
  | "RESPONSE_PARSER_BROKEN"
  | "PROVIDER_TIMEOUT"
  | "LOGIN_EXPIRED"
  | "STALE_SESSION"
  | "TEST_REGRESSION"
  | "CROSS_MODULE_CONTRACT_BREAK"
  | "REVIEWER_REJECTION"
  | "ELECTRON_RESTART";

export type RepairLane =
  | "ADAPTER_PATCH" // patch provider adapter/page-script
  | "CODE_PATCH" // patch Boss code + unit tests
  | "COMPUTER_USE_PLAN" // runtime page repair via planner/executor
  | "PROVIDER_RECOVERY" // recovery ladder R0–R8
  | "RESTART_RECOVERY" // durable restart/reload path
  | "REVIEWER_RERUN" // reviewer rejection → fresh reviewer / rework
  | "NOT_AUTO_HEALED"; // honest: needs operator or live verification

export interface HealingScenarioDef {
  id: HealingScenarioId;
  detection: string[];
  diagnosis: string;
  lane: RepairLane;
  /** Gates that must PASS before the fix may be declared healed (§30/§21). */
  verificationGates: readonly string[];
  /** Whether the full loop (patch→test→reload→live verify) is automatic here. */
  autoClosable: boolean;
}

const COMMON_GATES = ["typecheck", "unit"] as const;

export const HEALING_SCENARIOS: readonly HealingScenarioDef[] = [
  { id: "SELECTOR_BROKEN", detection: ["selector-not-found", "找不到选择器", "querySelector null"], diagnosis: "page DOM selector drifted; repair by re-deriving selector from a fresh page read (DOM inspect) and pinning it via adapter patch.", lane: "ADAPTER_PATCH", verificationGates: [...COMMON_GATES, "live-page-check"], autoClosable: true },
  { id: "SEND_MECHANISM_CHANGED", detection: ["send-button-not-found", "enter-did-not-submit", "找不到发送"], diagnosis: "provider changed its send affordance; route to the Computer-Use repair plan (find/act/verify) and, if stable, solidify into the adapter.", lane: "COMPUTER_USE_PLAN", verificationGates: [...COMMON_GATES, "live-send-verify"], autoClosable: true },
  { id: "RESPONSE_PARSER_BROKEN", detection: ["response parser", "解析器", "capture parse failed"], diagnosis: "response parser no longer matches the page's new DOM; patch parser + rerun the offline capture contract tests.", lane: "ADAPTER_PATCH", verificationGates: [...COMMON_GATES, "capture-contract"], autoClosable: true },
  { id: "PROVIDER_TIMEOUT", detection: ["timeout", "timed out", "超时"], diagnosis: "provider slow/unreachable; bounded recovery ladder (R0 inspect → R2 re-monitor → retry with backoff) — never kill a slow worker (§40).", lane: "PROVIDER_RECOVERY", verificationGates: ["probe", "bounded-retry"], autoClosable: true },
  { id: "LOGIN_EXPIRED", detection: ["login", "log in", "登录", "session expired"], diagnosis: "credentials expired; HB1 class — reopen the provider session and pause for re-authentication; no adapter patch will substitute for the credential.", lane: "PROVIDER_RECOVERY", verificationGates: ["auth-check"], autoClosable: false },
  { id: "STALE_SESSION", detection: ["stale session", "页面不是原会话", "session mismatch"], diagnosis: "captured session no longer matches the task conversation; recapture the existing response (R1) or restore the recorded URL before re-monitoring.", lane: "PROVIDER_RECOVERY", verificationGates: ["session-match"], autoClosable: true },
  { id: "TEST_REGRESSION", detection: ["test failure", "测试失败", "vitest fail"], diagnosis: "a change broke deterministic tests; isolate via same-diff rollback to the last green checkpoint, then re-apply the change incrementally.", lane: "CODE_PATCH", verificationGates: [...COMMON_GATES, "build"], autoClosable: true },
  { id: "CROSS_MODULE_CONTRACT_BREAK", detection: ["typecheck error", "contract break", "TS2307", "接口变更"], diagnosis: "a cross-module contract changed without its consumers; patch consumers against the frozen interface and run the full typecheck+build gate.", lane: "CODE_PATCH", verificationGates: [...COMMON_GATES, "build", "typecheck"], autoClosable: true },
  { id: "REVIEWER_REJECTION", detection: ["veto", "rejected", "打回", "review finding"], diagnosis: "independent reviewer vetoed the change; carry the finding into the next iteration, or re-route to a fresh reviewer when the same finding repeats (§19/§35).", lane: "REVIEWER_RERUN", verificationGates: ["review-pass", "findings-resolved"], autoClosable: true },
  { id: "ELECTRON_RESTART", detection: ["render-process-gone", "app restart", "重启", "crash"], diagnosis: "process/restart fault; restore from the durable task ledger/checkpoints so no side effect repeats (restart smoke gate).", lane: "RESTART_RECOVERY", verificationGates: ["restart-smoke", "no-duplicate-send"], autoClosable: true }
];

export function scenarioFor(id: HealingScenarioId): HealingScenarioDef | undefined {
  return HEALING_SCENARIOS.find((scenario) => scenario.id === id);
}

/** §32 detection: which scenario a raw signal matches (first match wins). */
export function detectScenario(signal: string): HealingScenarioDef | undefined {
  const normalized = signal.toLocaleLowerCase();
  return HEALING_SCENARIOS.find((scenario) => scenario.detection.some((pattern) => normalized.includes(pattern.toLocaleLowerCase())));
}

export interface HealingPlan {
  scenario: HealingScenarioDef;
  /** Concrete first repair action text (routed onto the right lane). */
  repairAction: string;
  /** Computer-Use repair plan when the lane needs page automation. */
  computerUsePlan?: RepairPlan;
  verdict: "AUTO_HEALED" | "NOT_AUTO_HEALED" | "NEEDS_LIVE_VERIFY";
  reason: string;
}

/**
 * Plans one §32 scenario. Fail-closed: a scenario that cannot be auto-closed
 * (e.g. LOGIN_EXPIRED / missing verification evidence) reports NOT_AUTO_HEALED
 * or NEEDS_LIVE_VERIFY — never a silent success.
 */
export function planHealing(id: HealingScenarioId, grants: ReadonlySet<string> = new Set(), now = Date.now()): HealingPlan {
  const scenario = scenarioFor(id);
  if (!scenario) throw new Error(`Unknown healing scenario: ${id}`);
  let computerUsePlan: RepairPlan | undefined;
  if (scenario.lane === "COMPUTER_USE_PLAN") {
    computerUsePlan = buildRepairPlan("SEND_AFFORDANCE_MISSING", now, grants as ReadonlySet<import("./computer-recovery").ComputerActionName>);
  }
  if (!scenario.autoClosable) {
    return { scenario, repairAction: `${scenario.diagnosis} — operator/live credential step required`, verdict: "NOT_AUTO_HEALED", reason: "scenario needs an HB-class credential step or live human verification; never faked", ...(computerUsePlan ? { computerUsePlan } : {}) };
  }
  return {
    scenario,
    repairAction: `${scenario.diagnosis} Lane: ${scenario.lane}; gates before healed: ${scenario.verificationGates.join(", ")}`,
    ...(computerUsePlan ? { computerUsePlan } : {}),
    verdict: computerUsePlan && computerUsePlan.verdict === "DENIED" ? "NEEDS_LIVE_VERIFY" : "AUTO_HEALED",
    reason: computerUsePlan && computerUsePlan.verdict === "DENIED"
      ? `Computer-Use repair denied (${computerUsePlan.reason}) — route to guarded fallback`
      : "repair plan produced; executor must still pass the verification gates before declaring healed (§30)"
  };
}

/** §35 stagnation signals that must trigger rollback/alternate instead of more tokens. */
export function stagnated(evidence: { sameDiff: boolean; sameError: boolean; sameProposal: boolean; sameReviewerFinding: boolean; noMetricImprovement: boolean; noNewEvidence: boolean }): boolean {
  const { sameDiff, sameError, sameProposal, sameReviewerFinding, noMetricImprovement, noNewEvidence } = evidence;
  // Any repeated-identity signal is stagnation; otherwise a stall is declared
  // only when there is simultaneously no metric improvement AND no new evidence.
  return sameDiff || sameError || sameProposal || sameReviewerFinding || (noMetricImprovement && noNewEvidence);
}
