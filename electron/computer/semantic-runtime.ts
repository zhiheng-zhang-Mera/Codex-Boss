export type SemanticActionName = "open_app" | "focus_window" | "find_control" | "click_control" | "enter_text" | "read_page" | "submit" | "wait_for_state" | "verify_state";
export interface SemanticAction { name: SemanticActionName; target: string; value?: string; timeoutMs?: number; }
export type SemanticBackendKind = "native" | "dom" | "uia" | "structured" | "vision";
export interface SemanticResult { status: "SUCCESS" | "UNSUPPORTED" | "FAILED" | "UNCERTAIN"; evidence?: unknown; message?: string; backend?: SemanticBackendKind; }
export interface SemanticBackend { kind: SemanticBackendKind; supports(action: SemanticAction): boolean; execute(action: SemanticAction, signal: AbortSignal): Promise<SemanticResult>; }
const priority: SemanticBackendKind[] = ["native", "dom", "uia", "structured", "vision"];
const mutations = new Set<SemanticActionName>(["open_app", "focus_window", "click_control", "enter_text", "submit"]);
export class SemanticRuntime {
  constructor(private readonly backends: SemanticBackend[]) {}
  async execute(action: SemanticAction): Promise<SemanticResult> {
    const timeoutMs = action.timeoutMs ?? 15000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error("Invalid semantic timeout");
    for (const backend of [...this.backends].sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind))) {
      if (!backend.supports(action)) continue;
      const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      let result: SemanticResult;
      try {
        result = await Promise.race([backend.execute(action, abort.signal), new Promise<SemanticResult>((resolve) => { timer = setTimeout(() => { abort.abort(); resolve({ status: mutations.has(action.name) ? "UNCERTAIN" : "FAILED", message: "Semantic action timed out" }); }, timeoutMs); })]);
      } catch (error) { result = { status: mutations.has(action.name) ? "UNCERTAIN" : "FAILED", message: String(error) }; }
      finally { if (timer) clearTimeout(timer); }
      if (result.status === "SUCCESS" || result.status === "UNCERTAIN" || (mutations.has(action.name) && result.status !== "UNSUPPORTED")) return { ...result, backend: backend.kind };
    }
    return { status: "UNSUPPORTED", message: "No supported semantic backend completed the action" };
  }
}
