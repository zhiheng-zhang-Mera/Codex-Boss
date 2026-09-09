/**
 * Owner-Result contract (Update-Plan/Owner-Result.md Rev.2 §0–§6, §18–§19, §37–§38).
 * Pure + shareable: no fs/electron/DOM.
 *
 * Owner 提出结果要求、硬约束与验收标准；系统承担一切普通工程/研究决策并持续施工。
 * 本模块是 Boss 侧的 Owner-Result 决策层：运行模式（ASSISTED / AUTONOMOUS /
 * OWNER_RESULT）、HB1–HB4 硬阻塞词表、worker 问题分类（QUESTION_CANDIDATE →
 * DECIDABLE / HARD_BLOCKER）、可决策问题的确定性自动决策与 re-steer、以及 §19
 * 方向性停滞的逐次升级梯。owner 事后可审计决策台账（见 decision-ledger.ts）。
 */

export type RunMode = "ASSISTED" | "AUTONOMOUS" | "OWNER_RESULT";

export const RUN_MODES: readonly RunMode[] = ["ASSISTED", "AUTONOMOUS", "OWNER_RESULT"];

/** Task kinds the default mode mapping is defined for (§3: 默认高级任务 OWNER_RESULT). */
export type RunTaskKind = "chat" | "work" | "research" | "engineering" | "other";

export function isRunMode(value: unknown): value is RunMode {
  return value === "ASSISTED" || value === "AUTONOMOUS" || value === "OWNER_RESULT";
}

/**
 * Default mode per task kind (§3). Interactive chat stays ASSISTED (Owner in the
 * loop by design); every advanced/autonomous task defaults to OWNER_RESULT.
 */
export function defaultRunModeForTask(kind: RunTaskKind): RunMode {
  return kind === "chat" ? "ASSISTED" : "OWNER_RESULT";
}

/** Effective mode: explicit runMode wins; otherwise the kind default applies. */
export function effectiveRunMode(input: { runMode?: RunMode; kind: RunTaskKind }): RunMode {
  return input.runMode ?? defaultRunModeForTask(input.kind);
}

/** Maps the legacy app/mode vocabulary onto the owner-result task-kind axis. */
export function runTaskKindFor(appMode: string | undefined, mode: string | undefined): RunTaskKind {
  if (appMode === "work" || mode === "council") return "work";
  return "chat";
}

/** User decision checkpoints granted before a task may end. */
export type CheckpointBudget = "UNLIMITED" | 0 | 1 | 3;

export interface RunModeContract {
  mode: RunMode;
  /** §3: OWNER_RESULT ⇒ checkpointBudget = 0 (no routine user checkpoints). */
  checkpointBudget: CheckpointBudget;
  /** Only HARD_BLOCKER (HB1–HB4) may surface to the owner in this mode. */
  hardBlockerOnly: boolean;
  /** §19: direction stalls auto-escalate (never pause for a direction pick). */
  autoEscalateDirection: boolean;
}

export function contractForMode(mode: RunMode): RunModeContract {
  switch (mode) {
    case "OWNER_RESULT":
      return { mode, checkpointBudget: 0, hardBlockerOnly: true, autoEscalateDirection: true };
    case "AUTONOMOUS":
      // Autonomous still allows a tiny checkpoint budget for genuinely costly
      // side effects, but never routine direction questions.
      return { mode, checkpointBudget: 1, hardBlockerOnly: false, autoEscalateDirection: true };
    case "ASSISTED":
      return { mode, checkpointBudget: "UNLIMITED", hardBlockerOnly: false, autoEscalateDirection: false };
  }
}

/** §5: the only owner-surfacing categories — HB1–HB4. */
export type HardBlockerKind =
  | "HB1_PERMISSIONS_OR_CREDENTIALS"
  | "HB2_IRREVERSIBLE_EXTERNAL_ACTION"
  | "HB3_GOAL_CONTRADICTION"
  | "HB4_REQUIRED_EXTERNAL_RESOURCE_MISSING";

