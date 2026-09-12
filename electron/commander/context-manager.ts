import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ClaimRecord, DisputeRecord } from "../../src/shared/contracts";
import type { KnowledgeEntry } from "../../src/shared/knowledge";
import type { RoleId } from "./role-router";
import { readEnvelope, migrateJsonFile, schemaMigrations, type VersionedEnvelope } from "./schema-migration";
import { compileContextCapsule, capsuleCacheKeyInput, type ContextCapsule, type ContextCapsuleLevel } from "../../src/shared/context-capsule";

/** Content-addressed key (plan §13.4): scope|kind|version|input hash. */
function cacheKeyFor(scope: string, fingerprint: string, level: ContextCapsuleLevel): string {
  return createHash("sha256").update([scope, "context-capsule", "2", level, fingerprint].join("|"), "utf8").digest("hex");
}

export interface ContextSummary { id: string; text: string; createdAt: string; }
export interface ExecutionRef { id: string; status: string; }
export interface TaskContext {
  taskId: string;
  objective: string;
  constraints: string[];
  currentProtocol: string;
  currentRound: string;
  resolvedClaims: ClaimRecord[];
  openDisputes: DisputeRecord[];
  artifactRefs: string[];
  summaries: ContextSummary[];
  executionHistory: ExecutionRef[];
}
export interface ContextBudget { maxChars?: number; maxTokens?: number; maxArtifacts?: number; }

const CONTEXT_SCHEMA = "task-contexts";
// Legacy task-contexts.json was an unversioned array of TaskContext; v1 wraps
// that payload in the versioned envelope. The step is identity — the value it
// guarantees is provenance + the fail-closed envelope contract, not data shape.
schemaMigrations.register(CONTEXT_SCHEMA, {
  from: 0,
  to: 1,
  migrate: (payload) => payload,
  validate: (payload) => {
    if (!Array.isArray(payload)) throw new Error("task-contexts payload must be an array");
  }
});

export class ContextManager {
  private readonly contexts = new Map<string, TaskContext>();
  /** Optional knowledge provider (plan AP10 seam): routes domain knowledge into capsules. */
  private knowledgeProvider?: (taskId: string, role: RoleId, maxChars: number) => KnowledgeEntry[];
  /**
   * checkpoint-1 §5.5 seam: renders the bounded reusable-knowledge section for a
   * prompt. Distinct from `knowledgeProvider` (which the older capsule path
   * consumes) because this one carries provenance and its own budget and is the
   * one the running app wires to the Knowledge Foundation.
   */
  private knowledgeSectionProvider?: (taskId: string, role: RoleId, maxChars: number) => string | undefined;
  constructor(private readonly filePath?: string, knowledgeProvider?: (taskId: string, role: RoleId, maxChars: number) => KnowledgeEntry[]) {
    this.knowledgeProvider = knowledgeProvider;
    this.restore();
  }

  /** Attach (or replace) the knowledge provider after construction (AP10 domain routing). */
  setKnowledgeProvider(provider: (taskId: string, role: RoleId, maxChars: number) => KnowledgeEntry[]): void { this.knowledgeProvider = provider; }

  /** Attach (or replace) the §5.5 knowledge-section provider. */
  setKnowledgeSectionProvider(provider: (taskId: string, role: RoleId, maxChars: number) => string | undefined): void { this.knowledgeSectionProvider = provider; }

  save(context: TaskContext): void { this.contexts.set(context.taskId, structuredClone(context)); this.persist(); }
  get(taskId: string): TaskContext | undefined { const value = this.contexts.get(taskId); return value && structuredClone(value); }

  retainTaskIds(taskIds: Iterable<string>): void {
    const retained = new Set(taskIds);
    let changed = false;
    for (const taskId of this.contexts.keys()) if (!retained.has(taskId)) { this.contexts.delete(taskId); changed = true; }
    if (changed) this.persist();
  }

  assembleStep(taskId: string, step: import("../../src/shared/task-ir").TaskStep, dependencyOutputs: Record<string, string>, files: Record<string, string>): string {
    const context = this.get(taskId); if (!context) throw new Error("Unknown task context");
    return JSON.stringify({ objective: context.objective, currentStep: step, constraints: context.constraints,
      dependencyOutputs: Object.fromEntries(step.dependencies.map((id) => [id, (dependencyOutputs[id] ?? "").slice(0, 12000)])),
      authorizedFiles: Object.fromEntries(step.requiredFiles.map((file) => [file, (files[file] ?? "").slice(0, 16000)])),
      requiredEvidence: "Return the requested result with sources or verification; no unrequested actions.", openDisputes: context.openDisputes }, null, 2).slice(0, 64000);
  }

