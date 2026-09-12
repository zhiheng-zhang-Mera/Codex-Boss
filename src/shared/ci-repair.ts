/**
 * Update-Plan/checkpoint-1.md §41 — the CI repair loop.
 *
 * The plan's flow is: CI → PASS? yes → Final Gate; no → parse the failure →
 * classify → repair → verify locally → push → CI again, until PASS or a Hard
 * Blocker.
 *
 * This module is the part that can be decided from real bytes: the parser reads a
 * CI log and extracts the failing step, the diagnostics, the tests and the exit
 * code; the classifier hands that to §33's failure model; and the planner says
 * which local gates must be re-run and whether the loop may continue at all.
 *
 * Three rules keep a repair loop honest: a CI read that *failed* is never a pass,
 * the loop is bounded by §33.2's step budgets (a repeated identical failure cannot
 * be retried forever), and a terminal failure (a policy refusal, a leaked secret)
 * goes straight to the Hard Blocker instead of being repaired.
 *
 * Pure: no fs, no network, no clock.
 */
import { contentHashOf } from "./workbook";
import { utf8Bytes } from "./hash";
import { advanceRecovery, classifyFailure, planRecovery, type FailureClassification, type FailureObservation, type RecoveryAttempt, type RecoveryProgress } from "./recovery";

export const CI_REPAIR_VERSION = "ci-repair-1" as const;

export interface CiRunDescriptor {
  workflow?: string;
  job?: string;
  branch?: string;
  head_sha?: string;
  conclusion?: string;
}

export interface ParsedCiFailure {
  descriptor: CiRunDescriptor;
  /** The step CI reported as failed, when the log names one. */
  step?: string;
  /** Commands the log shows CI running. */
  commands: string[];
  /** Compiler/lint diagnostics with their file and line. */
  issues: { code?: string; file?: string; line?: number; message: string }[];
  /** Test failures the log shows. */
  tests: { name: string; message?: string }[];
  annotations: string[];
  exit_code?: number;
  log_bytes: number;
  /** Stable identity of this failure, so repeating the same one is recognisable. */
  signature: string;
  /** True when the log itself shows CI could not even start (a configuration fault). */
  infrastructure: boolean;
}

