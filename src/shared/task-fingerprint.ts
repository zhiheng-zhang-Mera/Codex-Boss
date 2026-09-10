/**
 * Engine Phase 2/4 — TaskFingerprint contract (pure).
 *
 * The Engine book (§4) forbids an ever-growing hard-coded topic enum as the
 * routing schema. Instead a task is described by an OPEN fingerprint: role,
 * capability requirements, modality, autonomy/effect levels, scale, optional
 * semantic vector reference and learned concepts.
 *
 * This module owns the CONTRACT only. The deterministic builder (including the
 * embedding-free structural fallback required by Phase 4) lives in
 * electron/learning/task-fingerprint.ts.
 */

export const TASK_FINGERPRINT_VERSION = "fingerprint-1.0.0";

/** A learned concept reference — never an enum value. */
export interface LearnedConceptRef {
  conceptId: string;
  similarity: number;
  confidence: number;
}

export interface TaskFingerprint {
  schemaVersion: 1;
  fingerprintVersion: string;
  /** Reference into the embedding store when an embedding backend is available. */
  semanticVectorRef?: string;
  /** Deterministic structural hash — always present, embedding-independent. */
  structuralHash: string;
  role: string;
  capabilities: string[];
  modality?: string[];
  specificity?: number;
  autonomyLevel?: number;
  externalEffectLevel?: number;
  contextScale?: number;
  concepts?: LearnedConceptRef[];
}

export function conceptIds(fingerprint: Pick<TaskFingerprint, "concepts">): string[] {
  return (fingerprint.concepts ?? []).map((concept) => concept.conceptId);
}

/** Deterministic, dependency-free hash (FNV-1a 32-bit, hex) used for structural
 *  fingerprints and cache keys — stable across platforms and process restarts. */
export function structuralHashOf(parts: ReadonlyArray<string | number | undefined>): string {
  let hash = 0x811c9dc5;
  const input = parts.map((part) => (part === undefined ? "" : String(part))).join("\u0001");
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
