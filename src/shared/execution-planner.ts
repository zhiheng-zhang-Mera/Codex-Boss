/**
 * Update-Plan/checkpoint-1.md §29 — the dependency-aware Execution Planner.
 *
 * §29 upgrades the old task splitter into a planner whose output is an
 * **Execution DAG**. Every node must carry: objective, requirements, inputs,
 * scope, allowed files, expected outputs, verification, dependencies, rollback
 * (§29.1). Independent nodes run in parallel, dependent ones stay ordered
 * (§29.2), and the concurrency level is **never hardcoded** — it is derived from
 * CPU, memory, GPU, available providers, rate limits, active tasks and system
 * load (§29.3).
 *
 * The planner is pure: it consumes the §28 requirements graph plus whatever the
 * host observed about the repository (files, tests, commands). It never guesses
 * a file scope: a node whose scope cannot be resolved to real files says so and
 * is refused write permission instead of being handed the whole repository.
 */
import { EVIDENCE_KINDS, type EvidenceKind, type RequirementsGraph } from "./requirements-graph";

export const EXECUTION_PLAN_VERSION = "execution-plan-1" as const;

/* ------------------------------------------------------------------ *
 * §29.1 nodes
 * ------------------------------------------------------------------ */

/**
 * §31.1 rungs, cheapest first. `BENCHMARK` and `BLACKBOX` were added by
 * checkpoint-8's verification engine so the ladder in the plan is expressible
 * without faking it: a benchmark is a measured command, and the desktop
 * black-box smoke is the real-app runtime gate.
 */
export const VERIFICATION_GATES = [
  "SYNTAX", "TYPECHECK", "UNIT", "MODULE", "INTEGRATION", "FULL", "BUILD",
  "BENCHMARK", "RUNTIME", "BLACKBOX", "VISUAL"
] as const;
export type VerificationGate = (typeof VERIFICATION_GATES)[number];

/** The ladder position of each gate, so "at least TYPECHECK" is expressible. */
export const GATE_RANK: Readonly<Record<VerificationGate, number>> = {
  SYNTAX: 1, TYPECHECK: 2, UNIT: 3, MODULE: 4, INTEGRATION: 5, FULL: 6, BUILD: 7,
  BENCHMARK: 8, RUNTIME: 9, BLACKBOX: 10, VISUAL: 11
};

export interface VerificationPlan {
  /** Cheapest gate that must pass for this node. */
  gate: VerificationGate;
  /** Concrete commands the host will run (never a claim). */
  commands: string[];
  /** Evidence kinds the §28.4 binding will demand for this node's needs. */
  required_evidence: EvidenceKind[];
}

export interface ExecutionNode {
  id: string;
  /** What this node is for, in one line. */
  objective: string;
  kind: "IMPLEMENT" | "VERIFY" | "DOCUMENT" | "OPTIONAL";
  /** §28 requirement ids this node exists to satisfy. */
  requirements: string[];
  /** Inputs the node needs (files, artifacts, requirement ids). */
  inputs: string[];
  /** The scope as written in the requirement. */
  scope: string[];
  /** Files the worker may write. Empty ⇒ no write permission (fail closed). */
  allowed_files: string[];
  expected_outputs: string[];
  verification: VerificationPlan;
  dependencies: string[];
  /** How to undo this node's work. */
  rollback: string;
  /** Parallel group: nodes with the same wave may run together (§29.2). */
  wave: number;
  /** True when the node must never block the rest of the plan. */
  optional: boolean;
  /** True when the scope could not be resolved to files. */
  unbounded_scope: boolean;
}

export interface ExecutionPlan {
  schemaVersion: 1;
  version: typeof EXECUTION_PLAN_VERSION;
  task_id?: string;
  nodes: ExecutionNode[];
  /** Independent nodes grouped by wave; waves run in order, nodes inside together. */
  waves: string[][];
  /** Widest wave, i.e. the plan's own parallelism ceiling. */
  plan_parallelism: number;
  /** §29.3: what the host may actually run at once, and why. */
  concurrency: ConcurrencyDecision;
  /** Requirement ids with no node (never silently dropped). */
  uncovered_requirements: string[];
  diagnostics: string[];
  created_at: string;
}

/* ------------------------------------------------------------------ *
 * §29.3 runtime adaptive concurrency
 * ------------------------------------------------------------------ */

export interface ResourceSnapshot {
  cpu_cores: number;
  /** Free physical memory in MiB. */
  free_memory_mb: number;
  gpu_available: boolean;
  /** Providers whose page has been observed to accept work. */
  available_providers: number;
  rate_limited_providers: number;
  active_tasks: number;
  /** 0..1 one-minute load average divided by cores. */
  load_average: number;
  /** Set when the host is on battery or thermally throttled. */
  power_constrained?: boolean;
}

