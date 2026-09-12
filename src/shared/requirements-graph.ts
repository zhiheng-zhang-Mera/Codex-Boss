/**
 * Update-Plan/checkpoint-1.md §28 — the Requirements Graph.
 *
 * §28 upgrades the per-task Task Contract into a real graph:
 *   28.1 requirement types (GOAL, FUNCTIONAL, NON_FUNCTIONAL, CONSTRAINT,
 *        ACCEPTANCE, DEPENDENCY, PROHIBITION, DELIVERABLE, OPTIONAL, VISUAL);
 *   28.2 dependency edges between requirements;
 *   28.3 a requirement state machine (UNSTARTED … VERIFIED / SUPERSEDED);
 *   28.4 acceptance binding — Requirement → implementation evidence → test
 *        evidence → review evidence, and for a VISUAL requirement → preview →
 *        screenshot → visual verification.
 *
 * Everything is derived from the compiled contract, so a requirement is never
 * invented: each node carries the document/section/item provenance the contract
 * already established (checkpoint-1 §2.2 Action → Requirement → Contract Item →
 * WorkBook Section → Source File).
 *
 * §2.3 is the reason §28.4 is a *binding* and not a flag: a requirement becomes
 * VERIFIED only when every evidence kind it needs has PASS evidence attached. A
 * completion claim is not evidence.
 *
 * Pure: no fs, no clock, no model.
 */
import { tokenSimilarity } from "./tenx/knowledge";
import type { CompiledTaskContract, ContractDeclaration, DeclarationKind, QuarantinedRequirement } from "./task-contract";

export const REQUIREMENTS_GRAPH_VERSION = "requirements-graph-1" as const;

/* ------------------------------------------------------------------ *
 * §28.1 types and §28.3 states
 * ------------------------------------------------------------------ */

