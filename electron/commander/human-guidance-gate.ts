import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { interventionKey, validateInterventionRequest, type HumanInterventionRequest, type InterventionKind } from "../../src/shared/intervention";
import { interventionFileDocument, parseInterventionFile } from "../../src/shared/intervention-file";

/**
 * Durable human-guidance gate (plan 9-6 Phase 4). Research/work tasks run on
 * autopilot and only pause here — the store persists the intervention request
 * (with checkpoint/context summary) before anything stops, and resolution is
 * an append of the decision artifact so the task resumes from its checkpoint,
 * never restarting from scratch. One active intervention per task.
 *
 * The document shape is NOT declared here. It lives in `src/shared/intervention-file.ts`, which the
 * observation surface that reads this file also uses, because the two sides previously hand-wrote
 * different keys (`interventions` vs `items`) and the reader silently reported zero unresolved pauses
 * as a result. One contract, two consumers, is the fix.
 */
export class HumanGuidanceGate {
  private readonly requests = new Map<string, HumanInterventionRequest>();

  constructor(private readonly filePath?: string) {
    this.restore();
  }

  /** Raises a pause request; rejects when the task already has an active one. */
  raise(input: Omit<HumanInterventionRequest, "id" | "createdAt"> & { id?: string }): HumanInterventionRequest {
    const key = interventionKey(input);
    const existing = this.requests.get(key);
    if (existing && !existing.resolvedAt) throw new Error(`Task ${input.taskId} already waits on ${input.kind}`);
    const request: HumanInterventionRequest = { ...input, id: input.id ?? randomUUID(), createdAt: new Date().toISOString() };
    validateInterventionRequest(request);
    this.requests.set(key, request);
    this.persist();
    return structuredClone(request);
  }

  /** Returns the active (unresolved) request for a task, if any. */
  activeFor(taskId: string): HumanInterventionRequest | undefined {
    const active = [...this.requests.values()].filter((item) => item.taskId === taskId && !item.resolvedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return active && structuredClone(active);
  }

  /** Resolves the active request with the user's answer; records resolvedAt. */
  resolve(taskId: string, kind: InterventionKind, answer: string): HumanInterventionRequest {
    const key = interventionKey({ taskId, kind });
    const request = this.requests.get(key);
    if (!request) throw new Error(`No active ${kind} intervention for task ${taskId}`);
    if (request.resolvedAt) throw new Error(`Intervention ${request.id} already resolved`);
    request.answer = answer;
    request.resolvedAt = new Date().toISOString();
    this.persist();
    return structuredClone(request);
  }

  list(taskId?: string): HumanInterventionRequest[] {
    const items = [...this.requests.values()].filter((item) => !taskId || item.taskId === taskId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items.map((item) => structuredClone(item));
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    // Read through the shared parser. `ok` is the only state this may proceed from: a store that is
    // present but unreadable is a set of pauses that cannot be recovered, and treating it as empty
    // would silently drop them. Fail closed, as before, but now the failure names its reason.
    const parsed = parseInterventionFile(fs.readFileSync(this.filePath, "utf8"));
    if (parsed.status !== "ok") throw new Error(parsed.status === "unreadable" ? parsed.reason : "Intervention store is absent");
    for (const request of parsed.interventions) this.requests.set(interventionKey(request), request);
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file = interventionFileDocument([...this.requests.values()]);
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(file, null, 2), "utf8");
    try { fs.renameSync(temporary, this.filePath); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EXDEV", "EEXIST", "EPERM"].includes(code ?? "")) throw error;
      try { fs.copyFileSync(temporary, this.filePath); }
      catch { fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf8"); }
      fs.rmSync(temporary, { force: true });
    }
  }
}