export interface ConcurrencyDecision {
  /** 1..8; never a constant in the code path that uses it. */
  level: number;
  /** Which snapshot values produced the level, so the decision is auditable. */
  inputs: ResourceSnapshot;
  reason: string;
}

export const MAX_CONCURRENCY = 8;

/**
 * §29.3: derives the concurrency level from the observed resources.
 *
 * The rule is deliberately simple and explainable rather than clever: start from
 * what the machine can do, subtract what is already busy or unhealthy, and never
 * exceed the providers that can actually accept work. Zero available providers
 * means one (the planner still has local gates to run), not zero.
 */
export function decideConcurrency(snapshot: ResourceSnapshot): ConcurrencyDecision {
  const reasons: string[] = [];
  const cores = Math.max(1, Math.floor(snapshot.cpu_cores));
  const memoryBound = Math.max(1, Math.floor(snapshot.free_memory_mb / 1024));
  let level = Math.min(cores - 1, memoryBound, MAX_CONCURRENCY);
  reasons.push(`cpu ${cores} cores and ${snapshot.free_memory_mb} MiB free ⇒ ${level}`);

  const usableProviders = Math.max(0, snapshot.available_providers - snapshot.rate_limited_providers);
  if (snapshot.available_providers > 0) {
    const bounded = Math.max(1, usableProviders);
    if (bounded < level) { level = bounded; reasons.push(`${snapshot.available_providers} provider(s), ${snapshot.rate_limited_providers} rate-limited ⇒ ${level}`); }
  }
  if (snapshot.load_average > 0.7) { level = Math.max(1, Math.floor(level / 2)); reasons.push(`load average ${snapshot.load_average.toFixed(2)} ⇒ halved to ${level}`); }
  if (snapshot.active_tasks >= level) { level = Math.max(1, level - Math.floor(snapshot.active_tasks / 2)); reasons.push(`${snapshot.active_tasks} active task(s) in flight ⇒ ${level}`); }
  if (snapshot.gpu_available) reasons.push("gpu available: visual/runtime gates may run in parallel");
  if (snapshot.power_constrained) { level = Math.max(1, level - 1); reasons.push(`power constrained ⇒ ${level}`); }
  level = Math.max(1, Math.min(MAX_CONCURRENCY, level));
  reasons.push(`final concurrency ${level}`);
  return { level, inputs: snapshot, reason: reasons.join("; ") };
}

/* ------------------------------------------------------------------ *
 * Planning inputs
 * ------------------------------------------------------------------ */

export interface PlanContext {
  /** Repository-relative files the planner may scope a node to. */
  files: string[];
  /** Test files, used to choose the cheapest meaningful gate. */
  tests: string[];
  entry_points: string[];
  build_tools: string[];
  /** Host commands, only those the build system actually provides. */
  commands: { typecheck?: string; syntax?: string; unit?: string; build?: string };
  /** §29.3: what the host currently has, measured by the host itself. */
  resources?: ResourceSnapshot;
}

export interface PlanInput {
  requirements: RequirementsGraph;
  context?: PlanContext;
  taskId?: string;
  /** Ref/commit a rollback would return to. */
  rollbackBase?: string;
  now?: string;
}

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

function tokensOf(text: string): string[] {
  return [...new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}_.-]+/gu) ?? []).filter((token) => token.length >= 3))];
}

/**
 * Resolves a requirement's scope text to real repository files. A scope that
 * matches nothing stays empty and the node is marked `unbounded_scope` — the
 * worker then has no write permission rather than the whole repository.
 */
export function resolveAllowedFiles(scope: string[], context: PlanContext | undefined): string[] {
  if (!context) return [];
  const wanted = scope.flatMap(tokensOf);
  if (!wanted.length) return [];
  const matched = context.files.filter((file) => {
    const haystack = file.toLocaleLowerCase();
    return wanted.some((token) => haystack.includes(token));
  });
  return [...new Set(matched)].slice(0, 50).sort();
}

