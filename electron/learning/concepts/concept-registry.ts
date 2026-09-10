import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../../commander/durable-json";
import {
  conceptIdForSignature,
  conceptIsUsable,
  displayNameForSignature,
  prototypeSimilarity,
  tokensOfSignature,
  type ConceptPrototype,
  type ConceptStatus,
  type LearnedConcept
} from "../../../src/shared/learned-concept";

/**
 * Engine Phase 7 — durable concept registry (derived, rebuildable).
 *
 * Concepts are mined from episodes; the registry only stores what was learned.
 *  - `conceptId` is stable (derived from the prototype signature, or assigned on
 *    first observation) and never depends on the display name (A22);
 *  - renaming only rewrites `displayName` and keeps history intact;
 *  - statuses follow CANDIDATE → OBSERVING → ACTIVE with SPLIT/MERGED/DEPRECATED;
 *  - a corrupt registry degrades to "no concepts" — routing then runs unchanged
 *    on runtime profiles (A29).
 */

export interface ConceptRegistryFile {
  schemaVersion: 1;
  concepts: LearnedConcept[];
  /** signature → conceptId so ids survive restarts even for embedding clusters. */
  prototypeIndex: Record<string, string>;
}

export interface ConceptUpsertInput {
  signature: string;
  vectorRef?: string;
  episodeId?: string;
  at: string;
}

export interface ConceptMutationResult {
  concept: LearnedConcept;
  created: boolean;
  promoted: boolean;
}

export class ConceptRegistry {
  private readonly concepts = new Map<string, LearnedConcept>();
  private readonly prototypeIndex = new Map<string, string>();
  private degraded?: string;

  constructor(
    private readonly filePath?: string,
    /** Support required to leave CANDIDATE. */
    private readonly observingSupport = 3,
    /** Support required to become ACTIVE (routable). */
    private readonly activationSupport = 5
  ) {
    this.restore();
  }

  /** Find the concept that best matches a prototype (exact signature, then token similarity). */
  find(prototype: ConceptPrototype, threshold = 0.85): LearnedConcept | undefined {
    const exactId = this.prototypeIndex.get(prototype.signature);
    if (exactId) {
      const concept = this.concepts.get(exactId);
      if (concept) return structuredClone(concept);
    }
    let best: { concept: LearnedConcept; score: number } | undefined;
    for (const concept of this.concepts.values()) {
      if (concept.status === "DEPRECATED" || concept.status === "MERGED") continue;
      const score = prototypeSimilarity(prototype, concept.prototype);
      if (score >= threshold && (!best || score > best.score)) best = { concept, score };
    }
    return best ? structuredClone(best.concept) : undefined;
  }

  /** Observe a prototype: create or reinforce a concept and advance its lifecycle. */
  upsert(prototype: ConceptPrototype, input: ConceptUpsertInput): ConceptMutationResult {
    const existing = this.find(prototype, 0.999) ?? this.find(prototype, 0.85);
    if (existing) return this.reinforce(existing.conceptId, input);
    const conceptId = conceptIdForSignature(prototype.signature);
    const concept: LearnedConcept = {
      schemaVersion: 1,
      conceptId,
      displayName: displayNameForSignature(prototype.signature),
      prototype: { ...prototype, tokens: prototype.tokens ?? tokensOfSignature(prototype.signature) },
      support: 1,
      status: "CANDIDATE",
      createdAt: input.at,
      updatedAt: input.at,
      episodeIds: input.episodeId ? [input.episodeId] : []
    };
    this.concepts.set(conceptId, concept);
    this.prototypeIndex.set(prototype.signature, conceptId);
    this.persist();
    return { concept: structuredClone(concept), created: true, promoted: false };
  }

  /** Add support to an existing concept; promotion is CANDIDATE → OBSERVING → ACTIVE.
   *  Idempotent per episodeId: re-mining the same history never inflates support. */
  reinforce(conceptId: string, input: ConceptUpsertInput): ConceptMutationResult {
    const concept = this.concepts.get(conceptId);
    if (!concept) throw new Error(`Unknown concept: ${conceptId}`);
    const alreadyCounted = input.episodeId !== undefined && concept.episodeIds.includes(input.episodeId);
    const support = alreadyCounted ? concept.support : concept.support + 1;
    let status: ConceptStatus = concept.status;
    let promoted = false;
    if (status === "CANDIDATE" && support >= this.observingSupport) {
      status = "OBSERVING";
      promoted = true;
    }
    if (status === "OBSERVING" && support >= this.activationSupport) {
      status = "ACTIVE";
      promoted = true;
    }
    const next: LearnedConcept = {
      ...concept,
      support,
      status,
      updatedAt: input.at,
      prototype: { ...concept.prototype, vectorRef: input.vectorRef ?? concept.prototype.vectorRef },
      episodeIds: input.episodeId ? [...new Set([...concept.episodeIds, input.episodeId])] : concept.episodeIds
    };
    this.concepts.set(conceptId, next);
    this.prototypeIndex.set(next.prototype.signature, conceptId);
    this.persist();
    return { concept: structuredClone(next), created: false, promoted };
  }

