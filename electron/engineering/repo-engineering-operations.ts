import fs from "node:fs";
import { runAllowedCommand, type CommandSandbox } from "./command-runner";
import type { EngineeringFinding, EngineeringGoalContract, ReviewerFinding } from "../../src/shared/engineering-loop";
import type { EngineeringLoopOperations, EngineeringReviewEvidence } from "./engineering-loop-driver";
import { canonicalRealPathSync } from "../workspace/path-utils";

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
  review?: (finding: EngineeringFinding, changedFiles: string[], evidence: EngineeringReviewEvidence) => Promise<{ findings: ReviewerFinding[]; raw?: string }>;
  /**
   * Sanitized child environment (plan §9.2). Absent keeps the interactive path
   * byte-identical; the self-evolution coordinator always supplies one.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Hard execution sandbox (plan §9, §10). When supplied, every audit/build/test
   * child is created by the sandbox instead of `execFile`.
   */
  sandbox?: CommandSandbox;
}

/** Options threaded into every `runAllowedCommand` call this factory makes. */
function commandOptions(options: RepoEngineeringOptions): { env?: NodeJS.ProcessEnv; sandbox?: CommandSandbox } {
  const result: { env?: NodeJS.ProcessEnv; sandbox?: CommandSandbox } = {};
  if (options.env) result.env = options.env;
  if (options.sandbox) result.sandbox = options.sandbox;
  return result;
}

/**
 * Map a command failure into a deterministic engineering finding.
 *
 * Two kinds of failure come out of an allowed command and they must not be conflated:
 *
 *  - a **code** failure — the compiler or the tests ran and reported a problem in the project's own
 *    source. This is implementable, and the transcript names the files to look at;
 *  - an **environment** failure — the command could not run at all, because the workspace has no
 *    toolchain. `runAllowedCommand` reports this distinctly (`exitCode: null` and a "Required local
 *    tool unavailable" message) rather than as a crash, precisely so it stays tellable apart.
 *
 * Reporting the second as the first is PF-DEBT-009: a missing compiler was presented as a HIGH code
 * defect with no scope, so "the compiler is not installed" looked exactly like "the code does not
 * compile", and the loop consumed its iteration budget aborting on a fault no patch could fix.
 */
function commandFinding(command: "typecheck" | "test", evidence: { passed: boolean; output: string; exitCode: number | null }): EngineeringFinding {
  // An absent exit code means the process never ran at all. Two distinct reasons are known, and they
  // get distinct wording because they need distinct remedies: the tool is missing (install
  // dependencies) or the tool resolved outside the workspace (the guard refused it).
  const toolingMissing = /Required local tool unavailable/i.test(evidence.output);
  const neverRan = evidence.exitCode === null;
  if (toolingMissing || neverRan) {
    const cause = toolingMissing ? "the workspace is missing the tool this command runs" : "the command could not be launched in this workspace";
    return {
      id: `environment:${command}`,
      area: "environment",
      severity: "HIGH",
      kind: "environment",
      description: `the ${command} command could not run: ${cause} — ${evidence.output.slice(0, 240).replace(/\s+/g, " ")}`,
      evidence: `No source change can clear this. The audit runs the workspace's own tooling by absolute path, so the workspace has to be buildable BEFORE an audit of its source means anything.\n\n${evidence.output.slice(0, 1500)}`
    };
  }
  return {
    id: `command:${command}`,
    area: command === "typecheck" ? "build" : "tests",
    severity: "HIGH",
    kind: "code",
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
  const root = canonicalRealPathSync(options.workspace);
  const commandOptionsValue = commandOptions(options);
  return {
    async audit(goal) {
      // Real evidence: typecheck + full tests; failures are reproducible HIGH
      // findings. This is the honest audit baseline — never a model's opinion.
      const typecheck = await runAllowedCommand(root, "typecheck", [], commandOptionsValue);
      const test = await runAllowedCommand(root, "test", [], commandOptionsValue);
      const findings: EngineeringFinding[] = [];
      if (!typecheck.passed) findings.push(commandFinding("typecheck", typecheck));
      if (!test.passed) findings.push(commandFinding("test", test));
      return findings;
    },
    async build() {
      const typecheck = await runAllowedCommand(root, "typecheck", [], commandOptionsValue);
      return { passed: typecheck.passed, evidence: typecheck.output.slice(0, 2000) };
    },
    async test() {
      const test = await runAllowedCommand(root, "test", [], commandOptionsValue);
      return { passed: test.passed, evidence: test.output.slice(0, 3000) };
    },
    async implement(goal, finding) {
      if (!options.implement) return { changedFiles: [], error: "no coding editor configured for this goal" };
      return options.implement(finding);
    },
    async review(goal, finding, changedFiles, evidence) {
      if (!options.review) return { findings: [] };
      return options.review(finding, changedFiles, evidence);
    }
  };
}
