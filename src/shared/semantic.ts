export type SemanticActionName = "open_app" | "focus_window" | "find_control" | "click_control" | "enter_text" | "read_page" | "submit" | "wait_for_state" | "verify_state";
export interface SemanticAction { name: SemanticActionName; target: string; value?: string; expected?: string; timeoutMs?: number; }
export function validateSemanticAction(value: SemanticAction): void {
  if (!value || !["open_app", "focus_window", "find_control", "click_control", "enter_text", "read_page", "submit", "wait_for_state", "verify_state"].includes(value.name) || typeof value.target !== "string" || !value.target || value.target.length > 2000 || Object.keys(value).some((key) => !["name", "target", "value", "expected", "timeoutMs"].includes(key))) throw new Error("Invalid semantic action");
  for (const key of ["value", "expected"] as const) if (value[key] !== undefined && (typeof value[key] !== "string" || value[key]!.length > 100000)) throw new Error("Invalid semantic value");
  if (value.name === "enter_text" && typeof value.value !== "string") throw new Error("Text value required");
  if (["verify_state", "wait_for_state"].includes(value.name) && typeof (value.expected ?? value.value) !== "string") throw new Error("Expected state required");
  if (value.timeoutMs !== undefined && (!Number.isFinite(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 120000)) throw new Error("Invalid semantic timeout");
}
export function computerIntent(goal: string): SemanticAction | undefined {
  const text = goal.trim();
  const app = /^(?:打开|open)\s*(记事本|notepad|文件资源管理器|file explorer|VS Code)$/i.exec(text)?.[1].toLowerCase();
  if (app) return { name: "open_app", target: /记事本|notepad/.test(app) ? "notepad" : /vs code/.test(app) ? "vscode" : "explorer" };
  if (/^(?:查看项目目录|read workspace directory)$/i.test(text)) return { name: "read_page", target: "explorer:." };
  if (/^(?:查看 VS Code 状态|read VS Code status)$/i.test(text)) return { name: "read_page", target: "vscode:status" };
  const log = /^(?:读取终端日志|read terminal log)\s+(.+)$/i.exec(text)?.[1];
  if (log) return { name: "read_page", target: "terminal:" + log };
  const browser = /^(?:查看网页状态|read browser state)\s+([a-z0-9_-]+)$/i.exec(text)?.[1];
  if (browser) return { name: "read_page", target: "browser:" + browser };
  if (/^desktop\s+\{/.test(text)) { const action = JSON.parse(text.slice(8)); validateSemanticAction(action); return action; }
  return undefined;
}
