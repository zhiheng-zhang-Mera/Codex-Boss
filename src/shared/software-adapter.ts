/**
 * Generic Software Runtime contracts (plan §21 / §19 forward). Pure and
 * shareable. A SoftwareAdapter is a capability provider for one software
 * surface (Blender, Unreal, a CLI tool, …): it declares what it can do, and
 * the generic runtime turns a goal + capability graph into a bounded action
 * plan executed under a session lease with observations and verification —
 * never arbitrary shell text.
 */

export type SoftwareActionKind = "open" | "command" | "observe" | "verify" | "close";

export interface SoftwareAction {
  kind: SoftwareActionKind;
  /** Canonical capability id, e.g. "blender.render". */
  capability: string;
  /** Structured parameters only (never a raw command string). */
  params: Record<string, string | number | boolean | string[]>;
}

export interface SoftwareObservation {
  at: string;
  /** Deterministic, bounded evidence (text/status), never private reasoning. */
  evidence: string;
  status: "SUCCESS" | "FAILED" | "UNCERTAIN";
  frame?: string; // key-frame reference (plan §24), may be an image path
}

export interface SoftwareVerification {
  passed: boolean;
  message: string;
}

export interface SoftwareCapability {
  id: string;
  /** Execution family for control-hierarchy ordering (native > script > plugin > semantic > vision). */
  family: "native" | "cli" | "script" | "plugin" | "semantic" | "vision";
  readsOnly: boolean;
}

export interface SoftwareAdapterDeclaration {
  id: string;
  kind: string;
  version: string;
  capabilities: readonly SoftwareCapability[];
  /** min/max contract versions this adapter targets (plan §6). */
  contract: { adapter_api: string; capability_contract: string };
}

export interface SoftwareHealth {
  id: string;
  available: boolean;
  message: string;
  checkedAt: string;
}

export interface ArtifactExchange {
  artifactId: string;
  adapterId: string;
  direction: "export" | "import";
  format: string;
  targetId: string;
  checksum?: string;
}

/** Deterministic capability lookup with fail-closed unknown ids. */
export function capabilityFor(adapter: SoftwareAdapterDeclaration, id: string): SoftwareCapability | undefined {
  return adapter.capabilities.find((capability) => capability.id === id);
}

export function adapterSupports(adapter: SoftwareAdapterDeclaration, id: string): boolean {
  return capabilityFor(adapter, id) !== undefined;
}

export interface SoftwareActionPlan {
  actions: SoftwareAction[];
  reason: string;
}

/**
 * Generic planner: orders requested capabilities into bounded actions
 * (open → command chain → verify). Deterministic: unknown or unreadable
 * capability ids fail closed; reads-only actions may run before mutations.
 */
export function planSoftwareActions(adapter: SoftwareAdapterDeclaration, requested: string[]): SoftwareActionPlan {
  const actions: SoftwareAction[] = [];
  const unknown = requested.filter((id) => !adapterSupports(adapter, id));
  if (unknown.length) throw new Error(`Adapter ${adapter.id} cannot ${unknown.join(", ")}`);
  const ordered = [...requested].sort((a, b) => {
    const left = capabilityFor(adapter, a)!;
    const right = capabilityFor(adapter, b)!;
    const rank = (capability: SoftwareCapability) => ({ native: 0, cli: 1, script: 2, plugin: 3, semantic: 4, vision: 5 }[capability.family]);
    if (left.readsOnly !== right.readsOnly) return left.readsOnly ? -1 : 1;
    return rank(left) - rank(right);
  });
  actions.push({ kind: "open", capability: `${adapter.id}.open`, params: {} });
  for (const capability of ordered) {
    const definition = capabilityFor(adapter, capability)!;
    actions.push({ kind: definition.readsOnly ? "observe" : "command", capability, params: {} });
  }
  actions.push({ kind: "verify", capability: `${adapter.id}.verify`, params: {} });
  return { actions, reason: `${ordered.length} capability action(s) for ${adapter.id}` };
}

export function validateSoftwareAction(action: SoftwareAction): void {
  if (!action || !["open", "command", "observe", "verify", "close"].includes(action.kind)) throw new Error("Invalid software action kind");
  if (!action.capability || action.capability.length > 200) throw new Error("Invalid software capability id");
  const params = action.params ?? {};
  if (Object.keys(params).some((key) => key.length > 100)) throw new Error("Invalid software action parameter name");
}

export const softwareActionReadsOnly = (action: SoftwareAction): boolean => action.kind === "observe" || action.kind === "verify";
