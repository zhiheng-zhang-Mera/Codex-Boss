/**
 * Update-Plan/checkpoint-1.md §31 — the Verification Engine's decision layer.
 *
 * §31.1 is a ladder: syntax → typecheck → target unit tests → module tests →
 * integration → full test → build → benchmark → runtime smoke → desktop
 * black-box → visual runtime verification. §31.2 makes the ladder
 * **requirement-aware**: a UI requirement needs a screenshot/DOM/runtime proof, a
 * theme requirement needs the sandbox preview plus a fallback test, a performance
 * requirement needs the benchmark, persistence needs a restart, failure recovery
 * needs fault injection.
 *
 * This module is the part of that engine that can be decided without touching the
 * machine: which rungs a requirement must climb, in which order, with which
 * commands, and what each rung's result means. It is pure (no fs, no clock, no
 * process) so the ladder itself is testable; the host executor
 * (`electron/engineering/verification-engine.ts`) runs the commands and writes
 * the §31.3 ledger.
 *
 * Fail-closed rules that this module exists to enforce:
 *   - a rung with no runnable command on this host is reported as `unavailable`
 *     with a reason — never as a pass and never silently dropped;
 *   - evidence kinds the engine's rungs cannot produce (REVIEW, SCREENSHOT,
 *     PREVIEW) are reported as `external_evidence`, so the requirement stays
 *     unverified until the review layer (§32) or the theme capture (§17) supplies
 *     them;
 *   - a lying worker is not believed: `verifyChangeClaims` only accepts a claim
 *     that a real observation (git diff + hash + existence) confirms.
 */
import {
  requiredEvidenceKinds,
  type EvidenceKind,
  type RequirementNode,
  type RequirementsGraph
} from "./requirements-graph";
import { GATE_RANK, type VerificationGate } from "./execution-planner";
import { utf8Bytes } from "./hash";
import {
  evidenceKindForGate,
  type EvidenceEnvironment,
  type EvidenceInput,
  type GateOutcome
} from "./evidence-ledger";

export const VERIFICATION_PLAN_VERSION = "verification-plan-1" as const;

/* ------------------------------------------------------------------ *
 * §31.1 the ladder
 * ------------------------------------------------------------------ */

/**
 * The eleven rungs of §31.1, cheapest first. `GATE_RANK` (execution-planner) is
 * the same order; the assertion below keeps the two from drifting apart.
 */
export const VERIFICATION_LADDER = [
  "SYNTAX", "TYPECHECK", "UNIT", "MODULE", "INTEGRATION", "FULL", "BUILD",
  "BENCHMARK", "RUNTIME", "BLACKBOX", "VISUAL"
] as const;

export type LadderRung = (typeof VERIFICATION_LADDER)[number];

/** §31.1: what each rung actually costs the host. */
export const LADDER_COST: Readonly<Record<LadderRung, "cheap" | "medium" | "expensive">> = {
  SYNTAX: "cheap", TYPECHECK: "medium", UNIT: "medium", MODULE: "medium",
  INTEGRATION: "expensive", FULL: "expensive", BUILD: "expensive",
  BENCHMARK: "expensive", RUNTIME: "expensive", BLACKBOX: "expensive", VISUAL: "expensive"
};