export interface HardBlockerDefinition {
  kind: HardBlockerKind;
  label: string;
  /** CN + EN signal phrases the classifier matches (case-insensitive, substring). */
  signals: readonly string[];
}

export const HARD_BLOCKERS: readonly HardBlockerDefinition[] = [
  {
    kind: "HB1_PERMISSIONS_OR_CREDENTIALS",
    label: "缺少不可自行取得的权限/凭据",
    signals: [
      "login", "log in", "sign in", "signin", "captcha", "api key", "api-key", "credential",
      "authentication", "authenticate", "authorization", "authorize", "permission", "permissions",
      "账号", "登录", "登陆", "验证码", "密钥", "凭据", "授权", "权限", "认证"
    ]
  },
  {
    kind: "HB2_IRREVERSIBLE_EXTERNAL_ACTION",
    label: "不可逆外部行为（付款/生产数据删除/公开发布等）",
    signals: [
      "pay", "payment", "charge", "purchase", "refund", "delete production", "drop table",
      "publish", "release publicly", "public release", "irreversible", "non-refundable",
      "付款", "支付", "扣费", "购买", "删除生产", "公开", "发布", "对外发布", "不可逆", "退款"
    ]
  },
  {
    kind: "HB3_GOAL_CONTRADICTION",
    label: "最终目标本身不可同时满足（且已证明无兼容解）",
    signals: [
      "cannot both", "contradict", "contradiction", "unsatisfiable", "mutually exclusive",
      "incompatible goals", "无法同时满足", "相互矛盾", "自相矛盾", "目标冲突", "逻辑冲突", "不可兼得"
    ]
  },
  {
    kind: "HB4_REQUIRED_EXTERNAL_RESOURCE_MISSING",
    label: "必需外部资源真实不存在",
    signals: [
      "resource does not exist", "no such resource", "service unavailable permanently",
      "nonexistent", "not available anywhere", "does not exist anywhere", "不存在该资源",
      "资源不存在", "外部资源不存在", "不存在", "找不到该依赖", "依赖不存在", "没有可用资源"
    ]
  }
];

export function isHardBlockerKind(value: unknown): value is HardBlockerKind {
  return typeof value === "string" && HARD_BLOCKERS.some((blocker) => blocker.kind === value);
}

export type QuestionClass = "DECIDABLE" | "HARD_BLOCKER";

/** Question candidates raised by workers (or detected in worker output), §18. */
export type QuestionKind =
  | "CONTINUATION" // 是否继续 / 是否重试 / should I proceed
  | "DIRECTION" // A/B 或开放方向选择
  | "TECHNICAL_CHOICE" // 实现/架构/方案选择
  | "RESEARCH_SCOPE" // 研究范围/假设调整
  | "AUTHORIZATION" // 权限/凭据/登录/CAPTCHA/付费资源
  | "EXTERNAL_ACTION" // 不可逆外部副作用
  | "GOAL_CONFLICT" // 目标自相矛盾
  | "RESOURCE_MISSING" // 必需外部资源缺失
  | "UNKNOWN";

export interface QuestionInterceptionInput {
  text: string;
  kind?: QuestionKind;
  /** Explicit option candidates when the question offers A/B-style choice. */
  options?: string[];
  /** Occurrence counter of the same stall topic (§19 escalation). */
  directionStallOccurrence?: number;
}

export interface HardBlockerHit {
  kind: HardBlockerKind;
  matched: string;
}

export interface AutoDecision {
  /** 选择结果（选项文本或“继续”）。 */
  chosen: string;
  action: "CONTINUE" | "PICK_OPTION" | "STRONG_STEER" | "ROUTE_TO_PLANNER";
  /** Re-steer instruction injected into the next worker turn. */
  steer: string;
  rationale: string;
  /** Stable policy id for the decision ledger. */
  policy: string;
}

