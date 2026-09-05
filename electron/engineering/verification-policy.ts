import fs from "node:fs";
import path from "node:path";
import { workspacePath } from "./native-tools";
import { discoverTestFiles } from "./repo-inspector";
import type { CheckSpec } from "./verification";
export function requiredEngineeringChecks(root: string, sourceFiles: string[]): CheckSpec[] {
  const tests = discoverTestFiles(root);
  if (!tests.length) throw new Error("No test files discovered; engineering completion requires executable verification");
  const checks: CheckSpec[] = sourceFiles.filter((file) => /\.[cm]?js$/.test(file)).map((file) => ({ kind: "syntax", file }));
  if (fs.existsSync(path.join(root, "tsconfig.json"))) checks.push({ kind: "typecheck" });
  checks.push({ kind: "test", files: tests.length <= 50 ? tests : [] }, { kind: "diff" });
  return checks;
}
