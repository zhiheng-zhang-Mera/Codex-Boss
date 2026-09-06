import { readJson, writeJson } from "../commander/durable-json";
import { validateSemanticAction, type SemanticAction, type SemanticActionName } from "../../src/shared/semantic";
export type { SemanticAction, SemanticActionName } from "../../src/shared/semantic";
export type SemanticBackendKind = "native" | "dom" | "uia" | "structured" | "vision";
export interface SemanticResult { status: "SUCCESS" | "UNSUPPORTED" | "FAILED" | "UNCERTAIN"; evidence?: unknown; message?: string; backend?: SemanticBackendKind; }
export interface SemanticBackend { kind: SemanticBackendKind; supports(action: SemanticAction): boolean; execute(action: SemanticAction, signal: AbortSignal): Promise<SemanticResult>; }
const priority: SemanticBackendKind[] = ["native", "dom", "uia", "structured", "vision"];
const mutations = new Set<SemanticActionName>(["open_app", "focus_window", "click_control", "enter_text", "submit"]);
const queues = new Map<string | symbol, Promise<unknown>>();
function targetKey(target: string): string {
  if (!target.startsWith("uia:") && !target.startsWith("vision:")) return target;
  try { const prefix = target.slice(0, target.indexOf(":") + 1); const value = JSON.parse(target.slice(prefix.length)); return prefix + JSON.stringify(value, Object.keys(value).sort()); } catch { return target; }
}
export class SemanticRuntime {
  private readonly queueKey = Symbol("semantic-runtime");
  private pending: Record<string, SemanticAction>;
  constructor(private readonly backends: SemanticBackend[], private readonly stateFile?: string) { this.pending = Object.assign(Object.create(null), stateFile ? readJson<Record<string, SemanticAction>>(stateFile) ?? {} : {}); }
  async execute(action: SemanticAction): Promise<SemanticResult> {
    validateSemanticAction(action);
    const queueKey = this.stateFile ?? this.queueKey;
    const previous = queues.get(queueKey) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.executeLocked(action));
    queues.set(queueKey, next);
    try { return await next; } finally { if (queues.get(queueKey) === next) queues.delete(queueKey); }
  }
  private async executeLocked(action: SemanticAction): Promise<SemanticResult> {
    if (this.stateFile) this.pending = Object.assign(Object.create(null), readJson<Record<string, SemanticAction>>(this.stateFile) ?? {});
    const key = targetKey(action.target);
    const previous = this.pending[key];
    if (previous && mutations.has(action.name)) return { status: "UNCERTAIN", message: "Previous mutation must be verified before another action" };
    if (previous && action.name === "verify_state") {
      const expected = previous.expected ?? (previous.name === "enter_text" ? previous.value : undefined);
      if (expected === undefined) return { status: "UNCERTAIN", message: "Previous mutation has no verifiable expected state; reconciliation required" };
      action = { ...action, value: expected, expected };
    }
    const timeoutMs = action.timeoutMs ?? 15000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error("Invalid semantic timeout");
    let failure: SemanticResult | undefined;
    for (const backend of [...this.backends].sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind))) {
      if (!backend.supports(action)) continue;
      const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      let result: SemanticResult;
      if (mutations.has(action.name)) { this.pending[key] = action; this.persist(); }
      try {
        result = await Promise.race([backend.execute(action, abort.signal), new Promise<SemanticResult>((resolve) => { timer = setTimeout(() => { abort.abort(); resolve({ status: mutations.has(action.name) ? "UNCERTAIN" : "FAILED", message: "Semantic action timed out" }); }, timeoutMs); })]);
      } catch (error) { result = { status: mutations.has(action.name) ? "UNCERTAIN" : "FAILED", message: String(error) }; }
      finally { if (timer) clearTimeout(timer); }
      if (mutations.has(action.name) && result.status !== "UNCERTAIN") { delete this.pending[key]; this.persist(); }
      if (result.status === "UNCERTAIN" && mutations.has(action.name)) { this.pending[key] = action; this.persist(); }
      if (result.status === "SUCCESS" && action.name === "verify_state" && previous) { delete this.pending[key]; this.persist(); }
      if (result.status === "FAILED") failure = { ...result, backend: backend.kind };
      if (result.status === "SUCCESS" || result.status === "UNCERTAIN" || (mutations.has(action.name) && result.status !== "UNSUPPORTED")) return { ...result, backend: backend.kind };
    }
    return failure ?? { status: "UNSUPPORTED", message: "No supported semantic backend completed the action" };
  }
  private persist(): void { if (this.stateFile) writeJson(this.stateFile, this.pending); }
}
