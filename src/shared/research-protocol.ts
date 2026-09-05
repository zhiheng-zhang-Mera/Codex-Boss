/**
 * Research protocol freeze + amendment (plan 9-6 Phase 7). Pure and shareable.
 *
 * Before experiments start, protocol.json is frozen by SHA-256 and the run
 * moves to PROTOCOL_FROZEN. After freeze the system may auto-fix only
 * mechanical fields (syntax / path / environment / package / runtime error);
 * scientific fields (hypothesis / primary metric / baseline / sample definition
 * / exclusion rule / evaluation criterion) must not change silently — any such
 * change requires an explicit `protocol-amendment-<n>.json` referencing the
 * original frozen hash.
 */

export type AutoFixableField = "syntax" | "path" | "environment" | "package" | "runtime-error";
export type FrozenField = "hypothesis" | "primary-metric" | "baseline" | "sample-definition" | "exclusion-rule" | "evaluation-criterion";

export const AUTO_FIXABLE_FIELDS: readonly AutoFixableField[] = ["syntax", "path", "environment", "package", "runtime-error"];
export const FROZEN_FIELDS: readonly FrozenField[] = ["hypothesis", "primary-metric", "baseline", "sample-definition", "exclusion-rule", "evaluation-criterion"];

export interface ResearchProtocol {
  schemaVersion: 1;
  /** Scientific core — never silently amended after freeze. */
  hypothesis: string;
  primaryMetric: string;
  baseline: string;
  sampleDefinition: string;
  exclusionRule?: string;
  evaluationCriterion: string;
  /** Mechanical fields that may be auto-fixed (paths/env), still recorded. */
  syntax?: string;
  environment?: Record<string, string>;
  createdAt: string;
}

export interface ProtocolAmendment {
  id: string;
  protocolHash: string;       // frozen hash the amendment applies to
  changes: Array<{ field: FrozenField; before: string; after: string; reason: string }>;
  approved: boolean;
  createdAt: string;
}

export interface ProtocolFreezeResult {
  hash: string;
  frozenAt: string;
}

/** Deterministic canonical JSON (sorted keys) used for the freeze hash. */
export function canonicalStableProtocol(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStableProtocol).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalStableProtocol(record[key])}`).join(",")}}`;
}

export function hashProtocol(protocol: ResearchProtocol, hash: (text: string) => string): string {
  return hash(canonicalStableProtocol(protocol));
}

/** Returns the scientific core used to detect silent mutation after freeze. */
export function scientificCore(protocol: ResearchProtocol): Record<string, string> {
  const core: Record<string, string> = { hypothesis: protocol.hypothesis, "primary-metric": protocol.primaryMetric, baseline: protocol.baseline, "sample-definition": protocol.sampleDefinition, "evaluation-criterion": protocol.evaluationCriterion };
  if (protocol.exclusionRule) core["exclusion-rule"] = protocol.exclusionRule;
  return core;
}

export interface MutationVerdict {
  silentChange: boolean;
  changedFrozen: string[];
  changedMechanical: string[];
}

/** Compares the current scientific core to a previously frozen one (silent-mutation guard). */
export function diffProtocol(original: Record<string, string>, candidate: ResearchProtocol): MutationVerdict {
  const candidateCore = scientificCore(candidate);
  const changedFrozen = Object.keys(original).filter((field) => candidateCore[field] !== undefined && candidateCore[field] !== original[field]);
  return { silentChange: changedFrozen.length > 0, changedFrozen, changedMechanical: [] };
}

export function validateAmendment(amendment: ProtocolAmendment): void {
  if (!amendment || typeof amendment.id !== "string" || !amendment.id) throw new Error("Amendment requires an id");
  if (typeof amendment.protocolHash !== "string" || !amendment.protocolHash) throw new Error("Amendment requires the frozen protocol hash");
  if (!Array.isArray(amendment.changes) || amendment.changes.length < 1) throw new Error("Amendment requires changes");
  for (const change of amendment.changes) {
    if (!FROZEN_FIELDS.includes(change.field)) throw new Error(`Amendment touches non-frozen field: ${change.field}`);
    if (typeof change.reason !== "string" || !change.reason.trim()) throw new Error("Amendment change requires a reason");
  }
}
