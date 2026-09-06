/**
 * Capability-need detection (plan 9-7 §2). Pure + deterministic: decides from
 * the message and its input objects whether CHAT suffices or WORK must be
 * proposed. Never asks a model to answer a question a host regex can answer.
 */

import type { InputObjectKind } from "./input-object";

export interface CapabilityNeeds {
  requiresWorkspace: boolean;
  requiresFileMutation: boolean;
  requiresExecution: boolean;
  requiresShell: boolean;
  requiresGit: boolean;
  requiresMultiStepPlan: boolean;
  requiresDurableArtifacts: boolean;
  requiresRepoMaterialization: boolean;
}

export type InteractionMode = "CHAT" | "WORK_PROPOSED" | "WORK";

/** Plan §2.4: transition record kept on the task until the user decides once. */
export interface ModeTransition {
  from: "CHAT";
  to: "WORK";
  reason: string;
  requiredCapabilities: string[];
  approvedAt?: string;
}

export interface EscalationDecision {
  escalate: boolean;
  reason?: string;
  requiredCapabilities: string[];
}

export const NO_NEEDS: CapabilityNeeds = {
  requiresWorkspace: false,
  requiresFileMutation: false,
  requiresExecution: false,
  requiresShell: false,
  requiresGit: false,
  requiresMultiStepPlan: false,
  requiresDurableArtifacts: false,
  requiresRepoMaterialization: false
};

/** Kinds that already prove a repo/file artifact is involved. */
const REPO_KINDS: ReadonlySet<InputObjectKind> = new Set(["CODE", "REPOSITORY", "ARCHIVE"]);

/** Host-side markers; deliberately conservative and language-aware. */
const MUTATION = /修改|实现|重构|迁移|删除|新建|编辑|add|implement|refactor|migrate|delete|edit|update|fix/;
const EXECUTION = /运行|执行|测试|构建|run|test|build|execute|typecheck|lint|验证|deploy|发布|publish/;
const LOCAL_EXECUTION = /跑|benchmark|bench|基准|做.*实验|完成实验/;
const GIT = /git|分支|提交记录|commit|diff|merge|push|pull|clone|版本控制/;
const PLAN_FILE = /tasks\.md|plan\.md|roadmap|开发计划|任务清单/;
const MULTI_STEP = /首先|然后|接着|最后|多步|parallel|并行|分步/;
const LOCAL_SELF = /这里|本地|这个项目|该项目|当前项目|本目录|working (dir|directory)/;

function has(message: string, pattern: RegExp): boolean {
  return pattern.test(message);
}

/** Does the message or its inputs point at a concrete repo/code artifact? */
function mentionsRepo(message: string, kinds: InputObjectKind[]): boolean {
  return kinds.some((kind) => REPO_KINDS.has(kind)) || /\brepo\b|仓库/.test(message);
}

/**
 * Detects what a request needs. Conservative: plain Q&A about an uploaded
 * file stays CHAT; anything that names a repo/workspace together with a
 * mutation/execution verb (or runs a benchmark / applies tasks.md) escalates
 * to WORK so the plan runner can actually touch the code.
 */
export function detectCapabilityNeeds(input: { message: string; inputKinds?: InputObjectKind[]; workspaceKnown?: boolean }): CapabilityNeeds {
  const message = input.message ?? "";
  const kinds = input.inputKinds ?? [];
  const repo = mentionsRepo(message, kinds);
  const mutates = has(message, MUTATION);
  const executes = has(message, EXECUTION);
  const localExecutes = has(message, LOCAL_EXECUTION);
  const benchmark = localExecutes && !repo; // "跑 benchmark" on its own still means this machine
  const git = has(message, GIT);
  const multiStep = has(message, PLAN_FILE) || (has(message, MULTI_STEP) && (mutates || executes || localExecutes));
  const planAppliesLocally = has(message, PLAN_FILE) && (mutates || executes || localExecutes || has(message, LOCAL_SELF));
  const toolNeeded = (repo && (mutates || executes || localExecutes)) || planAppliesLocally || (benchmark && mutates);

  const needs: CapabilityNeeds = {
    requiresWorkspace: toolNeeded,
    requiresFileMutation: toolNeeded && mutates,
    requiresExecution: (repo && (executes || localExecutes)) || planAppliesLocally || benchmark,
    requiresShell: toolNeeded && (executes || localExecutes) && mutates,
    requiresGit: git && (repo || mutates || executes || localExecutes),
    requiresMultiStepPlan: multiStep || planAppliesLocally,
    requiresDurableArtifacts: ((executes || localExecutes) && (repo || planAppliesLocally)) || benchmark,
    requiresRepoMaterialization: repo && (mutates || executes || localExecutes || multiStep)
  };
  return needs;
}

/** Is every need satisfiable by a plain visible-web chat turn? */
export function chatSufficientFor(needs: CapabilityNeeds): boolean {
  return !needs.requiresWorkspace
    && !needs.requiresFileMutation
    && !needs.requiresExecution
    && !needs.requiresShell
    && !needs.requiresGit
    && !needs.requiresMultiStepPlan
    && !needs.requiresDurableArtifacts
    && !needs.requiresRepoMaterialization;
}

const NEED_LABELS: Array<[keyof CapabilityNeeds, string]> = [
  ["requiresWorkspace", "需要访问工作区"],
  ["requiresFileMutation", "需要修改项目文件"],
  ["requiresExecution", "需要运行命令/测试"],
  ["requiresShell", "需要 Shell 执行"],
  ["requiresGit", "需要 Git 操作"],
  ["requiresMultiStepPlan", "需要多步执行计划"],
  ["requiresDurableArtifacts", "需要持久化产物"],
  ["requiresRepoMaterialization", "需要物化仓库"]
];

const NEED_TOKENS: Record<keyof CapabilityNeeds, string> = {
  requiresWorkspace: "repo_read",
  requiresFileMutation: "code_edit",
  requiresExecution: "run_test",
  requiresShell: "run_build",
  requiresGit: "git_status",
  requiresMultiStepPlan: "planning",
  requiresDurableArtifacts: "run_build",
  requiresRepoMaterialization: "repo_read"
};

/**
 * Escalation decision (plan §2.3): when CHAT is not enough, WORK is proposed
 * with an explainable reason + capability tokens for the router.
 */
export function decideEscalation(needs: CapabilityNeeds): EscalationDecision {
  if (chatSufficientFor(needs)) return { escalate: false, requiredCapabilities: [] };
  const labels = NEED_LABELS.filter(([key]) => needs[key]).map(([, label]) => label);
  const requiredCapabilities = [...new Set((Object.keys(needs) as Array<keyof CapabilityNeeds>).filter((key) => needs[key]).map((key) => NEED_TOKENS[key]))];
  return { escalate: true, reason: `这个任务需要进入 Work：${labels.join("、")}`, requiredCapabilities };
}

export function allCapabilityNeedsFalse(needs: CapabilityNeeds): boolean {
  return Object.values(needs).every((value) => value === false);
}
