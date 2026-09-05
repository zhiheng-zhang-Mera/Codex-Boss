import fs from "node:fs";
import path from "node:path";
import { scanRepo } from "./repo-inspector";
import { affectedTests } from "./semantic-slice";
import type { CheckSpec } from "./verification";
export function requiredEngineeringChecks(root: string, sourceFiles: string[]): CheckSpec[] {
  const snapshot = scanRepo(root);
  const allTests = Object.values(snapshot.testMap).flat();
  if (!allTests.length) throw new Error("No test files discovered; engineering completion requires executable verification");
  // Dependency-aware targeted selection: run the tests reachable from the files
  // being changed, falling back to the full discovered set when nothing matches.
  const targeted = affectedTests(snapshot, sourceFiles.filter((file) => fs.existsSync(path.join(snapshot.root, file.replace(/\\/g, "/")))));
  const tests = [...new Set(targeted.length ? targeted : allTests)].sort((a, b) => a.localeCompare(b));
  const checks: CheckSpec[] = sourceFiles.filter((file) => /\.[cm]?js$/.test(file)).map((file) => ({ kind: "syntax", file }));
  if (fs.existsSync(path.join(root, "tsconfig.json"))) checks.push({ kind: "typecheck" });
  checks.push({ kind: "test", files: tests.length <= 50 ? tests : [] }, { kind: "diff" });
  return checks;
}
