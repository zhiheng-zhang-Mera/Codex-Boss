/**
 * Engine Phase 7 — learned concept contracts (pure).
 *
 * A concept is DISCOVERED from history, never declared in an enum (book §4.1):
 * the ID is stable, the display name is only a mutable UI label, and the
 * prototype (structural signature and/or embedding reference) is what actually
 * drives similarity and learning. New concepts therefore require no schema
 * migration.
 */

import type { TaskFingerprint } from "./task-fingerprint";

export type ConceptStatus = "CANDIDATE" | "OBSERVING" | "ACTIVE" | "SPLIT" | "MERGED" | "DEPRECATED";

export const CONCEPT_STATUSES: readonly ConceptStatus[] = ["CANDIDATE", "OBSERVING", "ACTIVE", "SPLIT", "MERGED", "DEPRECATED"] as const;

/** Statuses a runtime may actually route on. */
export function conceptIsUsable(status: ConceptStatus): boolean {
  return status === "ACTIVE" || status === "OBSERVING";
}

export interface ConceptPrototype {
  kind: "structural" | "embedding";
  /** Canonical structural signature (always available). */
  signature: string;
  /** Optional embedding reference for semantic similarity. */
  vectorRef?: string;
  /** Token weights used for display and similarity fallback. */
  tokens?: Record<string, number>;
}

export interface LearnedConcept {
  schemaVersion: 1;
  /** Stable identity — never changes, never depends on the display name. */
  conceptId: string;
  /** Mutable UI label; renaming must not affect identity or history. */
  displayName: string;
  prototype: ConceptPrototype;
  support: number;
  status: ConceptStatus;
  createdAt: string;
  updatedAt: string;
  parentConceptId?: string;
  mergedInto?: string;
  splitInto?: string[];
  /** Sample references retained for audit/drill-down. */
  episodeIds: string[];
}

/** Deterministic structural cluster key for a fingerprint (no embeddings needed). */
export function structuralSignature(fingerprint: Pick<TaskFingerprint, "role" | "capabilities" | "modality" | "specificity" | "contextScale">): string {
  const capabilities = [...new Set(fingerprint.capabilities ?? [])].sort().join("+");
  const modality = [...new Set(fingerprint.modality ?? [])].sort().join("+");
  const specificityBucket = Math.round((fingerprint.specificity ?? 0) * 5) / 5; // 0.2 granularity
  const contextBucket = Math.round((fingerprint.contextScale ?? 0) * 4) / 4; // 0.25 granularity
  return [fingerprint.role, capabilities, modality, specificityBucket.toFixed(1), contextBucket.toFixed(2)].join("|");
}

export function tokensOfSignature(signature: string): Record<string, number> {
  const tokens: Record<string, number> = {};
  for (const part of signature.split("|")) {
    for (const token of part.split("+")) {
      if (!token) continue;
      tokens[token] = (tokens[token] ?? 0) + 1;
    }
  }
  return tokens;
}

/** Jaccard similarity over prototype tokens — deterministic, embedding-free. */
export function prototypeSimilarity(left: ConceptPrototype, right: ConceptPrototype): number {
  const a = new Set(Object.keys(left.tokens ?? tokensOfSignature(left.signature)));
  const b = new Set(Object.keys(right.tokens ?? tokensOfSignature(right.signature)));
  if (!a.size && !b.size) return left.signature === right.signature ? 1 : 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : Number((shared / union).toFixed(4));
}

/** Cosine similarity for embedding prototypes (deterministic, 0 when unusable). */
export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return 0;
  return Number((dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))).toFixed(4));
}

/** Stable id from a signature (hash-based; collisions in practice require identical signatures). */
export function conceptIdForSignature(signature: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < signature.length; index++) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `C-${hash.toString(16).padStart(8, "0")}`;
}

/** Default display name derived from the prototype (mutable thereafter). */
export function displayNameForSignature(signature: string): string {
  const [role, capabilities, modality] = signature.split("|");
  const capabilityLabel = (capabilities || "general").split("+").filter(Boolean).slice(0, 2).join("/") || "general";
  const modalityLabel = (modality || "text").split("+").filter(Boolean).slice(0, 2).join("/") || "text";
  return `${role} · ${capabilityLabel} · ${modalityLabel}`;
}