const DIAGNOSTIC = /^(?<file>[^\s(]+\.(?:ts|tsx|js|mjs|cjs|jsx))\((?<line>\d+),\d+\):\s*(?<severity>error|warning)\s+(?<code>TS\d+|[A-Z]+\d+):\s*(?<message>.+)$/;
const DIAGNOSTIC_ALT = /^(?<file>[^\s:]+\.(?:ts|tsx|js|mjs|cjs|jsx)):(?<line>\d+):\d+:\s*(?<severity>error|warning)\s+(?<code>[A-Z]+\d+)?:?\s*(?<message>.+)$/;
const TEST_FAIL = /^\s*(?:✗|✖|×|not ok|FAIL)\s+(?<name>.+?)(?:\s+\(\d+(?:\.\d+)?\s*ms\))?$/;
const ASSERTION = /^\s*(?:AssertionError|Error)\s*[:[]\s*(?<message>.+)$/;
const EXIT_CODE = /Process completed with exit code (\d+)/i;const STEP = /^##\[(?:error|group)\](?<name>.+)$/;
const COMMAND = /^\s*Run\s+(?<command>\S.*)$/;

/**
 * §41 "parse failure": reads a CI log as it is, without guessing what CI meant.
 *
 * Lines that look like diagnostics, test failures, assertions, workflow steps and
 * commands are kept with their text; anything else is ignored, so an unfamiliar log
 * produces an empty-but-honest parse rather than an invented cause.
 */
export function parseCiFailure(input: { log: string; descriptor?: CiRunDescriptor }): ParsedCiFailure {
  const log = input.log ?? "";
  const lines = log.split(/\r?\n/);
  const issues: ParsedCiFailure["issues"] = [];
  const tests: ParsedCiFailure["tests"] = [];
  const annotations: string[] = [];
  const commands: string[] = [];
  let step: string | undefined;
  let exitCode: number | undefined;
  let pendingTest: string | undefined;

  for (const raw of lines) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
    const stepMatch = STEP.exec(line.trim());
    if (stepMatch?.groups?.name) step = stepMatch.groups.name.trim();
    const commandMatch = COMMAND.exec(line);
    if (commandMatch?.groups?.command) {
      const command = commandMatch.groups.command.trim();
      if (!commands.includes(command)) commands.push(command);
    }
    const diagnostic = DIAGNOSTIC.exec(line) ?? DIAGNOSTIC_ALT.exec(line);
    if (diagnostic?.groups) {
      const entry: ParsedCiFailure["issues"][number] = { message: diagnostic.groups.message?.trim() ?? line.trim() };
      if (diagnostic.groups.file) entry.file = diagnostic.groups.file;
      if (diagnostic.groups.line) entry.line = Number(diagnostic.groups.line);
      if (diagnostic.groups.code) entry.code = diagnostic.groups.code;
      issues.push(entry);
      continue;
    }
    const testFail = TEST_FAIL.exec(line);
    if (testFail?.groups?.name) {
      pendingTest = testFail.groups.name.trim();
      tests.push({ name: pendingTest });
      continue;
    }
    // The exit code is read BEFORE the assertion pattern: CI wraps its own message
    // as "Error: Process completed with exit code 1", which is not an assertion.
    const exit = EXIT_CODE.exec(line);
    if (exit?.[1]) {
      exitCode = Number(exit[1]);
      if (annotations.length < 20) annotations.push(line.trim());
      continue;
    }
    const assertion = ASSERTION.exec(line);
    if (assertion?.groups?.message) {
      const message = assertion.groups.message.trim().replace(/\]$/, "");
      if (pendingTest && tests.length && !tests[tests.length - 1]!.message) tests[tests.length - 1]!.message = message;
      else annotations.push(message);
      pendingTest = undefined;
      continue;
    }
    if (/^Error:/i.test(line.trim()) && annotations.length < 20) annotations.push(line.trim());
  }

  const touchedFiles = [...new Set(issues.map((issue) => issue.file).filter((file): file is string => Boolean(file)))];
  const signature = contentHashOf(JSON.stringify({
    step: step ?? "",
    codes: [...new Set(issues.map((issue) => issue.code ?? ""))].sort(),
    files: touchedFiles.sort(),
    tests: tests.map((test) => test.name).sort(),
    exit: exitCode ?? null
  }));
  return {
    descriptor: input.descriptor ?? {},
    ...(step ? { step } : {}),
    commands,
    issues,
    tests,
    annotations,
    ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
    log_bytes: utf8Bytes(log).length,
    signature,
    infrastructure: issues.length === 0 && tests.length === 0 && /(could not resolve|failed to (?:start|set up)|no such file or directory: .*(?:node|pnpm|npm))/i.test(log)
  };
}

/** §41 "classify": the parsed failure in §33's vocabulary. */
export function ciObservationFor(parsed: ParsedCiFailure): FailureObservation {
  const detail = [
    parsed.step ? `step: ${parsed.step}` : "",
    ...parsed.issues.slice(0, 6).map((issue) => `${issue.file ?? "?"}(${issue.line ?? 0}): ${issue.code ?? "error"}: ${issue.message}`),
    ...parsed.tests.slice(0, 4).map((test) => `failing test: ${test.name}${test.message ? ` — ${test.message}` : ""}`),
    ...parsed.annotations.slice(0, 3)
  ].filter(Boolean).join("\n");
  const observation: FailureObservation = { detail };
  if (parsed.exit_code !== undefined) observation.exit_code = parsed.exit_code;
  if (parsed.tests.length) observation.gate = "UNIT";
  else if (parsed.issues.some((issue) => issue.code?.startsWith("TS"))) observation.gate = "TYPECHECK";
  else if (/\bsecret\b|secret-scan|scan-tracked-secrets/i.test(detail)) observation.policy_refusal = "CI reported a secret-scan failure";
  return observation;
}

export function classifyCiFailure(parsed: ParsedCiFailure): FailureClassification {
  if (parsed.infrastructure) {
    return {
      failure_class: "ENVIRONMENT",
      confidence: 0.8,
      reason: "CI could not even start the job, so the failure is the runner's environment rather than the change",
      signals: ["ci:infrastructure", `step:${parsed.step ?? "unknown"}`],
      severity: "HIGH"
    };
  }
  return classifyFailure(ciObservationFor(parsed));
}

