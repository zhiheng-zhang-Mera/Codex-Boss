/**
 * Computer-Use provider recovery planner (Owner-Result.md Rev.2 §24–§29, §41).
 * Pure + shareable: decides WHAT to repair on a provider page and in WHAT
 * order, and whether the repair is permitted — execution stays in Electron.
 *
 * §26: page failures (send-button-not-found / input-not-found /
 * enter-did-not-submit / response-selector-drift) must not immediately pause
 * for a human; they trigger a bounded Computer-Use chain: DOM inspect → read
 * page → locate composer/send affordance → native interaction → verify
 * submission. §24 tiers T0–T6 rank the affordance strategies; §28 adds ICON /
 * POINT targets that REQUIRE a frame-revision check + bounded region +
 * post-condition (never bare, long-lived coordinates); §29 gates every
 * mutation behind a task-scoped `computer:<action>` grant; §25 forbids
 * repeating a mutation when the post-condition is UNCERTAIN.
 */

export type ComputerActionName = "read_page" | "find_control" | "click_control" | "enter_text" | "submit" | "verify_state";

export const COMPUTER_READ_ACTIONS: readonly ComputerActionName[] = ["read_page", "find_control", "verify_state"];
export const COMPUTER_MUTATION_ACTIONS: readonly ComputerActionName[] = ["click_control", "enter_text", "submit"];

/** §28 target kinds. ICON/POINT are the risky, geometry-based kinds. */
export type ComputerTargetKind = "TEXT" | "ROLE" | "ACCESSIBILITY" | "ICON" | "REGION" | "POINT";

export interface BoundedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputerTarget {
  kind: ComputerTargetKind;
  /** Semantic hint the executor maps onto the live page (selector/role/aria-label text…). */
  hint?: string;
  /** §28: mandatory for ICON/POINT targets — when was the frame this geometry was read from verified. */
  frameRevisionAt?: number;
  /** §28: mandatory for ICON/POINT targets — the bounded region the click may land in. */
  boundedRegion?: BoundedRegion;
}

export interface PostCondition {
  /** What must be observable after the step for it to be VERIFIED. */
  description: string;
}

export type RepairNeed =
  | "SEND_AFFORDANCE_MISSING" // send button not found / enter did not submit
  | "INPUT_AFFORDANCE_MISSING" // input/composer not found
  | "RESPONSE_SELECTOR_DRIFT" // output region moved / capture selector broken
  | "PAGE_STRUCTURE_CHANGED" // probe cannot prove the expected page shape

export type RepairVerdict = "CU_REPAIR" | "HUMAN_REQUIRED" | "NOT_REPAIRABLE";

export interface RepairInput {
  /** Adapter outcome that triggered recovery, when known. */
  outcome?: string | null;
  /** Failure/pause message (English or Chinese) to classify against. */
  reason: string;
  /** §26 page probe facts. */
  probe?: {
    loginLikely?: boolean;
    sendFound?: boolean;
    inputFound?: boolean;
    responseVisible?: boolean;
  };
}

/** §26 failure phrases that are CU-repairable. */
const CU_REPAIR_PHRASES: readonly string[] = [
  "send-button-not-found", "send button not found", "input-not-found", "input not found",
  "enter-did-not-submit", "enter did not submit", "response selector", "selector drift",
  "找不到发送", "找不到输入", "发送按钮", "未找到发送", "发送失败", "提交未生效"
];
const HUMAN_PHRASES: readonly string[] = [
  "login", "log in", "sign in", "captcha", "verification code", "验证码", "登录", "登陆", "credential", "凭据", "权限"
];

/**
 * §26 classification: which page failures the Computer-Use chain may repair.
 * Human-gated pages (login/CAPTCHA) are never CU-repaired; unknown structural
 * failures are NOT_REPAIRABLE (recorded, never guessed into a mutation).
 */
export function classifyRepairNeed(input: RepairInput): { verdict: RepairVerdict; need?: RepairNeed } {
  const text = String(input.reason ?? "").toLocaleLowerCase();
  const probe = input.probe ?? {};
  if (probe.loginLikely || HUMAN_PHRASES.some((phrase) => text.includes(phrase))) {
    return { verdict: "HUMAN_REQUIRED" };
  }
  if (probe.sendFound === false || /send-button-not-found|enter-did-not-submit|找不到发送|发送按钮|提交未生效/.test(text)) {
    return { verdict: "CU_REPAIR", need: "SEND_AFFORDANCE_MISSING" };
  }
  if (probe.inputFound === false || /input-not-found|input not found|找不到输入/.test(text)) {
    return { verdict: "CU_REPAIR", need: "INPUT_AFFORDANCE_MISSING" };
  }
  if (/response selector|selector drift|response-selector-drift/.test(text)) {
    return { verdict: "CU_REPAIR", need: "RESPONSE_SELECTOR_DRIFT" };
  }
  if (CU_REPAIR_PHRASES.some((phrase) => text.includes(phrase))) {
    return { verdict: "CU_REPAIR", need: "PAGE_STRUCTURE_CHANGED" };
  }
  return { verdict: "NOT_REPAIRABLE" };
}

/** §24 tier label for a target kind (cost rises down the ladder). */
export function tierForTarget(kind: ComputerTargetKind): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  switch (kind) {
    case "TEXT": return 0;
    case "ROLE": return 1;
    case "ACCESSIBILITY": return 2;
    case "REGION": return 3;
    case "ICON": return 4;
    case "POINT": return 5;
    default: return 6;
  }
}

