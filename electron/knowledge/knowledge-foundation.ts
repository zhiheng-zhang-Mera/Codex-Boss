/**
 * Update-Plan/checkpoint-1.md §5 — the Knowledge Foundation facade.
 *
 * This is the one place the running app talks to knowledge. It joins the three
 * halves the plan asks for:
 *
 *   write    recordWorkBookDispatch() derives verified facts from a finished
 *            WorkBook dispatch and commits them through the §5.3 write gate;
 *   read     sectionForTask() turns a task + TaskFingerprint into a BOUNDED
 *            knowledge section (§5.5) straight out of the durable base — it
 *            never scans a repository, which is what lets a second task in the
 *            same project reuse the first task's facts without re-deriving them;
 *   observe  summary()/evidence() expose the gate log, quarantines and conflict
 *            sets so an acceptance report can show what was accepted, refused or
 *            parked rather than asserting it.
 *
 * Fault isolation (§2.5/§46): every entry point catches its own failures. A
 * knowledge write can never fail a task, and a retrieval failure leaves the
 * prompt exactly as it would have been without knowledge.
 */
import path from "node:path";
import { KnowledgeBase, type KnowledgeCommitResult, type KnowledgeBaseSummary, type KnowledgeGateLogEntry } from "./knowledge-base";
import { extractKnowledgeFromDispatch, summarizeExtraction, type KnowledgeExtractionInput } from "../../src/shared/knowledge-extraction";
import {
  renderKnowledgeSection,
  selectKnowledgeForTask,
  type KnowledgeConflictSet,
  type KnowledgeObject,
  type KnowledgeRetrievalResult,
  type KnowledgeType
} from "../../src/shared/knowledge-object";
import { buildStructuralFingerprint, type TaskFingerprint } from "../../src/shared/task-fingerprint";
import type { KnowledgeScope } from "../../src/shared/tenx/knowledge";
import type { WorkBookDispatchRecord } from "../../src/shared/workbook-dispatch";

/** Capability signals read off a goal so retrieval filters types sensibly. */
const CAPABILITY_PATTERNS: ReadonlyArray<{ capability: string; pattern: RegExp }> = [
  { capability: "coding", pattern: /\b(code|coding|implement|refactor|fix|bug|compile|typecheck|test|build|function|module|file)\b|代码|实现|重构|修复|测试|构建/i },
  { capability: "ui", pattern: /\b(ui|ux|theme|skin|style|css|layout|component|screenshot|visual|design)\b|主题|界面|样式|视觉|布局/i },
  { capability: "research", pattern: /\b(research|paper|study|literature|experiment|benchmark|analysis)\b|研究|论文|实验|分析/i },
  { capability: "verification", pattern: /\b(verify|verification|acceptance|regression|review)\b|验证|验收|审查/i }
];

export function capabilitiesForGoal(goal: string): string[] {
  const found = new Set<string>();
  for (const { capability, pattern } of CAPABILITY_PATTERNS) if (pattern.test(goal)) found.add(capability);
  if (!found.size) found.add("coding");
  return [...found].sort();
}

export interface KnowledgeFoundationOptions {
  /** Durable base file; omit for an in-memory base (tests). */
  filePath?: string;
  now?: () => string;
}

export interface KnowledgeRecordSummary {
  ok: boolean;
  taskId: string;
  scope: KnowledgeScope;
  extracted: number;
  byType: Partial<Record<KnowledgeType, number>>;
  outcomes: Partial<Record<KnowledgeCommitResult["outcome"], number>>;
  accepted: string[];
  quarantined: string[];
  rejected: number;
  failures: string[];
  error?: string;
}

export interface KnowledgeSectionResult {
  /** Bounded prompt text; empty when the project has nothing to reuse. */
  text: string;
  retrieval: KnowledgeRetrievalResult;
  fingerprint: TaskFingerprint;
  scope?: KnowledgeScope;
  /** Always 0: retrieval reads the durable base, never the filesystem. */
  repositoryReads: 0;
  error?: string;
}

export class KnowledgeFoundation {
  private readonly retrievals: Array<{ at: string; taskId: string; scope?: string; selected: number; characters: number; dropped: number }> = [];