/** Ascending ladder position; gates outside the ladder sort last. */
export function ladderPosition(gate: VerificationGate): number {
  const index = (VERIFICATION_LADDER as readonly string[]).indexOf(gate);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

/** Cheapest-first ordering, deduplicated. Never invents a gate. */
export function orderByLadder(gates: readonly VerificationGate[]): VerificationGate[] {
  return [...new Set(gates)].sort((left, right) => ladderPosition(left) - ladderPosition(right) || GATE_RANK[left] - GATE_RANK[right]);
}

/* ------------------------------------------------------------------ *
 * §31.2 requirement-aware selection
 * ------------------------------------------------------------------ */

/** Host-declared commands. A gate whose command is missing cannot be climbed. */
export interface VerificationCommands {
  syntax?: string;
  typecheck?: string;
  unit?: string;
  build?: string;
  /** Named test files the host may target. */
  tests?: string[];
  /** Named integration/e2e entry points, when the repository has them. */
  integration?: string[];
  build_tools?: string[];
}

/** Harnesses the host can actually drive. Absent ⇒ the rung stays unavailable. */
export interface VerificationHarnesses {
  benchmark?: boolean;
  runtime?: boolean;
  blackbox?: boolean;
  visual?: boolean;
  /** Fault-injection entry point for §31.2 "failure recovery". */
  fault_injection?: boolean;
}

export interface GateDecision {
  gate: VerificationGate;
  /** Why this rung is required, in the plan's own vocabulary. */
  reason: string;
  /** The concrete command the host would run, when it has one. */
  command?: string;
}

export interface UnavailableGate {
  gate: VerificationGate;
  reason: string;
}

export interface GateSelection {
  requirement_id: string;
  /** Chosen rungs, cheapest first. */
  gates: GateDecision[];
  /** §28.4 kinds these rungs can produce. */
  required_evidence: EvidenceKind[];
  /** §28.4 kinds no runnable rung of this engine can produce. */
  external_evidence: EvidenceKind[];
  /** Rungs the requirement demands but this host cannot climb. */
  unavailable: UnavailableGate[];
  /** Text signals that drove the decision, so it is auditable. */
  signals: string[];
}

export interface VerificationPlanFile {
  schemaVersion: 1;
  version: typeof VERIFICATION_PLAN_VERSION;
  requirements: GateSelection[];
  diagnostics: string[];
  created_at: string;
}

export interface SelectionInput {
  requirement: VerifiableRequirement;
  commands?: VerificationCommands;
  harnesses?: VerificationHarnesses;
}

/**
 * The part of a §28 requirement the verification engine reads. `state` is
 * optional so callers can plan an ad-hoc requirement without a graph.
 */
export interface VerifiableRequirement extends Pick<RequirementNode, "id" | "type" | "text" | "visual"> {
  state?: RequirementNode["state"];
}

/* Text signals. §31.2 names the categories; a workbook may write them in either
 * language this product is used in, so both are recognised. */
const SIGNALS: { name: string; pattern: RegExp }[] = [
  { name: "performance", pattern: /(performanc|latenc|throughput|benchmark|p9[0-9]|\bms\b|millisecond|毫秒|性能|延迟|吞吐|响应时间)/i },
  { name: "persistence", pattern: /(persist|restart|durable|survive[sd]? a? ?(re)?start|重启|持久|持久化|重启后|崩溃恢复)/i },
  { name: "recovery", pattern: /(recover|fall ?s? ?back|fails?\b|failure|fault inject|failover|graceful|degrad|容错|降级|回退|失败后|恢复|注入故障)/i },
  { name: "integration", pattern: /(integration|end[- ]to[- ]end|\be2e\b|集成)/i },
  { name: "module", pattern: /(module test|module-level|跨模块|模块级)/i },
  { name: "regression", pattern: /(full (test )?suite|regression|全部测试|全量测试|回归)/i },
  { name: "theme", pattern: /(theme|配色|主题|皮肤)/i },
  { name: "appearance", pattern: /(screenshot|截图|render|渲染|appearance|外观|visual|视觉|界面|布局|dom)/i },
  { name: "desktop", pattern: /(desktop|electron|window|桌面|窗口|应用内)/i }
];

export function signalsOf(text: string): string[] {
  return SIGNALS.filter((signal) => signal.pattern.test(text)).map((signal) => signal.name);
}

function commandFor(gate: VerificationGate, commands: VerificationCommands | undefined): string | undefined {
  if (!commands) return undefined;
  if (gate === "SYNTAX") return commands.syntax;
  if (gate === "TYPECHECK") return commands.typecheck;
  if (gate === "UNIT" || gate === "MODULE") {
    const targeted = (commands.tests ?? []).slice(0, 8);
    if (targeted.length) return `unit test ${targeted.join(" ")}`;
    return commands.unit;
  }
  if (gate === "INTEGRATION") return (commands.integration ?? []).length ? `integration test ${(commands.integration ?? []).join(" ")}` : undefined;
  if (gate === "FULL") return commands.unit ?? undefined;
  if (gate === "BUILD") return commands.build;
  return undefined;
}

/**
 * §31.2: chooses the rungs one requirement must climb.
 *
 * The base of the ladder is always attempted when the host can run it, because a
 * cheap rung that fails makes every expensive rung above it meaningless. On top
 * of that base the requirement's type, its declared evidence needs and its own
 * wording add rungs. Nothing is added "because it might help": every added rung
 * carries the reason that put it there.
 */
export function selectGates(input: SelectionInput): GateSelection {
  const { requirement, commands, harnesses } = input;
  const signals = signalsOf(requirement.text);
  const required = new Set<EvidenceKind>(requiredEvidenceKinds(requirement));
  const decisions: GateDecision[] = [];
  const unavailable: UnavailableGate[] = [];
  const add = (gate: VerificationGate, reason: string): void => {
    if (decisions.some((decision) => decision.gate === gate)) return;
    const command = commandFor(gate, commands);
    const decision: GateDecision = { gate, reason };
    if (command) decision.command = command;
    decisions.push(decision);
  };
  const needHarness = (gate: VerificationGate, harness: "benchmark" | "runtime" | "blackbox" | "visual", reason: string): void => {
    if (harnesses?.[harness]) add(gate, reason);
    else unavailable.push({ gate, reason: `${reason} — but no ${harness} harness is attached to this host, so the rung cannot be climbed` });
  };

  // §31.1 base: syntax then typecheck, when the host has them.
  if (commands?.syntax) add("SYNTAX", "§31.1 the ladder starts at syntax");
  else unavailable.push({ gate: "SYNTAX", reason: "the workspace declares no syntax command" });
  if (commands?.typecheck || (commands?.build_tools ?? []).includes("tsc")) add("TYPECHECK", "§31.1 the second rung is a typecheck");
  else unavailable.push({ gate: "TYPECHECK", reason: "the workspace declares no typecheck command and no TypeScript compiler" });

  const needsTest = required.has("TEST");
  if (needsTest) {
    const targeted = (commands?.tests ?? []).slice(0, 8);
    if (targeted.length || commands?.unit) add("UNIT", `§31.2 the requirement (${requirement.type}) needs a test gate`);
    else unavailable.push({ gate: "UNIT", reason: "the workspace declares no unit test command and no test files" });
    if (signals.includes("module")) add("MODULE", "the requirement talks about module boundaries");
    if (signals.includes("integration")) add("INTEGRATION", "the requirement is about integration/end-to-end behaviour");
    if (signals.includes("regression")) add("FULL", "the requirement demands the full suite");
  }

  // §31.2 performance → benchmark; persistence → restart; recovery → fault injection.
  if (signals.includes("performance") || requirement.type === "NON_FUNCTIONAL") {
    needHarness("BENCHMARK", "benchmark", "§31.2 a performance requirement needs a benchmark");
  }
  if (signals.includes("persistence")) needHarness("RUNTIME", "runtime", "§31.2 persistence is only proven by a restart");
  if (signals.includes("recovery")) {
    if (harnesses?.fault_injection) add("INTEGRATION", "§31.2 failure recovery needs fault injection");
    else unavailable.push({ gate: "INTEGRATION", reason: "§31.2 failure recovery needs fault injection — but no fault-injection harness is attached to this host" });
  }

  // §31.2 UI/theme → runtime + preview + screenshot; the desktop black box is the
  // strongest such rung when the host can drive the real application.
  const visual = requirement.visual || requirement.type === "VISUAL" || signals.includes("appearance");
  const theme = signals.includes("theme");
  if (visual || theme) {
    // A visual claim needs something built to look at.
    if (commands?.build) add("BUILD", "§31.1 the visual rungs need a build");
    else unavailable.push({ gate: "BUILD", reason: "the visual rungs need a build and the workspace declares no build command" });
    if (theme) {
      needHarness("VISUAL", "visual", "§31.2 a theme requirement needs the sandbox preview and its visual check");
      const fallback = commandFor("UNIT", commands);
      if (fallback) add("UNIT", "§31.2 a theme requirement also needs the fallback test");
      if (harnesses?.runtime) add("RUNTIME", "§31.2 the theme preview runs inside the real application");
    }
    if (signals.includes("desktop") && harnesses?.blackbox) {
      needHarness("BLACKBOX", "blackbox", "§31.2 a desktop UI requirement is proven by the real application");
    } else if (!theme) {
      needHarness("RUNTIME", "runtime", "§31.2 a UI requirement needs a runtime/DOM check");
    }
  } else if (required.has("VISUAL_VERIFICATION") || required.has("PREVIEW") || required.has("SCREENSHOT")) {
    needHarness("VISUAL", "visual", "§31.2 the requirement declares visual evidence");
  }

  // §28.4 kinds that this engine's rungs cannot produce stay honest gaps.
  const producible = new Set<EvidenceKind>();
  for (const decision of decisions) {
    for (const kind of evidenceKindForGate(decision.gate)) producible.add(kind);
  }
  const external = [...required].filter((kind) => !producible.has(kind)).sort();
  const gates = orderByLadder(decisions.map((decision) => decision.gate));
  const ordered = gates.map((gate) => decisions.find((decision) => decision.gate === gate)!);
  // A rung that was chosen with a real command is climbable; only rungs with no
  // command and no harness stay on the unavailable list.
  const chosen = new Set(gates);
  const seenUnavailable = new Set<VerificationGate>();
  return {
    requirement_id: requirement.id,
    gates: ordered,
    required_evidence: [...required].sort(),
    external_evidence: external,
    unavailable: unavailable
      .filter((entry) => {
        if (chosen.has(entry.gate) || seenUnavailable.has(entry.gate)) return false;
        seenUnavailable.add(entry.gate);
        return true;
      })
      .sort((left, right) => ladderPosition(left.gate) - ladderPosition(right.gate)),
    signals
  };
}

/** §31.2 for a whole graph. Quarantined requirements are planned but flagged. */
export function planVerification(input: {
  requirements: { nodes: readonly VerifiableRequirement[] };
  commands?: VerificationCommands;
  harnesses?: VerificationHarnesses;
  now?: string;
}): VerificationPlanFile {
  const diagnostics: string[] = [];
  const requirements = input.requirements.nodes
    .map((node) => selectGates({ requirement: node, ...(input.commands ? { commands: input.commands } : {}), ...(input.harnesses ? { harnesses: input.harnesses } : {}) }))
    .sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));
  const single = requirements.filter((selection) => selection.gates.length <= 1);
  if (single.length) diagnostics.push(`${single.length} requirement(s) can only climb one rung on this host: ${single.slice(0, 6).map((selection) => selection.requirement_id).join(", ")}`);
  for (const quarantine of input.requirements.nodes.filter((node) => node.state === "QUARANTINED")) {
    diagnostics.push(`${quarantine.id} is QUARANTINED: §28.3 forbids verifying it before the conflict is resolved`);
  }
  return {
    schemaVersion: 1,
    version: VERIFICATION_PLAN_VERSION,
    requirements,
    diagnostics,
    created_at: input.now ?? new Date(0).toISOString()
  };
}