/** Chooses the cheapest gate that can prove the node, from what the host has. */
export function chooseVerification(kind: ExecutionNode["kind"], requirements: RequirementsGraph, requirementIds: string[], context: PlanContext | undefined): VerificationPlan {
  const nodes = requirements.nodes.filter((node) => requirementIds.includes(node.id));
  const visual = nodes.some((node) => node.visual);
  const tools = new Set(context?.build_tools ?? []);
  const commands: string[] = [];
  let gate: VerificationGate = "SYNTAX";
  const required = new Set<EvidenceKind>(["IMPLEMENTATION"]);

  if (kind === "VERIFY" || kind === "IMPLEMENT") {
    if (context?.commands.syntax) { commands.push(context.commands.syntax); gate = "SYNTAX"; }
    if (tools.has("tsc") || context?.commands.typecheck) { commands.push(context?.commands.typecheck ?? "pnpm run typecheck"); gate = "TYPECHECK"; }
    const targeted = (context?.tests ?? []).slice(0, 8);
    if (targeted.length) { commands.push(`vitest run ${targeted.join(" ")}`); gate = "UNIT"; required.add("TEST"); }
    else if (context?.commands.unit) { commands.push(context.commands.unit); gate = "UNIT"; required.add("TEST"); }
    if (kind === "VERIFY" && (context?.commands.build || tools.has("vite"))) { commands.push(context?.commands.build ?? "pnpm run build"); gate = "BUILD"; }
  }
  if (kind === "VERIFY" && nodes.some((node) => node.type === "ACCEPTANCE")) required.add("REVIEW");
  if (visual) {
    gate = "VISUAL";
    required.add("PREVIEW");
    required.add("VISUAL_VERIFICATION");
    commands.push("theme visual check (§26)");
  }
  if (kind === "OPTIONAL") required.add("IMPLEMENTATION");
  return { gate, commands, required_evidence: [...required].filter((kind) => EVIDENCE_KINDS.includes(kind)).sort() };
}

/**
 * §29.1/§29.2: builds the execution DAG from the requirements graph.
 *
 * Node derivation:
 *   GOAL/DEPENDENCY/CONSTRAINT/NON_FUNCTIONAL → no node of their own; they become
 *     inputs/scope of the work that serves them;
 *   FUNCTIONAL/DELIVERABLE → IMPLEMENT nodes;
 *   PROHIBITION/CONSTRAINT → VERIFY nodes (the check that the prohibition holds);
 *   ACCEPTANCE/VISUAL → VERIFY nodes with the test/visual branch;
 *   OPTIONAL → OPTIONAL nodes that never block.
 */
