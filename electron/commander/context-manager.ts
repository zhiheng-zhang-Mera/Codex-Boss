import fs from "node:fs";
import path from "node:path";
import type { ClaimRecord, DisputeRecord } from "../../src/shared/contracts";
import type { RoleId } from "./role-router";

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

export class ContextManager {
  private readonly contexts = new Map<string, TaskContext>();
  constructor(private readonly filePath?: string) { this.restore(); }

  save(context: TaskContext): void { this.contexts.set(context.taskId, structuredClone(context)); this.persist(); }
  get(taskId: string): TaskContext | undefined { const value = this.contexts.get(taskId); return value && structuredClone(value); }

  retainTaskIds(taskIds: Iterable<string>): void {
    const retained = new Set(taskIds);
    let changed = false;
    for (const taskId of this.contexts.keys()) if (!retained.has(taskId)) { this.contexts.delete(taskId); changed = true; }
    if (changed) this.persist();
  }

  assemble(taskId: string, role: RoleId, roleInstructions: string, budget: ContextBudget = {}): string {
    const context = this.get(taskId);
    if (!context) throw new Error(`Unknown task context: ${taskId}`);
    const maxArtifacts = Math.max(0, budget.maxArtifacts ?? 20);
    const sections = [
      `ROLE: ${role}\n${roleInstructions}`,
      `OBJECTIVE:\n${context.objective}`,
      `CONSTRAINTS:\n${context.constraints.join("\n")}`,
      `PROTOCOL: ${context.currentProtocol} / ${context.currentRound}`,
      `ARTIFACT_REFS:\n${context.artifactRefs.slice(-maxArtifacts).join("\n")}`,
      `OPEN_DISPUTES:\n${context.openDisputes.map((item) => `${item.id}: ${item.topic}`).join("\n")}`,
      `SUMMARIES:\n${context.summaries.map((item) => item.text).join("\n")}`
    ];
    const maxChars = Math.min(budget.maxChars ?? Number.MAX_SAFE_INTEGER, (budget.maxTokens ?? Number.MAX_SAFE_INTEGER) * 4);
    return sections.join("\n\n").slice(0, maxChars);
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as TaskContext[];
      for (const context of parsed) if (context?.taskId) this.contexts.set(context.taskId, context);
    } catch { /* corrupt optional context never replaces canonical task state */ }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    const content = JSON.stringify([...this.contexts.values()], null, 2);
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
