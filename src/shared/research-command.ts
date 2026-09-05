/**
 * Structured research command spec (plan 9-6 Phase 6). Pure and shareable.
 * Every research execution is `spawn(executable, args)` with explicit purpose /
 * cwd / timeout / environment — never `shell:true` with a model-generated
 * string. Executables are validated against an allow-list so a research model
 * can only run tools the workspace authorizes.
 */

export type ResearchPurpose = "EXPERIMENT" | "ANALYSIS" | "TEST" | "BUILD" | "DATA_PROCESSING";

export interface ResearchCommandSpec {
  executable: string;
  args: string[];
  cwd: string;
  purpose: ResearchPurpose;
  timeoutMs: number;
  expectedOutputs?: string[];
  environment?: Record<string, string>;
}

/** Executable families a research run may spawn (base names). */
export const ALLOWED_EXECUTABLES = new Set<string>(["python", "python3", "py", "node", "npm", "pnpm", "git", "pytest", "tsx", "npx"]);

export function validateCommandSpec(spec: ResearchCommandSpec): void {
  if (!spec || typeof spec.executable !== "string" || !spec.executable.trim()) throw new Error("Research command requires an executable");
  if (/\s|[\r\n]/.test(spec.executable)) throw new Error("Research executable must be a bare path/name (no shell metacharacters)");
  if (!Array.isArray(spec.args) || spec.args.length > 100 || spec.args.some((arg) => typeof arg !== "string" || arg.length > 4000)) throw new Error("Invalid research args");
  if (typeof spec.cwd !== "string" || !spec.cwd.trim()) throw new Error("Research command requires a cwd");
  if (!["EXPERIMENT", "ANALYSIS", "TEST", "BUILD", "DATA_PROCESSING"].includes(spec.purpose)) throw new Error("Invalid research purpose");
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 1000 || spec.timeoutMs > 3600000) throw new Error("Invalid research timeout");
  if (spec.expectedOutputs && (spec.expectedOutputs.length > 20 || spec.expectedOutputs.some((marker) => typeof marker !== "string" || !marker || marker.length > 500))) throw new Error("Invalid expected outputs");
}

/** True when the executable basename is in the allow-list (Windows tolerates .exe). */
export function executableAllowed(executable: string): boolean {
  const base = executable.replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat)$/i, "");
  return ALLOWED_EXECUTABLES.has(base.toLocaleLowerCase());
}