export function planExecution(input: PlanInput): ExecutionPlan {
  const { requirements } = input;
  const diagnostics: string[] = [];
  const nodes: ExecutionNode[] = [];
  const contexts = requirements.nodes.filter((node) => node.type === "GOAL" || node.type === "DEPENDENCY");
  const goalText = requirements.nodes.find((node) => node.type === "GOAL")?.text ?? "complete the task";

  const makeNode = (kind: ExecutionNode["kind"], sources: typeof requirements.nodes, index: number): ExecutionNode => {
    const requirementIds = sources.map((node) => node.id);
    const scope = sources.map((node) => node.text);
    const allowed = resolveAllowedFiles(scope, input.context);
    const id = `${kind.toLocaleLowerCase()}-${index + 1}-${(sources[0]?.id ?? "task").slice(0, 28)}`;
    const dependencies = [...new Set(sources.flatMap((node) => node.depends_on))];
    const optional = kind === "OPTIONAL" || sources.every((node) => node.type === "OPTIONAL");
    const expected = kind === "VERIFY"
      ? sources.map((node) => `evidence that ${node.text.slice(0, 80)} holds (${node.type})`)
      : sources.map((node) => node.text.slice(0, 120));
    const verification = chooseVerification(kind, requirements, requirementIds, input.context);
    const node: ExecutionNode = {
      id,
      objective: kind === "VERIFY"
        ? `prove: ${sources.map((source) => source.text.slice(0, 70)).join(" | ")}`
        : `implement: ${sources.map((source) => source.text.slice(0, 70)).join(" | ")}`,
      kind,
      requirements: requirementIds,
      inputs: [...new Set([...contexts.map((context) => context.text.slice(0, 80)), ...dependencies])],
      scope,
      allowed_files: allowed,
      expected_outputs: expected,
      verification,
      dependencies: [],
      rollback: input.rollbackBase
        ? `git checkout ${input.rollbackBase} -- ${allowed.length ? allowed.join(" ") : "(nothing: no files were granted)"}`
        : `restore the files changed by this node${allowed.length ? `: ${allowed.join(" ")}` : " (none were granted)"}`,
      wave: 0,
      optional,
      unbounded_scope: allowed.length === 0
    };
    if (node.unbounded_scope && kind !== "VERIFY") {
      diagnostics.push(`${id}: scope did not resolve to repository files; the node has no write permission (${scope.join("; ").slice(0, 120)})`);
    }
    return node;
  };

  const implementSources = requirements.nodes.filter((node) => node.type === "FUNCTIONAL" || node.type === "DELIVERABLE");
  const verifySources = requirements.nodes.filter((node) => node.type === "PROHIBITION" || node.type === "CONSTRAINT" || node.type === "ACCEPTANCE" || node.type === "VISUAL" || node.type === "NON_FUNCTIONAL");
  const optionalSources = requirements.nodes.filter((node) => node.type === "OPTIONAL");
  if (implementSources.length) nodes.push(makeNode("IMPLEMENT", implementSources, 0));
  if (verifySources.length) nodes.push(makeNode("VERIFY", verifySources, 1));
  if (optionalSources.length) nodes.push(makeNode("OPTIONAL", optionalSources, 2));

  // Node-level dependencies: verification waits for implementation; the optional
  // node waits for everything so it can never block the plan (§29.2).
  const implement = nodes.find((node) => node.kind === "IMPLEMENT");
  const verify = nodes.find((node) => node.kind === "VERIFY");
  const optional = nodes.find((node) => node.kind === "OPTIONAL");
  if (verify && implement) verify.dependencies = [...new Set([...verify.dependencies, implement.id])];
  if (optional) optional.dependencies = nodes.filter((node) => node !== optional).map((node) => node.id);
  for (const node of nodes) node.dependencies = node.dependencies.filter((dependency) => nodes.some((other) => other.id === dependency));

  // Wave assignment: longest-path level over the node DAG (Kahn).
  const waveOf = new Map<string, number>();
  const resolve = (id: string, stack: Set<string>): number => {
    if (waveOf.has(id)) return waveOf.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const node = nodes.find((entry) => entry.id === id)!;
    const wave = node.dependencies.length ? Math.max(...node.dependencies.map((dependency) => resolve(dependency, stack) + 1)) : 0;
    stack.delete(id);
    waveOf.set(id, wave);
    return wave;
  };
  for (const node of nodes) node.wave = resolve(node.id, new Set());
  const waves: string[][] = [];
  for (const node of [...nodes].sort((left, right) => left.wave - right.wave || left.id.localeCompare(right.id))) {
    (waves[node.wave] ??= []).push(node.id);
  }

  const covered = new Set(nodes.flatMap((node) => node.requirements));
  const uncovered = requirements.nodes.filter((node) => !covered.has(node.id)).map((node) => node.id);
  if (uncovered.length) diagnostics.push(`${uncovered.length} requirement(s) have no execution node: ${uncovered.slice(0, 6).join(", ")}`);

  const plan: ExecutionPlan = {
    schemaVersion: 1,
    version: EXECUTION_PLAN_VERSION,
    nodes: nodes.sort((left, right) => left.wave - right.wave || left.id.localeCompare(right.id)),
    waves,
    plan_parallelism: waves.reduce((widest, wave) => Math.max(widest, wave.length), 0),
    concurrency: decideConcurrency(input.context?.resources ?? defaultSnapshot()),
    uncovered_requirements: uncovered,
    diagnostics,
    created_at: input.now ?? new Date(0).toISOString()
  };
  if (input.taskId) plan.task_id = input.taskId;
  if (!nodes.length) diagnostics.push(`no executable node was derived for goal "${goalText.slice(0, 60)}"`);
  return plan;
}

/** Conservative fallback when the host did not measure anything (§29.3). */
function defaultSnapshot(): ResourceSnapshot {
  return { cpu_cores: 2, free_memory_mb: 1024, gpu_available: false, available_providers: 0, rate_limited_providers: 0, active_tasks: 0, load_average: 0 };
}

/**
 * §29.2/§29.3: which nodes may start right now.
 *
 * A node is startable when every non-optional dependency it has is completed, it
 * is neither completed nor running, and the adaptive concurrency level still has
 * a free slot. Optional dependencies never gate anything.
 */
export function scheduleExecution(
  plan: ExecutionPlan,
  state: { completed?: readonly string[]; running?: readonly string[] } = {}
): string[] {
  const completed = new Set(state.completed ?? []);
  const running = new Set(state.running ?? []);
  const optionalIds = new Set(plan.nodes.filter((node) => node.optional).map((node) => node.id));
  const capacity = Math.max(0, plan.concurrency.level - running.size);
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  return plan.nodes
    .filter((node) => !completed.has(node.id) && !running.has(node.id))
    .filter((node) => node.dependencies.every((dependency) => optionalIds.has(dependency) || !byId.has(dependency) || completed.has(dependency)))
    .slice(0, capacity)
    .map((node) => node.id);
}
