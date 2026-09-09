import fs from "node:fs";
import path from "node:path";
import { workspacePath } from "./native-tools";
import type { CheckSpec } from "./verification";
export function requiredEngineeringChecks(root: string, sourceFiles: string[]): CheckSpec[] {
  const tests: string[] = []; let entries = 0;
  const visit = (relative: string) => {
    for (const entry of fs.readdirSync(workspacePath(root, relative), { withFileTypes: true })) {
      if (++entries > 20000) throw new Error("Verification discovery exceeds budget");
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || ["node_modules", "artifacts", "dist", "dist-electron", "runtime-data", "history", "coverage"].includes(entry.name)) continue;
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) tests.push(file);
    }
  }; visit(".");
  if (!tests.length) throw new Error("No test files discovered; engineering completion requires executable verification");
  const checks: CheckSpec[] = sourceFiles.filter((file) => /\.[cm]?js$/.test(file)).map((file) => ({ kind: "syntax", file }));
  if (fs.existsSync(path.join(root, "tsconfig.json"))) checks.push({ kind: "typecheck" });
  checks.push({ kind: "test", files: tests.length <= 50 ? tests : [] }, { kind: "diff" });
  return checks;
}
