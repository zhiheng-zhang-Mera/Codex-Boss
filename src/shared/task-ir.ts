export type TaskLevel = "L0" | "L1" | "L2" | "L3";
export type NativeOperation = { kind: "git_status" } | { kind: "read_file"; path: string } | { kind: "list_files"; path: string };
export interface TaskStep { id: string; kind: "native" | "worker" | "verify"; description: string; dependencies: string[]; requiredFiles: string[]; operation?: NativeOperation; }
export interface TaskIR {
  version: 1; goal: string; deliverables: string[]; constraints: string[]; successConditions: string[];
  riskLevel: "low" | "medium" | "high"; requiredCapabilities: string[]; dependencies: string[];
  estimatedComplexity: TaskLevel; budgetClass: "minimal" | "standard" | "extended";
  maxWorkers: number; steps: TaskStep[]; planningReason: string;
}
export interface CompileOptions { constraints?: string[]; steps?: TaskStep[]; allowParallel?: boolean; }
export function compileIntent(request: string, options: CompileOptions = {}): TaskIR {
  const goal = request.trim(); if (!goal || goal.length > 100000) throw new Error("Task objective must contain 1–100000 characters");
  const file = /^(?:read file|读取文件)\s+([^\r\n]+)$/i.exec(goal);
  const listing = /^(?:list files|列出文件)(?:\s+([^\r\n]+))?$/i.exec(goal);
  const operation: NativeOperation | undefined = /^(?:git status|查看\s*git\s*状态)$/i.test(goal) ? { kind: "git_status" } : file ? { kind: "read_file", path: file[1].trim() } : listing ? { kind: "list_files", path: listing[1]?.trim() ?? "." } : undefined;
  const riskLevel = /\b(delete|publish|deploy|payment|credentials)\b|删除|发布|转账|密钥/i.test(goal) ? "high" : /\b(refactor|implement|migrate)\b|重构|实现|迁移/i.test(goal) ? "medium" : "low";
  const steps: TaskStep[] = options.steps ? structuredClone(options.steps) : [{ id: "execute", kind: operation ? "native" : "worker", description: goal, dependencies: [], requiredFiles: file ? [file[1]] : [], ...(operation ? { operation } : {}) }];
  validateGraph(steps);
  const independent = steps.filter((step) => step.dependencies.length === 0).length;
  const level: TaskLevel = options.steps?.length && steps.length > 1 ? options.allowParallel && independent > 1 ? "L3" : "L2" : operation ? "L0" : "L1";
  return { version: 1, goal, deliverables: [operation ? "Native command output" : "Task response and supporting evidence"], constraints: options.constraints ?? [], successConditions: ["Every step has evidence", "Required verification passes"], riskLevel, requiredCapabilities: operation ? ["native"] : ["general_reasoning"], dependencies: steps.flatMap((step) => step.dependencies), estimatedComplexity: level, budgetClass: level === "L0" ? "minimal" : level === "L3" ? "extended" : "standard", maxWorkers: level === "L3" ? Math.min(3, independent) : 1, steps, planningReason: level === "L0" ? "Exact deterministic operation" : level === "L1" ? "Single worker is sufficient; no planner call" : "Explicit dependency graph" };
}
export function validateGraph(steps: TaskStep[]): void {
  if (!steps.length || steps.length > 100) throw new Error("Graph must have 1–100 steps");
  for (const step of steps) {
    if (!step || typeof step.id !== "string" || !["native", "worker", "verify"].includes(step.kind) || typeof step.description !== "string" || !step.description.trim() || step.description.length > 20000 || !Array.isArray(step.dependencies) || !Array.isArray(step.requiredFiles) || step.requiredFiles.length > 50 || step.requiredFiles.some((file) => typeof file !== "string" || /^(?:[A-Za-z]:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)/.test(file))) throw new Error("Invalid graph step");
    if (step.operation && (!["git_status", "read_file", "list_files"].includes(step.operation.kind) || (step.operation.kind !== "git_status" && typeof step.operation.path !== "string"))) throw new Error("Invalid native operation");
  }
  const ids = new Set(steps.map((step) => step.id)); if (ids.size !== steps.length) throw new Error("Duplicate step ID");
  const done = new Set<string>();
  for (const step of steps) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(step.id)) throw new Error("Invalid step ID");
    if (step.dependencies.some((id) => !ids.has(id))) throw new Error("Missing dependency");
    if (step.kind === "native" && !step.operation) throw new Error("Native step requires an operation");
  }
  while (done.size < steps.length) { const ready = steps.filter((step) => !done.has(step.id) && step.dependencies.every((id) => done.has(id))); if (!ready.length) throw new Error("Cyclic dependency graph"); ready.forEach((step) => done.add(step.id)); }
}
export function shouldReplan(reason: "response" | "dependency_invalid" | "verification_failed" | "blocker" | "capability_lost" | "step_failed", failures = 0): boolean {
  return reason !== "response" && (reason !== "step_failed" || failures >= 2);
}
