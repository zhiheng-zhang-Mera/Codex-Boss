/**
 * 10.x forward architecture — platform-neutral contract vocabulary (pure).
 *
 * Phase 10A (Host-B taskbook §4): every protocol that crosses a node boundary
 * (fleet heartbeat, task lease, checkpoint, takeover, knowledge contribution,
 * artifact provenance, provider/proxy routing) is defined on plain JSON types
 * so heterogeneous OS/device adapters can carry it without any host-specific
 * dependency. No `node:`/Electron/OS imports are allowed in this module (or in
 * any file under src/shared/tenx). A violation is a compile-time/runtime audit
 * failure (see tenx-neutrality test).
 *
 * These are the *vocabulary* types only. Per-phase behavior (state machines,
 * durable stores, schedulers) lives in sibling modules keyed by contract.
 */

/** Single immutable schema-generation marker for the whole 10.x contract set. */
export const TENX_CONTRACT_VERSION = "10.0.0" as const;

/** Phase coverage map: each taskbook phase has at least one owning contract id. */
export type TenxContractId =
  | "node" // 10B node identity + capability advertisement
  | "inspection" // 10C device self-inspection → NodeCapabilityReport
  | "fleet" // 10D fleet control plane
  | "lease" // 10E task lease & ownership
  | "scheduler" // 10F dynamic scheduler
  | "knowledge" // 10G shared knowledge space vNext
  | "pipeline" // 10H knowledge pipeline
  | "conflict" // 10I dedup & conflict
  | "sync" // 10J local fallback + deferred sync
  | "artifact" // 10K artifact/memory architecture
  | "network" // 10L network routing vNext
  | "provider" // 10M provider reachability matrix
  | "session" // 10N session lifecycle vNext
  | "login-health" // 10O login health
  | "platform" // 10Q platform-neutral adapter contract
  | "observability"; // 10R aggregated fleet observability

export const TENX_CONTRACTS: readonly TenxContractId[] = [
  "node",
  "inspection",
  "fleet",
  "lease",
  "scheduler",
  "knowledge",
  "pipeline",
  "conflict",
  "sync",
  "artifact",
  "network",
  "provider",
  "session",
  "login-health",
  "platform",
  "observability"
] as const;

/** Every contract id that appears in TENX_CONTRACTS has a schema marker. */
export const TENX_SCHEMA_MARKERS: Readonly<Record<TenxContractId, number>> = {
  node: 1,
  inspection: 1,
  fleet: 1,
  lease: 1,
  scheduler: 1,
  knowledge: 1,
  pipeline: 1,
  conflict: 1,
  sync: 1,
  artifact: 1,
  network: 1,
  provider: 1,
  session: 1,
  "login-health": 1,
  platform: 1,
  observability: 1
};

/**
 * Universal envelope every cross-node 10.x protocol message uses. Keeps all
 * wire traffic self-describing: schema contract id + generation marker + the
 * originating node, so a receiver can reject an unknown/foreign schema without
 * guessing (fail explicit, never silent corruption).
 */
export interface TenxEnvelope<TKind extends string, TPayload = unknown> {
  schema: TenxContractId;
  contractVersion: string;
  kind: TKind;
  nodeId: string;
  sentAt: string; // ISO-8601 UTC
  payload: TPayload;
}

/** Deterministic structural check shared by every 10.x schema (pure). */
export function isTenxEnvelope(value: unknown): value is TenxEnvelope<string> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.schema === "string" &&
    (TENX_CONTRACTS as readonly string[]).includes(record.schema) &&
    typeof record.contractVersion === "string" &&
    typeof record.kind === "string" &&
    typeof record.nodeId === "string" &&
    typeof record.sentAt === "string" &&
    Number.isFinite(Date.parse(record.sentAt))
  );
}

/** Renderer-safe JSON round-trip helper used across 10.x schemas. */
export function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