/* ------------------------------------------------------------------ *
 * §30.1 bounded worker scope
 * ------------------------------------------------------------------ */

export interface WorkerScope {
  /** Repository-relative files the worker may write. Empty ⇒ no write at all. */
  allowed_files: string[];
  /** Host commands the worker may ask for. */
  allowed_commands: ("syntax" | "typecheck" | "unit" | "build" | "test")[];
  workspace: string;
  requirement_ids: string[];
}

/** §30.1: a worker's scope comes from its plan node; an unresolvable scope is empty. */
export function boundedScopeFor(node: {
  allowed_files: readonly string[];
  requirements: readonly string[];
  verification?: { commands?: readonly string[] };
}): WorkerScope {
  const allowedFiles = [...new Set(node.allowed_files)].sort();
  const commands = new Set<WorkerScope["allowed_commands"][number]>();
  // The worker may only ask for gates the host itself attached to the node's plan.
  for (const command of node.verification?.commands ?? []) {
    if (/typecheck/i.test(command)) commands.add("typecheck");
    if (/\bbuild\b/i.test(command)) commands.add("build");
    if (/test|vitest/i.test(command)) commands.add("test");
  }
  if (allowedFiles.length) { commands.add("syntax"); commands.add("typecheck"); }
  return { allowed_files: allowedFiles, allowed_commands: [...commands].sort(), workspace: "", requirement_ids: [...node.requirements] };
}