/** Which local gates must pass again before the fix may be pushed (§41 "local verify"). */
const LOCAL_GATES: Readonly<Record<string, readonly string[]>> = {
  BUILD: ["TYPECHECK"],
  TEST: ["UNIT"],
  DEPENDENCY: ["TYPECHECK"],
  WORKSPACE: ["SYNTAX", "TYPECHECK"],
  THEME: ["TYPECHECK", "UNIT"],
  UI: ["UNIT"],
  ENVIRONMENT: ["TYPECHECK"],
  TRANSIENT: [],
  AUTH: [],
  RATE_LIMIT: [],
  PROVIDER_PAGE: [],
  TERMINAL: [],
  UNKNOWN: ["TYPECHECK", "UNIT"]
};

export interface CiRepairPlan {
  schemaVersion: 1;
  version: typeof CI_REPAIR_VERSION;
  decision: "REPAIR" | "HARD_BLOCKER";
  failure_class: FailureClassification["failure_class"];
  severity: FailureClassification["severity"];
  /** The gates to re-run locally before pushing again. */
  local_gates: string[];
  /** Files and tests the failure points at, so the repair is scoped. */
  targets: string[];
  progress: RecoveryProgress;
  signature: string;
  reasons: string[];
}

/**
 * §41's decision for one CI failure.
 *
 * A terminal failure blocks instead of repairing, and the loop's remaining budget
 * comes from §33.2/§33.3 rather than from a counter invented here.
 */
export function planCiRepair(input: { parsed: ParsedCiFailure; attempts: readonly RecoveryAttempt[] }): CiRepairPlan {
  const classification = classifyCiFailure(input.parsed);
  const plan = planRecovery(classification);
  const progress = advanceRecovery(plan, input.attempts);
  const gates = LOCAL_GATES[classification.failure_class] ?? [];
  const reasons: string[] = [classification.reason];
  const targets = [
    ...new Set([
      ...input.parsed.issues.map((issue) => issue.file).filter((file): file is string => Boolean(file)),
      ...input.parsed.tests.map((test) => test.name)
    ])
  ];
  const hardBlocked = classification.failure_class === "TERMINAL" || progress.hard_blocker || progress.next === "HARD_BLOCKER";
  if (classification.failure_class === "TERMINAL") reasons.push("a prohibited or policy-refused failure is not repaired: the Hard Blocker hands it to the Owner");
  if (progress.hard_blocker) reasons.push(progress.reason);
  if (!gates.length && !hardBlocked) reasons.push("this failure class has no local gate to re-run, so the repair is a retry rather than a code change");
  return {
    schemaVersion: 1,
    version: CI_REPAIR_VERSION,
    decision: hardBlocked ? "HARD_BLOCKER" : "REPAIR",
    failure_class: classification.failure_class,
    severity: classification.severity,
    local_gates: [...gates],
    targets,
    progress,
    signature: input.parsed.signature,
    reasons
  };
}

/** §41 "CI: PASS?" — only a success counts, and a failed read is not a success. */
export function ciVerdict(read: { ok: boolean; conclusion?: string; reason?: string }): { passed: boolean; reason: string } {
  if (!read.ok) return { passed: false, reason: `§41: the CI result could not be read (${read.reason ?? "unknown"}), which is not a pass` };
  if (read.conclusion !== "success") return { passed: false, reason: `§41: CI concluded ${read.conclusion ?? "unknown"}` };
  return { passed: true, reason: "§41: CI concluded success" };
}

/** §41: the loop stops at PASS or at a Hard Blocker, never by quietly giving up. */
export type CiLoopOutcome = "PASS" | "HARD_BLOCKER" | "IN_PROGRESS";

export function loopOutcome(input: { verdict: { passed: boolean }; plan?: CiRepairPlan; attemptsUsed: number; maxAttempts: number }): CiLoopOutcome {
  if (input.verdict.passed) return "PASS";
  if (input.plan?.decision === "HARD_BLOCKER") return "HARD_BLOCKER";
  if (input.attemptsUsed >= input.maxAttempts) return "HARD_BLOCKER";
  return "IN_PROGRESS";
}