export const REQUIREMENT_TYPES = [
  "GOAL", "FUNCTIONAL", "NON_FUNCTIONAL", "CONSTRAINT", "ACCEPTANCE",
  "DEPENDENCY", "PROHIBITION", "DELIVERABLE", "OPTIONAL", "VISUAL"
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const REQUIREMENT_STATES = [
  "UNSTARTED", "READY", "RUNNING", "BLOCKED", "QUARANTINED", "IMPLEMENTED", "VERIFIED", "FAILED", "SUPERSEDED"
] as const;
export type RequirementState = (typeof REQUIREMENT_STATES)[number];

/** Legal §28.3 transitions. Anything else is refused, not silently applied. */
export const REQUIREMENT_TRANSITIONS: Readonly<Record<RequirementState, readonly RequirementState[]>> = {
  UNSTARTED: ["READY", "QUARANTINED", "SUPERSEDED", "FAILED"],
  READY: ["RUNNING", "BLOCKED", "QUARANTINED", "SUPERSEDED", "FAILED"],
  RUNNING: ["IMPLEMENTED", "BLOCKED", "FAILED", "QUARANTINED", "SUPERSEDED"],
  BLOCKED: ["READY", "FAILED", "QUARANTINED", "SUPERSEDED"],
  QUARANTINED: ["READY", "FAILED", "SUPERSEDED"],
  IMPLEMENTED: ["VERIFIED", "RUNNING", "FAILED", "SUPERSEDED"],
  VERIFIED: ["RUNNING", "SUPERSEDED"],
  FAILED: ["READY", "SUPERSEDED", "QUARANTINED"],
  SUPERSEDED: []
};

/** §28.1's mapping from a contract declaration kind to a requirement type. */
export const REQUIREMENT_TYPE_BY_DECLARATION: Readonly<Record<DeclarationKind, RequirementType>> = {
  GOAL: "GOAL",
  SCOPE: "FUNCTIONAL",
  CONSTRAINTS: "CONSTRAINT",
  INPUTS: "DEPENDENCY",
  DEPENDENCIES: "DEPENDENCY",
  DELIVERABLES: "DELIVERABLE",
  ACCEPTANCE_CRITERIA: "ACCEPTANCE",
  RISK: "PROHIBITION",
  PERMISSIONS: "CONSTRAINT",
  EXECUTION_STRATEGY: "NON_FUNCTIONAL"
};

/** Words that make a requirement a visual one (§28.4's VISUAL branch). */
const VISUAL_PATTERN = /\b(?:ui|ux|theme|skin|style|styling|colour|color|palette|css|layout|visual|screenshot|preview|font|typography|contrast|icon|spacing|radius)\b|主题|样式|配色|颜色|界面|视觉|截图|预览|字体|对比度|圆角|间距|图标/i;
/** Words that mark a requirement as optional rather than mandatory. */
const OPTIONAL_PATTERN = /(?:\boptional\b|\bnice[- ]to[- ]have\b|\(可选\)|可选|非必须|如有余力)/i;
/** Words that mark an item as a prohibition even outside a RISK declaration. */
const PROHIBITION_PATTERN = /(?:\bmust not\b|\bshall not\b|\bnever\b|\bdo not\b|不得|禁止|不要|不可|禁止修改)/i;

export function isVisualRequirement(text: string): boolean {
  return VISUAL_PATTERN.test(text);
}

export function isOptionalRequirement(text: string): boolean {
  return OPTIONAL_PATTERN.test(text);
}

/* ------------------------------------------------------------------ *
 * Nodes, edges, graph
 * ------------------------------------------------------------------ */

export interface RequirementProvenance {
  document_id: string;
  file_name?: string;
  section_id?: string;
  heading?: string;
  /** The declaration this requirement came from. */
  declaration_kind: DeclarationKind;
  /** Index of the item inside its declaration, so the source line is addressable. */
  item_index: number;
}

export interface RequirementNode {
  id: string;
  type: RequirementType;
  /** The requirement as written (never paraphrased). */
  text: string;
  provenance: RequirementProvenance;
  authority: "WORKBOOK" | "USER";
  overridable: boolean;
  /** True when the requirement is about appearance (§28.4 VISUAL branch). */
  visual: boolean;
  state: RequirementState;
  /** Requirement ids this one waits for. */
  depends_on: string[];
  /** Requirement ids waiting for this one (derived, kept consistent). */
  blocks: string[];
  /** Why this node is in the state it is in. */
  state_reason: string;
}

export interface RequirementEdge {
  from: string;
  to: string;
  kind: "DEPENDS_ON" | "VERIFIES" | "DERIVES";
  /** Never empty: every edge explains itself. */
  reason: string;
}

export interface RequirementsGraph {
  schemaVersion: 1;
  version: typeof REQUIREMENTS_GRAPH_VERSION;
  task_id?: string;
  workbook_hash?: string;
  nodes: RequirementNode[];
  edges: RequirementEdge[];
  /** Ids of every VISUAL requirement, so the visual branch is addressable. */
  visual_requirements: string[];
  counts: Partial<Record<RequirementType, number>>;
  states: Partial<Record<RequirementState, number>>;
  /** Non-fatal problems: cycles, dangling references, untraceable items. */
  diagnostics: string[];
  created_at: string;
}

export interface BuildRequirementsGraphInput {
  contract: CompiledTaskContract;
  /** Quarantined requirements from the contract-level isolation (§2.2/§28.3). */
  quarantined?: readonly QuarantinedRequirement[];
  /** Item texts whose declaration kind could not be traced to a section. */
  untraceable?: readonly QuarantinedRequirement[];
  taskId?: string;
  workbookHash?: string;
  now?: string;
  /** Extra dependencies the caller knows about, keyed by requirement id. */
  extraDependencies?: Record<string, string[]>;
}

function slug(value: string, limit = 48): string {
  return value
    .replace(/\s+/g, "-")
    .replace(/[^0-9A-Za-z\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLocaleLowerCase()
    .slice(0, limit) || "requirement";
}

/** Requirement ids are stable for the same contract text and provenance. */
function requirementId(type: RequirementType, provenance: RequirementProvenance, text: string, seen: Map<string, number>): string {
  const base = `${type}-${slug(text, 32) || slug(provenance.declaration_kind)}`;
  const used = seen.get(base) ?? 0;
  seen.set(base, used + 1);
  return used === 0 ? base : `${base}-${used + 1}`;
}

/**
 * §28.1/§28.2: compiles the contract into a requirement graph.
 *
 * Type derivation is a documented table (declaration kind → requirement type),
 * refined by the item text: a prohibition phrased as "must not" inside any
 * declaration becomes a PROHIBITION, an item marked optional becomes OPTIONAL,
 * and an appearance requirement becomes VISUAL (§28.4's visual branch).
 */
export function buildRequirementsGraph(input: BuildRequirementsGraphInput): RequirementsGraph {
  const { contract } = input;
  const diagnostics: string[] = [];
  const nodes: RequirementNode[] = [];
  const seen = new Map<string, number>();
  const quarantinedText = new Set((input.quarantined ?? []).map((entry) => entry.item.trim()));

  const declarationGroups: ContractDeclaration[][] = [
    contract.goal, contract.scope, contract.constraints, contract.dependencies,
    contract.deliverables, contract.acceptance_criteria, contract.risk, contract.permissions
  ];

  const addDeclaration = (declaration: ContractDeclaration): void => {
    declaration.items.forEach((rawItem, index) => {
      const text = (rawItem ?? "").trim();
      if (!text) return;
      const itemProvenance = declaration.item_provenance?.[index];
      const provenance: RequirementProvenance = {
        document_id: itemProvenance?.source_document_id ?? declaration.source_document_id,
        ...(declaration.heading ? { heading: declaration.heading } : {}),
        ...(itemProvenance?.heading ? { heading: itemProvenance.heading } : {}),
        ...(itemProvenance?.source_section_id ?? declaration.source_section_id ? { section_id: itemProvenance?.source_section_id ?? declaration.source_section_id } : {}),
        declaration_kind: declaration.kind,
        item_index: index
      };
      const baseType = REQUIREMENT_TYPE_BY_DECLARATION[declaration.kind] ?? "FUNCTIONAL";
      const type: RequirementType = isOptionalRequirement(text) ? "OPTIONAL"
        : PROHIBITION_PATTERN.test(text) ? "PROHIBITION"
          : isVisualRequirement(text) ? "VISUAL"
            : baseType;
      const id = requirementId(type, provenance, text, seen);
      const isQuarantined = quarantinedText.has(text);
      nodes.push({
        id,
        type,
        text,
        provenance,
        authority: declaration.authority,
        overridable: declaration.overridable,
        visual: type === "VISUAL" || isVisualRequirement(text),
        state: isQuarantined ? "QUARANTINED" : "UNSTARTED",
        depends_on: [],
        blocks: [],
        state_reason: isQuarantined
          ? "conflicting source sections; blocked until the conflict is resolved (§2.2)"
          : "created from the compiled contract; waiting for its dependencies"
      });
    });
  };

  for (const group of declarationGroups) for (const declaration of group) addDeclaration(declaration);
  // Declared inputs are dependency requirements in their own right (§28.1).
  contract.inputs.forEach((input, index) => {
    const text = `input document: ${input.file_name}`;
    const provenance: RequirementProvenance = { document_id: input.document_id, file_name: input.file_name, declaration_kind: "INPUTS", item_index: index };
    nodes.push({
      id: requirementId("DEPENDENCY", provenance, text, seen),
      type: "DEPENDENCY", text, provenance,
      authority: "WORKBOOK", overridable: true, visual: false, state: "UNSTARTED",
      depends_on: [], blocks: [], state_reason: "declared as an input of the task contract"
    });
  });
  // The execution strategy is a declaration-like requirement source too.
  const strategy = contract.execution_strategy;
  if (strategy) {
    const text = `execution strategy: ${strategy.mode}${strategy.analysis_only ? ", analysis only" : ""}${strategy.required_capabilities.length ? `, capabilities: ${strategy.required_capabilities.join(", ")}` : ""}`;
    const id = requirementId("NON_FUNCTIONAL", { document_id: contract.source_workbook.document_ids[0] ?? "contract", declaration_kind: "EXECUTION_STRATEGY", item_index: 0 }, text, seen);
    nodes.push({
      id, type: "NON_FUNCTIONAL", text,
      provenance: { document_id: contract.source_workbook.document_ids[0] ?? "contract", declaration_kind: "EXECUTION_STRATEGY", item_index: 0 },
      authority: "WORKBOOK", overridable: false, visual: false, state: "UNSTARTED",
      depends_on: [], blocks: [], state_reason: "created from the compiled execution strategy"
    });
  }
  // §28.1 CONSTRAINT from the user's own override text (authority USER).
  contract.overrides.forEach((override, index) => {
    const text = override.text.trim();
    if (!text) return;
    const type: RequirementType = PROHIBITION_PATTERN.test(text) ? "PROHIBITION" : "CONSTRAINT";
    const id = requirementId(type, { document_id: "user-override", declaration_kind: "CONSTRAINTS", item_index: index }, text, seen);
    nodes.push({
      id, type, text,
      provenance: { document_id: "user-override", declaration_kind: "CONSTRAINTS", item_index: index },
      authority: "USER", overridable: false, visual: isVisualRequirement(text), state: "UNSTARTED",
      depends_on: [], blocks: [],
      state_reason: `user override (${override.reason})`
    });
  });

  if (!nodes.length) diagnostics.push("the contract produced no requirements");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: RequirementEdge[] = [];
  const link = (from: string, to: string, kind: RequirementEdge["kind"], reason: string): void => {
    if (from === to || !byId.has(from) || !byId.has(to)) return;
    if (edges.some((edge) => edge.from === from && edge.to === to)) return;
    edges.push({ from, to, kind, reason });
  };

  const goals = nodes.filter((node) => node.type === "GOAL");
  const deliverables = nodes.filter((node) => node.type === "DELIVERABLE");
  const acceptances = nodes.filter((node) => node.type === "ACCEPTANCE");
  const dependencies = nodes.filter((node) => node.type === "DEPENDENCY");
  const visuals = nodes.filter((node) => node.visual && node.type !== "ACCEPTANCE");

  /* §28.2 edge rules, each recording why the edge exists. */
  for (const node of nodes) {
    if (node.type === "GOAL" || node.type === "ACCEPTANCE") continue;
    for (const goal of goals) link(node.id, goal.id, "DERIVES", `"${node.id}" serves the goal "${goal.id}"`);
  }
  for (const node of [...deliverables, ...nodes.filter((entry) => entry.type === "FUNCTIONAL")]) {
    for (const dependency of dependencies) link(node.id, dependency.id, "DEPENDS_ON", `"${node.id}" cannot be delivered before the declared input/dependency "${dependency.id}"`);
  }
  for (const acceptance of acceptances) {
    const scored = deliverables.map((deliverable) => ({ deliverable, score: tokenSimilarity(acceptance.text, deliverable.text) }))
      .sort((left, right) => right.score - left.score || left.deliverable.id.localeCompare(right.deliverable.id));
    const matching = scored.filter((entry) => entry.score >= 0.25);
    const targets = matching.length ? matching.map((entry) => entry.deliverable) : deliverables;
    for (const target of targets) {
      link(acceptance.id, target.id, "VERIFIES", matching.length
        ? `acceptance "${acceptance.id}" shares its subject with "${target.id}" (similarity ${scored.find((entry) => entry.deliverable.id === target.id)!.score.toFixed(2)})`
        : `acceptance "${acceptance.id}" verifies every deliverable because no single deliverable matched it`);
    }
    if (!deliverables.length) diagnostics.push(`acceptance "${acceptance.id}" has no deliverable to verify`);
  }
  for (const visual of visuals) {
    for (const acceptance of acceptances.filter((entry) => entry.visual)) link(acceptance.id, visual.id, "VERIFIES", `visual acceptance "${acceptance.id}" verifies the appearance requirement "${visual.id}"`);
  }
  // Explicit cross-references written in the text ("depends on R2", "AC-1").
  const idPattern = /(?:^|[^\w-])([A-Z]{1,6}-\d+[a-z]?)(?![-\w])/g;
  for (const node of nodes) {
    for (const match of node.text.matchAll(idPattern)) {
      const reference = match[1].toLocaleLowerCase();
      const target = nodes.find((entry) => entry.id.toLocaleLowerCase().startsWith(reference));
      if (target) link(node.id, target.id, "DEPENDS_ON", `"${node.id}" names "${target.id}" in its own text`);
    }
  }
  for (const [from, targets] of Object.entries(input.extraDependencies ?? {})) {
    for (const to of targets) link(from, to, "DEPENDS_ON", "declared by the caller");
  }

  for (const edge of edges) {
    byId.get(edge.from)!.depends_on.push(edge.to);
    byId.get(edge.to)!.blocks.push(edge.from);
  }
  for (const node of nodes) {
    node.depends_on = [...new Set(node.depends_on)].sort();
    node.blocks = [...new Set(node.blocks)].sort();
  }

  const cycle = findRequirementCycle(nodes);
  if (cycle.length) diagnostics.push(`requirement dependency cycle: ${cycle.join(" → ")}`);
  for (const node of nodes) {
    if (node.depends_on.some((id) => !byId.has(id))) diagnostics.push(`"${node.id}" depends on an unknown requirement`);
  }

  const counts: Partial<Record<RequirementType, number>> = {};
  for (const node of nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;
  const states: Partial<Record<RequirementState, number>> = {};
  for (const node of nodes) states[node.state] = (states[node.state] ?? 0) + 1;

  const graph: RequirementsGraph = {
    schemaVersion: 1,
    version: REQUIREMENTS_GRAPH_VERSION,
    nodes,
    edges,
    visual_requirements: nodes.filter((node) => node.visual).map((node) => node.id),
    counts,
    states,
    diagnostics,
    created_at: input.now ?? new Date(0).toISOString()
  };
  if (input.taskId) graph.task_id = input.taskId;
  if (input.workbookHash) graph.workbook_hash = input.workbookHash;
  return graph;
}

/** Depth-first cycle detection over the dependency edges. */
export function findRequirementCycle(nodes: readonly RequirementNode[]): string[] {
  const edges = new Map(nodes.map((node) => [node.id, node.depends_on]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): string[] => {
    if (visiting.has(id)) return [...path.slice(path.indexOf(id)), id];
    if (done.has(id)) return [];
    visiting.add(id);
    path.push(id);
    for (const next of edges.get(id) ?? []) {
      const cycle = visit(next);
      if (cycle.length) return cycle;
    }
    path.pop();
    visiting.delete(id);
    done.add(id);
    return [];
  };
  for (const node of nodes) {
    const cycle = visit(node.id);
    if (cycle.length) return cycle;
  }
  return [];
}

/** §28.2: requirements whose dependencies are all satisfied, in a stable order. */
export function readyRequirements(graph: RequirementsGraph): RequirementNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const satisfied = (state: RequirementState): boolean => state === "VERIFIED" || state === "IMPLEMENTED";
  return graph.nodes
    .filter((node) => (node.state === "UNSTARTED" || node.state === "BLOCKED"))
    .filter((node) => node.depends_on.every((id) => { const dependency = byId.get(id); return dependency === undefined || satisfied(dependency.state); }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Dependencies-first order; nodes inside a cycle are appended so nothing is lost. */
export function topologicalRequirementOrder(graph: RequirementsGraph): string[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (id: string, stack: Set<string>): void => {
    if (visited.has(id) || stack.has(id)) return;
    stack.add(id);
    for (const dependency of byId.get(id)?.depends_on ?? []) visit(dependency, stack);
    stack.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const node of [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id))) visit(node.id, new Set());
  return order;
}

/* ------------------------------------------------------------------ *
 * §28.3 state machine
 * ------------------------------------------------------------------ */

export interface RequirementTransition {
  ok: boolean;
  from: RequirementState;
  to: RequirementState;
  reason: string;
}

/**
 * §28.3: applies a state change only when the transition is legal. VERIFIED is
 * never reachable from a claim — see `bindAcceptance`, which is the only place
 * that produces the evidence needed for it.
 */
export function transitionRequirement(graph: RequirementsGraph, requirementId: string, next: RequirementState, reason: string): RequirementTransition {
  const node = graph.nodes.find((entry) => entry.id === requirementId);
  if (!node) return { ok: false, from: "UNSTARTED", to: next, reason: `unknown requirement ${requirementId}` };
  const from = node.state;
  if (from === next) return { ok: true, from, to: next, reason: "state unchanged" };
  if (!REQUIREMENT_TRANSITIONS[from].includes(next)) {
    return { ok: false, from, to: next, reason: `illegal transition ${from} → ${next} (allowed: ${REQUIREMENT_TRANSITIONS[from].join(", ") || "none"})` };
  }
  node.state = next;
  node.state_reason = reason;
  graph.states = graph.states ?? {};
  return { ok: true, from, to: next, reason };
}

/* ------------------------------------------------------------------ *
 * §28.4 acceptance binding
 * ------------------------------------------------------------------ */

export const EVIDENCE_KINDS = ["IMPLEMENTATION", "TEST", "REVIEW", "PREVIEW", "SCREENSHOT", "VISUAL_VERIFICATION", "COMMAND"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type EvidenceStatus = "PASS" | "FAIL" | "MISSING" | "NOT_RUN";

export interface RequirementEvidence {
  id: string;
  requirement_id: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  /** Who produced it: a host command, a test run, a reviewer, a screenshot. */
  source: string;
  detail: string;
  captured_at: string;
  command?: string;
  artifact?: string;
  hash?: string;
}

/** Which evidence kinds each requirement type needs before it can be VERIFIED. */
export function requiredEvidenceKinds(node: Pick<RequirementNode, "type" | "visual">): EvidenceKind[] {
  if (node.type === "ACCEPTANCE") return node.visual ? ["IMPLEMENTATION", "TEST", "REVIEW", "VISUAL_VERIFICATION"] : ["IMPLEMENTATION", "TEST", "REVIEW"];
  if (node.type === "VISUAL" || node.visual) return ["IMPLEMENTATION", "PREVIEW", "SCREENSHOT", "VISUAL_VERIFICATION"];
  if (node.type === "DELIVERABLE" || node.type === "FUNCTIONAL") return ["IMPLEMENTATION", "TEST"];
  if (node.type === "GOAL") return ["IMPLEMENTATION"];
  if (node.type === "PROHIBITION" || node.type === "CONSTRAINT") return ["IMPLEMENTATION"];
  if (node.type === "DEPENDENCY" || node.type === "NON_FUNCTIONAL" || node.type === "OPTIONAL") return ["IMPLEMENTATION"];
  return ["IMPLEMENTATION"];
}

export interface RequirementBinding {
  requirement_id: string;
  type: RequirementType;
  state: RequirementState;
  required: EvidenceKind[];
  provided: { kind: EvidenceKind; status: EvidenceStatus; source: string }[];
  missing: EvidenceKind[];
  failed: EvidenceKind[];
  /** VERIFIED only when every required kind has a PASS evidence entry. */
  verified: boolean;
  /** IMPLEMENTED when the implementation evidence passed but verification has not. */
  implemented: boolean;
  reason: string;
}

export interface AcceptanceBindingReport {
  schemaVersion: 1;
  version: typeof REQUIREMENTS_GRAPH_VERSION;
  bindings: RequirementBinding[];
  /** Requirements that demand visual evidence, listed so a report can show them. */
  visual: string[];
  totals: { verified: number; implemented: number; blocked: number; unverified: number; quarantined: number };
  /** Non-empty when something could not be verified; the honest summary. */
  unverified: string[];
}

/**
 * §28.4: binds evidence to requirements and decides what may be called VERIFIED.
 *
 * The rule is deliberately mechanical: a missing or non-PASS evidence entry
 * leaves the requirement unverified, whatever the worker claimed (§2.3
 * MODEL_DONE != COMPLETED). Quarantined and superseded requirements are reported
 * but never verified.
 */
export function bindAcceptance(input: {
  graph: RequirementsGraph;
  evidence: readonly RequirementEvidence[];
  /** When false, states are not mutated (a dry report). Defaults to true. */
  apply?: boolean;
}): AcceptanceBindingReport {
  const { graph } = input;
  const apply = input.apply !== false;
  const byRequirement = new Map<string, RequirementEvidence[]>();
  for (const entry of input.evidence) {
    (byRequirement.get(entry.requirement_id) ?? byRequirement.set(entry.requirement_id, []).get(entry.requirement_id)!).push(entry);
  }
  const bindings: RequirementBinding[] = [];
  const unverified: string[] = [];

  for (const node of graph.nodes) {
    const required = requiredEvidenceKinds(node);
    const provided = (byRequirement.get(node.id) ?? []).map((entry) => ({ kind: entry.kind, status: entry.status, source: entry.source }));
    const statusOf = (kind: EvidenceKind): EvidenceStatus => {
      const entries = (byRequirement.get(node.id) ?? []).filter((entry) => entry.kind === kind);
      if (!entries.length) return "MISSING";
      if (entries.some((entry) => entry.status === "PASS")) return "PASS";
      if (entries.some((entry) => entry.status === "FAIL")) return "FAIL";
      if (entries.some((entry) => entry.status === "NOT_RUN")) return "NOT_RUN";
      return "MISSING";
    };
    const missing = required.filter((kind) => statusOf(kind) === "MISSING");
    const failed = required.filter((kind) => statusOf(kind) === "FAIL");
    const notRun = required.filter((kind) => statusOf(kind) === "NOT_RUN");
    const implemented = statusOf("IMPLEMENTATION") === "PASS";
    const verified = missing.length === 0 && failed.length === 0 && notRun.length === 0;

    if (node.state === "QUARANTINED" || node.state === "SUPERSEDED") {
      bindings.push({
        requirement_id: node.id, type: node.type, state: node.state, required, provided, missing, failed,
        verified: false, implemented,
        reason: `not verifiable while ${node.state.toLowerCase()}`
      });
      if (node.state === "QUARANTINED") unverified.push(node.id);
      continue;
    }

    const reason = verified
      ? `all required evidence passed (${required.join(", ")})`
      : `missing ${missing.join(", ") || "none"}; failed ${failed.join(", ") || "none"}; not run ${notRun.join(", ") || "none"}`;
    // Walk the legal §28.3 path toward what the evidence supports, so the state
    // machine remains the only writer of a requirement's state.
    const path: RequirementState[] = ["READY", "RUNNING", "IMPLEMENTED", "VERIFIED"];
    const target: RequirementState = verified ? "VERIFIED" : implemented ? "IMPLEMENTED" : node.state;
    if (apply && target !== node.state) {
      for (const step of path.slice(0, path.indexOf(target) + 1)) {
        if (node.state === step) continue;
        if (REQUIREMENT_TRANSITIONS[node.state].includes(step)) transitionRequirement(graph, node.id, step, reason);
      }
    }
    if (node.state !== "VERIFIED") unverified.push(node.id);
    bindings.push({
      requirement_id: node.id, type: node.type, state: node.state, required, provided, missing, failed,
      verified: verified && node.state === "VERIFIED", implemented, reason
    });
  }

  const totals = {
    verified: bindings.filter((entry) => entry.state === "VERIFIED").length,
    implemented: bindings.filter((entry) => entry.state === "IMPLEMENTED").length,
    blocked: bindings.filter((entry) => entry.state === "BLOCKED").length,
    unverified: bindings.filter((entry) => entry.state !== "VERIFIED" && entry.state !== "SUPERSEDED").length,
    quarantined: bindings.filter((entry) => entry.state === "QUARANTINED").length
  };
  return {
    schemaVersion: 1,
    version: REQUIREMENTS_GRAPH_VERSION,
    bindings,
    visual: graph.visual_requirements,
    totals,
    unverified: [...new Set(unverified)].sort()
  };
}

/** Convenience: the evidence a caller must produce for one requirement kind. */
export function evidenceTemplate(graph: RequirementsGraph): { requirement_id: string; type: RequirementType; required: EvidenceKind[] }[] {
  return graph.nodes.map((node) => ({ requirement_id: node.id, type: node.type, required: requiredEvidenceKinds(node) }));
}
