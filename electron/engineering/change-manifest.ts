import { applyScopedChanges, type FileChange, type CheckSpec } from "./verification";
export interface ChangeManifest { changes: FileChange[]; checks: CheckSpec[]; }
export function parseManifest(content: string): ChangeManifest {
  const raw = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(raw) as ChangeManifest;
  if (!value || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > 50 || !Array.isArray(value.checks) || !value.checks.length || value.checks.length > 20) throw new Error("Invalid change manifest");
  for (const change of value.changes) if (!change || typeof change.path !== "string" || typeof change.content !== "string" || !(change.expectedSha256 === null || typeof change.expectedSha256 === "string" && /^[a-f0-9]{64}$/.test(change.expectedSha256))) throw new Error("Invalid hash-bound change");
  for (const check of value.checks) {
    if (!check || !["syntax", "diff", "test", "typecheck", "build", "lint"].includes(check.kind)) throw new Error("Check is not allowlisted");
    if (check.kind === "syntax" && typeof check.file !== "string") throw new Error("Syntax check requires file");
    if ("files" in check && (!Array.isArray(check.files) || check.files.length > 50 || check.files.some((file) => typeof file !== "string"))) throw new Error("Invalid check scope");
  }
  return value;
}
export function applyManifest(root: string, manifest: ChangeManifest, authorizedPaths: string[]) {
  return applyScopedChanges(root, manifest.changes, authorizedPaths);
}