/* ------------------------------------------------------------------ *
 * §30.2 real file verification (the pure half)
 * ------------------------------------------------------------------ */

export interface ChangeClaim {
  path: string;
  /** sha256 the worker claims its new content has. */
  claimed_sha256?: string | null;
}

/** What the host actually observed on disk and in git. */
export interface ChangeObservation {
  path: string;
  exists: boolean;
  /** sha256 of the file as it now is on disk. */
  sha256?: string;
  /** True when `git diff --name-only` reports the path as modified. */
  modified: boolean;
  /**
   * True when the applied change unit itself recorded a different hash before and
   * after. A change that restores a file to its committed content leaves no diff
   * against HEAD, so git alone would deny a modification that really happened.
   */
  changed_by_unit?: boolean;
}

export interface ClaimVerdict {
  path: string;
  ok: boolean;
  problem?: string;
}

/**
 * §30.2/§2.3: turns "the worker says it changed X" into a verified fact.
 *
 * A claim survives only when the file exists, git reports it modified and the
 * content hash matches what the worker claimed. A worker that reports a change it
 * did not make fails here instead of being credited with it.
 */
export function verifyChangeClaims(
  claims: readonly ChangeClaim[],
  observations: readonly ChangeObservation[],
  options: { requiresGitDiff?: boolean } = {}
): ClaimVerdict[] {
  const byPath = new Map(observations.map((observation) => [observation.path, observation]));
  return claims.map((claim) => {
    const observed = byPath.get(claim.path);
    if (!observed) return { path: claim.path, ok: false, problem: "the host never observed this path" };
    if (!observed.exists) return { path: claim.path, ok: false, problem: "the claimed file does not exist" };
    if (options.requiresGitDiff !== false && !observed.modified && !observed.changed_by_unit) {
      return { path: claim.path, ok: false, problem: "git reports the file unchanged, so the claimed modification did not happen" };
    }
    if (claim.claimed_sha256 && observed.sha256 && claim.claimed_sha256 !== observed.sha256) {
      return { path: claim.path, ok: false, problem: `content hash mismatch: claimed ${claim.claimed_sha256.slice(0, 12)}…, found ${observed.sha256.slice(0, 12)}…` };
    }
    return { path: claim.path, ok: true };
  });
}