  constructor(
    readonly base: KnowledgeBase = new KnowledgeBase(),
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  /* ---------------- identity ---------------- */

  /**
   * §49: a knowledge identity is never a single machine's temporary path. The
   * scope is a stable project id when the caller has one (a repository identity)
   * and otherwise a normalized workspace path — while the object ids themselves
   * are content hashes, so two nodes describing the same fact agree.
   */
  projectScopeFor(input: { workspacePath?: string; projectId?: string }): KnowledgeScope {
    const explicit = input.projectId?.trim();
    if (explicit) return `project:${explicit}`;
    const workspace = input.workspacePath?.trim();
    if (!workspace) return "global";
    const normalized = path.resolve(workspace).replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
    return `project:${normalized}`;
  }

  /* ---------------- §5.3 write ---------------- */

  /**
   * Derives this dispatch's reusable facts and commits each through the gate.
   * Individual failures are collected, never thrown: knowledge is a by-product
   * of the task, not a prerequisite for it.
   */
  recordWorkBookDispatch(input: KnowledgeExtractionInput): KnowledgeRecordSummary {
    const scope = input.scope;
    const summary: KnowledgeRecordSummary = {
      ok: true,
      taskId: input.taskId,
      scope,
      extracted: 0,
      byType: {},
      outcomes: {},
      accepted: [],
      quarantined: [],
      rejected: 0,
      failures: []
    };
    try {
      const candidates = extractKnowledgeFromDispatch(input);
      summary.extracted = candidates.length;
      summary.byType = summarizeExtraction(candidates);
      for (const candidate of candidates) {
        try {
          const commit = this.base.commit(candidate);
          summary.outcomes[commit.outcome] = (summary.outcomes[commit.outcome] ?? 0) + 1;
          if (commit.outcome === "ACCEPT" && commit.object && !commit.deduplicated) summary.accepted.push(commit.object.id);
          if (commit.outcome === "SUPERSEDE" && commit.object) summary.accepted.push(commit.object.id);
          if (commit.outcome === "QUARANTINE" && commit.object) summary.quarantined.push(commit.object.id);
          if (commit.outcome === "REJECT") summary.rejected += 1;
        } catch (error) {
          summary.failures.push(`commit(${candidate.type}/${candidate.subject}): ${String((error as Error).message ?? error)}`);
        }
      }
    } catch (error) {
      summary.ok = false;
      summary.error = String((error as Error).message ?? error);
    }
    return summary;
  }

  /* ---------------- §5.5 read ---------------- */

  /**
   * §5.5: task → TaskFingerprint → relevant objects → authority → freshness →
   * semantic relevance → context budget. The result is a bounded string plus the
   * full ranking trace, so what was dropped is inspectable.
   */
  sectionForTask(input: {
    taskId: string;
    goal: string;
    role?: string;
    capabilities?: string[];
    modality?: string[];
    scope?: KnowledgeScope;
    workspacePath?: string;
    projectId?: string;
    characterBudget?: number;
    maxObjects?: number;
    excludeTaskRef?: string;
  }): KnowledgeSectionResult {
    const scope = input.scope ?? this.projectScopeFor({ workspacePath: input.workspacePath, projectId: input.projectId });
    const fingerprint = buildStructuralFingerprint({
      role: input.role ?? "executor",
      capabilities: input.capabilities ?? capabilitiesForGoal(input.goal),
      goal: input.goal,
      modality: input.modality,
      contextLength: input.characterBudget ?? 4000
    });
    try {
      const retrieval = selectKnowledgeForTask({
        fingerprint,
        goal: input.goal,
        objects: this.base.active(),
        characterBudget: input.characterBudget ?? 4000,
        maxObjects: input.maxObjects ?? 12,
        scope,
        excludeTaskRef: input.excludeTaskRef
      });
      this.retrievals.push({
        at: this.now(),
        taskId: input.taskId,
        scope,
        selected: retrieval.selected.length,
        characters: retrieval.characters,
        dropped: retrieval.dropped
      });
      return { text: renderKnowledgeSection(retrieval), retrieval, fingerprint, scope, repositoryReads: 0 };
    } catch (error) {
      return {
        text: "",
        retrieval: { selected: [], characters: 0, budget: input.characterBudget ?? 4000, truncated: false, dropped: 0, not_offered: 0, ranking: [], scopes: [], types: {} },
        fingerprint,
        scope,
        repositoryReads: 0,
        error: String((error as Error).message ?? error)
      };
    }
  }

  /** Direct retrieval surface for callers that already hold a fingerprint. */
  retrieve(input: {
    fingerprint: TaskFingerprint;
    goal: string;
    scope?: KnowledgeScope;
    characterBudget?: number;
    maxObjects?: number;
    excludeTaskRef?: string;
  }): KnowledgeRetrievalResult {
    return selectKnowledgeForTask({
      fingerprint: input.fingerprint,
      goal: input.goal,
      objects: this.base.active(),
      characterBudget: input.characterBudget ?? 4000,
      maxObjects: input.maxObjects ?? 12,
      scope: input.scope,
      excludeTaskRef: input.excludeTaskRef
    });
  }

  /* ---------------- observation ---------------- */

  active(scope?: KnowledgeScope): KnowledgeObject[] {
    return this.base.active(scope);
  }

  conflicts(): KnowledgeConflictSet[] {
    return this.base.conflicts();
  }

  summary(): KnowledgeBaseSummary {
    return this.base.summary();
  }

  gateLog(): KnowledgeGateLogEntry[] {
    return this.base.gateLog();
  }

  /** Machine-readable evidence for an acceptance report. */
  evidence(): {
    summary: KnowledgeBaseSummary;
    loadFailure?: string;
    conflicts: KnowledgeConflictSet[];
    quarantined: KnowledgeObject[];
    gateLog: KnowledgeGateLogEntry[];
    retrievals: Array<{ at: string; taskId: string; scope?: string; selected: number; characters: number; dropped: number }>;
  } {
    const evidence = {
      summary: this.base.summary(),
      conflicts: this.base.conflicts(),
      quarantined: this.base.quarantine(),
      gateLog: this.base.gateLog(),
      retrievals: [...this.retrievals]
    };
    const failure = this.base.loadFailure();
    return failure ? { ...evidence, loadFailure: failure } : evidence;
  }
}

export type { WorkBookDispatchRecord };