export interface QuestionInterception {
  classification: QuestionClass;
  blocker?: HardBlockerHit;
  /** Present when DECIDABLE: the deterministic auto decision that replaces an owner question. */
  decision?: AutoDecision;
  /** §18: question remains a candidate — auto-decided, never shown as a blocker to the owner. */
  intercepted: boolean;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase();
}

function matchHardBlocker(text: string): HardBlockerHit | undefined {
  const normalized = normalize(text);
  for (const blocker of HARD_BLOCKERS) {
    for (const signal of blocker.signals) {
      if (normalized.includes(signal.toLocaleLowerCase())) return { kind: blocker.kind, matched: signal };
    }
  }
  return undefined;
}

const CONTINUATION_PATTERNS: readonly string[] = [
  "是否继续", "继续吗", "继续么", "要不要继续", "接着做", "继续执行", "please continue", "should i continue",
  "是否重试", "重试吗", "要不要重试", "retry", "should i retry", "再试一次", "要不要再来一次",
  "是否再次", "再来一遍", "继续？", "proceed"
];

const DIRECTION_PATTERNS: readonly string[] = [
  "请选择", "选择 a", "选择 b", "选 a", "选 b", "a 还是 b", "a or b", "which", "你希望", "您希望",
  "是否修改", "要不要修改", "选哪个", "prefer", "方案一", "方案二", "option 1", "option 2",
  "如何", "怎么办", "怎么处理", "方向", "该不该"
];

const STRONG_STEER_PATTERNS: readonly string[] = ["无法决定", "不知道怎么做", "没有头绪", "不确定方向", "我无法判断", "cannot decide", "unsure how to proceed"];

/** Deterministic question-kind hint used when the caller did not tag the kind. */
export function inferQuestionKind(text: string): QuestionKind {
  const normalized = normalize(text);
  const blocker = matchHardBlocker(text);
  if (blocker?.kind === "HB1_PERMISSIONS_OR_CREDENTIALS") return "AUTHORIZATION";
  if (blocker?.kind === "HB2_IRREVERSIBLE_EXTERNAL_ACTION") return "EXTERNAL_ACTION";
  if (blocker?.kind === "HB3_GOAL_CONTRADICTION") return "GOAL_CONFLICT";
  if (blocker?.kind === "HB4_REQUIRED_EXTERNAL_RESOURCE_MISSING") return "RESOURCE_MISSING";
  if (CONTINUATION_PATTERNS.some((pattern) => normalized.includes(pattern))) return "CONTINUATION";
  if (DIRECTION_PATTERNS.some((pattern) => normalized.includes(pattern))) return "DIRECTION";
  return "UNKNOWN";
}

/**
 * §18 classification. A question is a HARD_BLOCKER only when it hits an HB1–HB4
 * signal; everything else is DECIDABLE (auto-decided under OWNER_RESULT). The
 * explicit kind is honored when it pins a hard-blocker category; otherwise the
 * text signal wins.
 */
export function classifyQuestion(input: QuestionInterceptionInput): { classification: QuestionClass; blocker?: HardBlockerHit } {
  const blocker = matchHardBlocker(input.text) ?? (input.kind
    ? hardBlockerKindForQuestionKind(input.kind)
    : undefined);
  if (blocker) return { classification: "HARD_BLOCKER", blocker };
  return { classification: "DECIDABLE" };
}

function hardBlockerKindForQuestionKind(kind: QuestionKind): HardBlockerHit | undefined {
  switch (kind) {
    case "AUTHORIZATION":
      return { kind: "HB1_PERMISSIONS_OR_CREDENTIALS", matched: kind };
    case "EXTERNAL_ACTION":
      return { kind: "HB2_IRREVERSIBLE_EXTERNAL_ACTION", matched: kind };
    case "GOAL_CONFLICT":
      return { kind: "HB3_GOAL_CONTRADICTION", matched: kind };
    case "RESOURCE_MISSING":
      return { kind: "HB4_REQUIRED_EXTERNAL_RESOURCE_MISSING", matched: kind };
    default:
      return undefined;
  }
}

