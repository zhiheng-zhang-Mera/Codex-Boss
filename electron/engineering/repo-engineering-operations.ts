import fs from "node:fs";
import path from "node:path";
import { runAllowedCommand } from "./command-runner";
import type { EngineeringFinding, EngineeringGoalContract } from "../../src/shared/engineering-loop";
import type { EngineeringLoopOperations } from "./engineering-loop-driver";

/**
 * Real repo-backed operations for the autonomous engineering loop (plan §26+).
 * audit/build/test run the actual allowed commands (typecheck, tests) against
 * the workspace and convert failures into deterministic HIGH findings; a
 * successful typecheck+tests with no scanned debt yields an empty finding set.
 *
 * `implement` is intentionally injected: production wires it to a real coding
 * worker (ProposalRunner + coder dispatch); tests use a deterministic editor.
 * The driver is never handed a fake editor, and the loop aborts (not closes)
 * when no editor is configured — model-done never becomes task-done.
 */

export interface RepoEngineeringOptions {
  workspace: string;
  /** Optional editor used to apply a bounded change for one finding. */
  implement?: (finding: EngineeringFinding) => Promise<{ changedFiles: string[]; error?: string }>;
  /** Optional independent reviewer of the merged diff. */
  review?: (finding: EngineeringFinding, changedFiles: string[]) => Promise<{ findings: string[] }>;
}

/** Map a command failure into a deterministic engineering finding. */
function commandFinding(command: "typecheck" | "test", evidence: { passed: boolean; output: string }): EngineeringFinding {
  return {
    id: `command:${command}`,
    area: command === "typecheck" ? "build" : "tests",
    severity: "HIGH",
    description: command === "typecheck"
      ? `typecheck failure in ${evidence.output.slice(0, 300).replace(/\s+/g, " ")}`
      : `test failure (see evidence)`,
    evidence: failureTail(evidence.output)
  };
}

/**
 * Failure text of a vitest/tsc transcript lives at the END of the output
 * (the pretty report is printed top-down). Slice the tail so the stored
 * evidence actually carries the failing test names/assertions.
 */
function failureTail(output: string, budget = 2500): string {
  if (output.length <= budget) return output;
  const tail = output.slice(-budget);
  const marker = tail.indexOf("\n");
  return `…(${output.length - budget} chars trimmed from head)\n${marker === -1 ? tail : tail.slice(marker + 1)}`;
}

export function createRepoEngineeringOperations(options: RepoEngineeringOptions): EngineeringLoopOperations {
  const root = fs.realpathSync(options.workspace);
  return {
    async audit(goal) {
      // Real evidence: typecheck + full tests; failures are reproducible HIGH
      // findings. This is the honest audit baseline — never a model's opinion.
      const typecheck = await runAllowedCommand(root, "typecheck");
      const test = await runAllowedCommand(root, "test");
      const findings: EngineeringFinding[] = [];
      if (!typecheck.passed) findings.push(commandFinding("typecheck", typecheck));
      if (!test.passed) findings.push(commandFinding("test", test));
      return findings;
    },
    async build() {
      const typecheck = await runAllowedCommand(root, "typecheck");
      return { passed: typecheck.passed, evidence: typecheck.output.slice(0, 2000) };
    },
    async test() {
      const test = await runAllowedCommand(root, "test");
      return { passed: test.passed, evidence: test.output.slice(0, 3000) };
    },
    async implement(goal, finding) {
      if (!options.implement) return { changedFiles: [], error: "no coding editor configured for this goal" };
      return options.implement(finding);
    },
    async review(goal, finding, changedFiles) {
      if (!options.review) return { findings: [] };
      return options.review(finding, changedFiles);
    }
  };
}