  /** Rename for the UI only — identity and history are untouched (A22). */
  rename(conceptId: string, displayName: string): LearnedConcept | undefined {
    const concept = this.concepts.get(conceptId);
    if (!concept) return undefined;
    const next: LearnedConcept = { ...concept, displayName: displayName.slice(0, 120) || concept.displayName, updatedAt: new Date().toISOString() };
    this.concepts.set(conceptId, next);
    this.persist();
    return structuredClone(next);
  }

  setStatus(conceptId: string, status: ConceptStatus): LearnedConcept | undefined {
    const concept = this.concepts.get(conceptId);
    if (!concept) return undefined;
    const next: LearnedConcept = { ...concept, status, updatedAt: new Date().toISOString() };
    this.concepts.set(conceptId, next);
    this.persist();
    return structuredClone(next);
  }

  /**
   * Absorb one concept into another (merge, book §4.2). The absorbed concept is
   * marked MERGED with a pointer to the survivor and its history is preserved.
   */
  absorb(primaryId: string, secondaryId: string, at = new Date().toISOString()): { merged: LearnedConcept; absorbed: LearnedConcept } | undefined {
    const primary = this.concepts.get(primaryId);
    const secondary = this.concepts.get(secondaryId);
    if (!primary || !secondary || primaryId === secondaryId) return undefined;
    const merged: LearnedConcept = {
      ...primary,
      support: primary.support + secondary.support,
      episodeIds: [...new Set([...primary.episodeIds, ...secondary.episodeIds])],
      updatedAt: at
    };
    const absorbed: LearnedConcept = { ...secondary, status: "MERGED", mergedInto: primaryId, updatedAt: at };
    this.concepts.set(primaryId, merged);
    this.concepts.set(secondaryId, absorbed);
    this.persist();
    return { merged: structuredClone(merged), absorbed: structuredClone(absorbed) };
  }

  /**
   * Split a concept into children (book §4.2). The parent becomes SPLIT and keeps
   * its history; children carry parentConceptId.
   */
  split(parentId: string, groups: Array<{ signature: string; displayName?: string; episodeIds: string[] }>, at = new Date().toISOString()): LearnedConcept[] {
    const parent = this.concepts.get(parentId);
    if (!parent || groups.length < 2) return [];
    const children: LearnedConcept[] = groups.map((group) => {
      const conceptId = conceptIdForSignature(`${parent.prototype.signature}::${group.signature}`);
      const child: LearnedConcept = {
        schemaVersion: 1,
        conceptId,
        displayName: group.displayName ?? displayNameForSignature(group.signature),
        prototype: { kind: parent.prototype.kind, signature: group.signature, tokens: tokensOfSignature(group.signature) },
        support: group.episodeIds.length,
        status: group.episodeIds.length >= this.activationSupport ? "ACTIVE" : group.episodeIds.length >= this.observingSupport ? "OBSERVING" : "CANDIDATE",
        createdAt: at,
        updatedAt: at,
        parentConceptId: parentId,
        episodeIds: [...group.episodeIds]
      };
      return child;
    });
    for (const child of children) {
      this.concepts.set(child.conceptId, child);
      this.prototypeIndex.set(child.prototype.signature, child.conceptId);
    }
    const splitParent: LearnedConcept = { ...parent, status: "SPLIT", splitInto: children.map((child) => child.conceptId), updatedAt: at };
    this.concepts.set(parentId, splitParent);
    this.persist();
    return children.map((child) => structuredClone(child));
  }

  deprecate(conceptId: string): LearnedConcept | undefined {
    return this.setStatus(conceptId, "DEPRECATED");
  }

  get(conceptId: string): LearnedConcept | undefined {
    const concept = this.concepts.get(conceptId);
    return concept ? structuredClone(concept) : undefined;
  }

  /** Concepts usable for routing/conditioning (ACTIVE + OBSERVING). */
  usable(): LearnedConcept[] {
    return [...this.concepts.values()].filter((concept) => conceptIsUsable(concept.status)).map((concept) => structuredClone(concept));
  }

  list(): LearnedConcept[] {
    return [...this.concepts.values()].map((concept) => structuredClone(concept)).sort((a, b) => a.conceptId.localeCompare(b.conceptId));
  }

  count(): number {
    return this.concepts.size;
  }

  status(): { count: number; observingSupport: number; activationSupport: number; degradedReason?: string } {
    return { count: this.concepts.size, observingSupport: this.observingSupport, activationSupport: this.activationSupport, degradedReason: this.degraded };
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<ConceptRegistryFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.concepts)) throw new Error("Invalid concept registry file");
      for (const concept of parsed.concepts) {
        if (!concept || typeof concept.conceptId !== "string" || !concept.prototype) throw new Error("Invalid concept row");
        this.concepts.set(concept.conceptId, concept);
        this.prototypeIndex.set(concept.prototype.signature, concept.conceptId);
      }
      for (const [signature, conceptId] of Object.entries(parsed.prototypeIndex ?? {})) this.prototypeIndex.set(signature, conceptId);
    } catch (error) {
      this.concepts.clear();
      this.prototypeIndex.clear();
      this.degraded = `concepts unreadable: ${String(error)}`;
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: ConceptRegistryFile = { schemaVersion: 1, concepts: [...this.concepts.values()], prototypeIndex: Object.fromEntries(this.prototypeIndex) };
      writeJson(this.filePath, file);
    } catch (error) {
      this.degraded = `concept persist failed: ${String(error)}`;
    }
  }
}