  assemble(taskId: string, role: RoleId, roleInstructions: string, budget: ContextBudget = {}): string {
    const context = this.get(taskId);
    if (!context) throw new Error(`Unknown task context: ${taskId}`);
    const maxArtifacts = Math.max(0, budget.maxArtifacts ?? 20);
    const maxChars = Math.min(budget.maxChars ?? 24000, (budget.maxTokens ?? Number.MAX_SAFE_INTEGER) * 4);
    const head = [
      `ROLE: ${role}\n${roleInstructions}`,
      `OBJECTIVE:\n${context.objective}`,
      `CONSTRAINTS:\n${context.constraints.join("\n")}`
    ];
    // §5.5: reusable project knowledge gets at most a third of what is left
    // after the task's own instructions, so a large base can never crowd out the
    // objective. With no provider attached the assembled string is byte-for-byte
    // what it was before this seam existed.
    const remaining = maxChars - head.join("\n\n").length;
    const knowledge = remaining > 0 ? this.knowledgeSectionProvider?.(taskId, role, Math.floor(remaining / 3)) : undefined;
    const sections = [
      ...head,
      ...(knowledge ? [`PROJECT_KNOWLEDGE:\n${knowledge}`] : []),
      `PROTOCOL: ${context.currentProtocol} / ${context.currentRound}`,
      `ARTIFACT_REFS:\n${context.artifactRefs.slice(-maxArtifacts).join("\n")}`,
      `OPEN_DISPUTES:\n${context.openDisputes.map((item) => `${item.id}: ${item.topic}`).join("\n")}`,
      `SUMMARIES:\n${context.summaries.map((item) => item.text).join("\n")}`
    ];
    return sections.join("\n\n").slice(0, maxChars);
  }

  /** C0/C1/C2 capsule for a task+role with scoped files (AP09); the fingerprint is a cache-invalidation key. */
  capsule(taskId: string, role: RoleId, files?: Record<string, string>, maxChars?: number, architecture?: Record<string, string>): ContextCapsule {
    const context = this.get(taskId);
    if (!context) throw new Error(`Unknown task context: ${taskId}`);
    const dependencies: Record<string, string> = { openDisputes: JSON.stringify(context.openDisputes), summaries: JSON.stringify(context.summaries) };
    const knowledge = this.knowledgeProvider?.(taskId, role, maxChars ?? 24000);
    if (knowledge?.length) {
      for (const entry of knowledge) {
        dependencies[`knowledge:${entry.shelf}:${entry.id}`] = JSON.stringify({ title: entry.title, content: entry.content, trust: entry.trust, source: entry.source });
      }
    }
    return compileContextCapsule({ role, objective: context.objective, files, architecture, dependencies, maxChars });
  }

  /** Returns the content-addressed cache key for a compiled capsule (plan §13.4 hash+version+policy). */
  capsuleCacheKey(taskId: string, role: RoleId, files?: Record<string, string>, maxChars?: number, architecture?: Record<string, string>): { key: string; scope: string; fingerprint: string; level: ContextCapsuleLevel } {
    const context = this.get(taskId);
    if (!context) throw new Error(`Unknown task context: ${taskId}`);
    const input = { role, objective: context.objective, files, architecture, dependencies: { openDisputes: JSON.stringify(context.openDisputes), summaries: JSON.stringify(context.summaries) }, maxChars };
    const meta = capsuleCacheKeyInput(input);
    const scope = `task-context:${taskId}`;
    return { key: cacheKeyFor(scope, meta.fingerprint, meta.level), scope, fingerprint: meta.fingerprint, level: meta.level };
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      // Legacy files were an unversioned array; migrate a copy to the v1
      // envelope (read-old → migrate-copy → validate → atomic commit).
      migrateJsonFile(CONTEXT_SCHEMA, this.filePath);
      const parsed = readEnvelope<TaskContext[]>(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
      if (parsed.schema_id !== CONTEXT_SCHEMA) throw new Error("Unrecognized task-context file");
      for (const context of parsed.data) if (context?.taskId) this.contexts.set(context.taskId, context);
    } catch { /* corrupt optional context never replaces canonical task state */ }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    const envelope: VersionedEnvelope<TaskContext[]> = {
      schema_id: CONTEXT_SCHEMA,
      schema_version: schemaMigrations.latest(CONTEXT_SCHEMA),
      created_by: "codex-boss",
      migration_history: [],
      data: [...this.contexts.values()]
    };
    const content = JSON.stringify(envelope, null, 2);
    fs.writeFileSync(temporary, content, "utf8");
    try { fs.renameSync(temporary, this.filePath); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EXDEV", "EEXIST", "EPERM"].includes(code ?? "")) throw error;
      try { fs.copyFileSync(temporary, this.filePath); }
      catch { fs.writeFileSync(this.filePath, content, "utf8"); }
      fs.rmSync(temporary, { force: true });
    }
  }
}