/** §30.3: why a change unit may not be applied, as a list of reasons. */
export function changeUnitProblems(
  unit: { changes: readonly { path: string; content: string }[] },
  scope: Pick<WorkerScope, "allowed_files">
): string[] {
  const problems: string[] = [];
  if (!unit.changes.length) problems.push("the change unit is empty");
  if (unit.changes.length > 50) problems.push(`the change unit touches ${unit.changes.length} files (limit 50)`);
  const seen = new Set<string>();
  for (const change of unit.changes) {
    if (seen.has(change.path)) problems.push(`${change.path} appears twice in the change unit`);
    seen.add(change.path);
    if (!scope.allowed_files.includes(change.path)) problems.push(`${change.path} is outside the granted scope`);
    if (/(^|[\\/])(?:\.git|\.codex|\.agents|AGENTS\.md)([\\/]|$)/i.test(change.path)) problems.push(`${change.path} is protected workspace metadata`);
    if (utf8Bytes(change.content).length > 1_000_000) problems.push(`${change.path} exceeds the one-megabyte change budget`);
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * §31.1 climbing: results → ledger
 * ------------------------------------------------------------------ */

export interface GateRun {
  gate: VerificationGate;
  command: string;
  result: GateOutcome;
  exit_code?: number;
  duration_ms?: number;
  artifact?: string;
  artifact_hash?: string;
  detail?: string;
}

export interface LadderOutcome {
  outcome: GateOutcome;
  /** Rungs that were executed, cheapest first. */
  ran: GateRun[];
  /** Rungs that were deliberately not attempted because a cheaper one failed. */
  skipped: GateDecision[];
  failed_at?: VerificationGate;
  reason: string;
}

/**
 * §31.1/§2.5: the verdict of one requirement's climb.
 *
 * The cheapest failing rung decides: the rungs above it are SKIPPED with the
 * reason "a cheaper rung failed", because a failure at syntax makes a build
 * result meaningless. A rung that could not run at all is NOT_RUN, never PASS.
 */
export function ladderOutcome(selection: GateSelection, runs: readonly GateRun[]): LadderOutcome {
  const skipped: GateDecision[] = [];
  let failure: GateRun | undefined;
  for (const decision of selection.gates) {
    const run = runs.find((entry) => entry.gate === decision.gate);
    if (!run) { skipped.push(decision); continue; }
    if (run.result === "FAIL") { failure = run; break; }
  }
  if (failure) {
    const index = selection.gates.findIndex((decision) => decision.gate === failure!.gate);
    for (const decision of selection.gates.slice(index + 1)) skipped.push(decision);
    return {
      outcome: "FAIL",
      ran: selection.gates.map((decision) => runs.find((entry) => entry.gate === decision.gate)).filter((run): run is GateRun => run !== undefined),
      skipped,
      failed_at: failure.gate,
      reason: `§31.1 climbing stopped at ${failure.gate}: ${failure.detail ?? failure.command}`
    };
  }
  const ran = selection.gates.map((decision) => runs.find((entry) => entry.gate === decision.gate)).filter((run): run is GateRun => run !== undefined);
  const notRun = ran.filter((run) => run.result === "NOT_RUN" || run.result === "SKIPPED");
  if (!ran.length) return { outcome: "NOT_RUN", ran, skipped, reason: "no rung of the ladder could be run on this host" };
  if (notRun.length === ran.length) return { outcome: "NOT_RUN", ran, skipped, reason: `every rung reported NOT_RUN: ${notRun.map((run) => run.gate).join(", ")}` };
  // Only a rung that actually passed may be named as the strongest one.
  const passed = ran.filter((run) => run.result === "PASS");
  const strongest = passed.reduce((winner, run) => (ladderPosition(run.gate) > ladderPosition(winner.gate) ? run : winner), passed[0]!);
  return {
    outcome: "PASS",
    ran,
    skipped,
    reason: `§31.1 the requirement passed ${passed.length} rung(s), strongest ${strongest.gate}`
  };
}

/** §31.3: the ledger rows one requirement's climb produces (SKIPPED rows included). */
export function evidenceInputsForRun(
  selection: GateSelection,
  outcome: LadderOutcome,
  environment: EvidenceEnvironment,
  captured_at: string
): EvidenceInput[] {
  const inputs: EvidenceInput[] = outcome.ran.map((run) => {
    const input: EvidenceInput = {
      requirement_ids: [selection.requirement_id],
      gate: run.gate,
      command: run.command,
      environment,
      result: run.result,
      captured_at
    };
    if (run.exit_code !== undefined) input.exit_code = run.exit_code;
    if (run.artifact) input.artifact = run.artifact;
    if (run.artifact_hash) input.artifact_hash = run.artifact_hash;
    if (run.duration_ms !== undefined) input.duration_ms = run.duration_ms;
    if (run.detail) input.detail = run.detail;
    return input;
  });
  // A skipped rung is recorded as SKIPPED, not omitted: the ledger must show the
  // difference between "not needed" and "not attempted because something broke".
  for (const decision of outcome.skipped) {
    const entry: EvidenceInput = {
      requirement_ids: [selection.requirement_id],
      gate: decision.gate,
      command: decision.command ?? decision.reason,
      environment,
      result: outcome.failed_at ? "SKIPPED" : "NOT_RUN",
      captured_at,
      detail: outcome.failed_at ? `not attempted: ${outcome.failed_at} failed first` : "not attempted: no command or harness for this rung"
    };
    inputs.push(entry);
  }
  return inputs;
}

/**
 * §31.2: the evidence kinds the engine cannot produce for this selection.
 *
 * Kept as its own function because it is the honest refusal list a caller shows
 * the Owner: "this requirement needs a screenshot; the verification engine does
 * not take screenshots".
 */
export function evidenceGaps(selection: GateSelection): EvidenceKind[] {
  return [...selection.external_evidence];
}