/** §19 direction-stall ladder: escalate autonomously, never ask the owner. */
export type DirectionStallStage = 1 | 2 | 3 | 4;
export interface DirectionStallAction {
  stage: DirectionStallStage;
  action: "AUTO_DECIDE" | "STRONG_STEER" | "INDEPENDENT_DECISION" | "FRESH_EPISODE";
  steer: string;
}

export function directionStallAction(occurrence: number): DirectionStallAction {
  const stage = Math.max(1, Math.min(4, Math.floor(occurrence) + 1)) as DirectionStallStage;
  switch (stage) {
    case 1:
      return { stage, action: "AUTO_DECIDE", steer: "自动决策并继续执行；把选择与理由写入决策台账。" };
    case 2:
      return { stage, action: "STRONG_STEER", steer: "方向再次停滞：注入强 steer，要求基于现有证据给出唯一执行方向，禁止再抛选项。" };
    case 3:
      return { stage, action: "INDEPENDENT_DECISION", steer: "方向第三次停滞：由独立 planner/reviewer 给出明确决策并 steer 执行者。" };
    default:
      return { stage, action: "FRESH_EPISODE", steer: "方向持续停滞：以全新 episode 重开任务，保留已固化 checkpoint，不找 Owner。" };
  }
}

// ---- Deterministic auto-decision policy (low-risk picks only) ----

const RISKY_TOKENS: readonly string[] = ["发布", "公开", "删除生产", "删除线上", "付款", "支付", "永久删除", "publish", "delete production", "drop", "irreversible", "不可逆", "对外"];
const SAFE_TOKENS: readonly string[] = ["回滚", "保守", "最稳", "最安全", "安全", "无风险", "保留", "继续", "保持", "rollback", "keep", "safe", "revert", "最小改动", "最小风险"];
const RECOMMENDED_TOKENS: readonly string[] = ["推荐", "建议", "最优", "recommend", "recommended", "best", "首选"];
const AMBIGUOUS_TOKENS: readonly string[] = ["无法决定", "都可以", "没把握", "都行", "不确定", "unsure", "either"];

/** Scores one option candidate deterministically (risk-aware, no randomness). */
export function scoreOption(option: string): number {
  const normalized = normalize(option);
  let score = 0;
  for (const token of RISKY_TOKENS) if (normalized.includes(token.toLocaleLowerCase())) score -= 4;
  for (const token of SAFE_TOKENS) if (normalized.includes(token.toLocaleLowerCase())) score += 3;
  for (const token of RECOMMENDED_TOKENS) if (normalized.includes(token.toLocaleLowerCase())) score += 1;
  for (const token of AMBIGUOUS_TOKENS) if (normalized.includes(token.toLocaleLowerCase())) score -= 1;
  return score;
}