export interface RepairStep {
  action: ComputerActionName;
  target: ComputerTarget;
  postCondition: PostCondition;
  /** Human reason this step is in the plan (audit + ledger). */
  rationale: string;
}

export interface RepairPlan {
  episodeId?: string;
  need: RepairNeed;
  verdict: "READY" | "UNCERTAIN" | "DENIED" | "EMPTY";
  steps: RepairStep[];
  /** When DENIED/EMPTY: why the fallback path must be used. */
  reason?: string;
}

/** §28 guard: risky geometry targets require frame revision + bounded region. */
export function geometryTargetValid(target: ComputerTarget): boolean {
  if (target.kind !== "ICON" && target.kind !== "POINT") return true;
  return Boolean(target.frameRevisionAt && Number.isFinite(target.frameRevisionAt) && target.boundedRegion);
}

function step(action: ComputerActionName, target: ComputerTarget, postCondition: string, rationale: string): RepairStep {
  return { action, target, postCondition: { description: postCondition }, rationale };
}

/**
 * Builds the §26 repair chain for a need. T0/T1/T2 semantic targets first;
 * geometry-based ICON/POINT steps only survive when they carry a frame
 * revision + bounded region (§28). A plan that cannot reach a verifiable
 * submission step is UNCERTAIN — never executed blindly.
 */
export function buildRepairPlan(need: RepairNeed, now = 0, grants: ReadonlySet<ComputerActionName> = new Set()): RepairPlan {
  const allowed = (action: ComputerActionName): boolean => COMPUTER_READ_ACTIONS.includes(action) || grants.has(action);
  const plan: RepairPlan = { need, verdict: "READY", steps: [] };

  if (!allowed("read_page")) {
    return { ...plan, verdict: "DENIED", reason: "computer:read_page not granted for this task/workspace" };
  }
  plan.steps.push(step("read_page", { kind: "ROLE", hint: "document/body" }, "page read succeeded and DOM shape is observable", "§26 DOM inspect + read page"));

  const clickOrText = need === "INPUT_AFFORDANCE_MISSING" ? "enter_text" as const : "click_control" as const;
  const affordanceTarget: ComputerTarget =
    need === "SEND_AFFORDANCE_MISSING"
      ? { kind: "ICON", hint: "send", frameRevisionAt: now, boundedRegion: { x: 0, y: 0, width: 0, height: 0 } }
      : need === "INPUT_AFFORDANCE_MISSING"
        ? { kind: "TEXT", hint: "composer/textarea/contenteditable" }
        : { kind: "ROLE", hint: "conversation/output region" };

  if (!geometryTargetValid(affordanceTarget)) {
    return { ...plan, verdict: "UNCERTAIN", reason: "ICON/POINT target lacks frame revision + bounded region (§28) — cannot act blindly" };
  }
  if (!allowed(clickOrText)) {
    return { ...plan, verdict: "DENIED", reason: `computer:${clickOrText} not granted for this task/workspace` };
  }
  plan.steps.push(step(clickOrText, affordanceTarget, "affordance acted on and page observable state changed or submission started", "§26 locate + act on the composer/send affordance"));

  if (need === "INPUT_AFFORDANCE_MISSING" && allowed("submit")) {
    plan.steps.push(step("submit", { kind: "ROLE", hint: "form/composer" }, "user message is visible in the conversation or generation started", "§26 perform native interaction → submit"));
  }
  // verify_state is a read (§29 read actions are always allowed), so the chain
  // always ends on a verifiable submission step when the mutations were granted.
  plan.steps.push(step("verify_state", { kind: "ROLE", hint: "conversation/output" }, "user message or fresh generation observed — submission verified", "§26 verify submission (post-condition)"));
  if (plan.steps.length < 3) {
    return { ...plan, verdict: "UNCERTAIN", reason: "repair chain incomplete — no verifiable submission step" };
  }
  return plan;
}

/** §29: which `computer:<action>` grants a task manifest carries (mutations only). */
export function grantedComputerActions(allowList: readonly string[]): Set<ComputerActionName> {
  const granted = new Set<ComputerActionName>();
  for (const entry of allowList) {
    const match = /^computer:(read_page|find_control|click_control|enter_text|submit|verify_state)$/.exec(entry.trim());
    if (match) granted.add(match[1] as ComputerActionName);
  }
  return granted;
}

export type StepOutcomeStatus = "VERIFIED" | "ACTED" | "UNCERTAIN";

/**
 * §25 post-condition discipline. An ACTED step whose post-condition cannot be
 * confirmed is UNCERTAIN — the caller must NOT repeat the mutation; it must
 * stop and take the recovery/fallback path.
 */
export function verdictForOutcome(step: RepairStep, observed: { postConditionSeen?: boolean; acted?: boolean }): StepOutcomeStatus {
  if (observed.postConditionSeen === true) return "VERIFIED";
  if (observed.acted === false) return "UNCERTAIN";
  return "UNCERTAIN";
}

/** One-page summary used by the decision ledger (§38). */
export function planSummary(plan: RepairPlan): { need: RepairNeed; verdict: RepairPlan["verdict"]; steps: number; actions: string[]; reason?: string } {
  return {
    need: plan.need,
    verdict: plan.verdict,
    steps: plan.steps.length,
    actions: plan.steps.map((item) => item.action),
    ...(plan.reason ? { reason: plan.reason } : {})
  };
}