export function pickBestOption(options: readonly string[]): { chosen: string; index: number; score: number } {
  if (!options.length) throw new Error("pickBestOption requires at least one option");
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  options.forEach((option, index) => {
    const score = scoreOption(option);
    // Ties resolve to the earlier index — deterministic and conservative.
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return { chosen: options[bestIndex], index: bestIndex, score: bestScore };
}

/**
 * §18 auto-decision for a DECIDABLE question. Deterministic policies only:
 * continuation questions auto-continue; explicit safe options get picked;
 * genuinely ambiguous technical choices are steered strongly toward an
 * evidence-backed decision (never surfaced to the owner, never random).
 */
export function autoDecisionFor(input: QuestionInterceptionInput): AutoDecision {
  const text = normalize(input.text);
  const kind = input.kind ?? inferQuestionKind(input.text);
  if (kind === "CONTINUATION" || CONTINUATION_PATTERNS.some((pattern) => text.includes(pattern))) {
    return {
      chosen: "继续执行（auto-continue）",
      action: "CONTINUE",
      steer: "自动继续：在既有 checkpoints 上推进，并在每个里程碑执行结果验证；不要再次询问是否继续。",
      rationale: "问题命中 continuation 模式，属于 DECIDABLE；OWNER_RESULT 下自动继续。",
      policy: "owner-result:continue:v1"
    };
  }
  const options = (input.options ?? []).filter((option) => option.trim().length > 0);
  if (options.length > 0) {
    const picked = pickBestOption(options);
    if (picked.score >= 0) {
      return {
        chosen: picked.chosen,
        action: "PICK_OPTION",
        steer: `按决策策略自动选择“${picked.chosen}”并执行；执行后必须完成结果验证，失败则按恢复梯处理。`,
        rationale: `候选已评分（确定性策略）：选中最稳妥/被推荐项，得分 ${picked.score}。`,
        policy: "owner-result:pick-option:v1"
      };
    }
    return {
      chosen: options[picked.index],
      action: "STRONG_STEER",
      steer: `所有候选均含风险信号。采用最低风险项“${options[picked.index]}”，并要求执行前给出风险缓解证据；禁止再次抛选项。`,
      rationale: `候选得分均为负（最高 ${picked.score}）；确定性选择风险最低者并强 steer。`,
      policy: "owner-result:steer-risky:v1"
    };
  }
  if (STRONG_STEER_PATTERNS.some((pattern) => text.includes(pattern))) {
    return {
      chosen: "由执行者给出证据支撑的方向（auto）",
      action: "STRONG_STEER",
      steer: "继续方向模糊：要求基于现有证据、失败记录与验收标准给出唯一执行方向，禁止抛开放问题。",
      rationale: "命中无法决定信号：强 steer 而非询问 Owner。",
      policy: "owner-result:strong-steer:v1"
    };
  }
  return {
    chosen: "继续并产出方向证据（auto）",
    action: "ROUTE_TO_PLANNER",
    steer: "问题分类为可决策但无明确候选：路由到独立 planner/reviewer 决策并回填决策台账，不得向 Owner 提问。",
    rationale: "非 HB 且无 continuation/候选：路由内部决策者。",
    policy: "owner-result:route-planner:v1"
  };
}

/**
 * §18 interception entry. Under OWNER_RESULT the question is auto-decided unless
 * it is a true HARD_BLOCKER; under ASSISTED the original human gate stands
 * (intercepted=false, classification only reported).
 */
export function interceptForMode(input: QuestionInterceptionInput, mode: RunMode): QuestionInterception {
  const { classification, blocker } = classifyQuestion(input);
  if (classification === "HARD_BLOCKER") {
    return { classification, blocker, intercepted: false };
  }
  if (mode !== "OWNER_RESULT") {
    return { classification, intercepted: false };
  }
  const decision = autoDecisionFor(input);
  return { classification, intercepted: true, decision };
}

/**
 * Owner-Result gate over the existing human-intervention vocabulary
 * (intervention.ts kinds). Under OWNER_RESULT only hard-blocker categories
 * pause; decidable categories are intercepted even when a legacy caller already
 * classified the request as REQUIRES_USER.
 */
export function ownerResultGateFor(kind: QuestionKind): { verdict: "DECIDABLE" | "HARD_BLOCKER"; blocker?: HardBlockerHit } {
  switch (kind) {
    case "AUTHORIZATION":
      return { verdict: "HARD_BLOCKER", blocker: { kind: "HB1_PERMISSIONS_OR_CREDENTIALS", matched: kind } };
    case "EXTERNAL_ACTION":
      return { verdict: "HARD_BLOCKER", blocker: { kind: "HB2_IRREVERSIBLE_EXTERNAL_ACTION", matched: kind } };
    case "GOAL_CONFLICT":
      return { verdict: "HARD_BLOCKER", blocker: { kind: "HB3_GOAL_CONTRADICTION", matched: kind } };
    case "RESOURCE_MISSING":
      return { verdict: "HARD_BLOCKER", blocker: { kind: "HB4_REQUIRED_EXTERNAL_RESOURCE_MISSING", matched: kind } };
    default:
      return { verdict: "DECIDABLE" };
  }
}
