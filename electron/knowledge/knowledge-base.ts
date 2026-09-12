/**
 * Update-Plan/checkpoint-1.md §5.3/§5.4 — the durable knowledge base.
 *
 * One file, one writer, non-destructive by construction:
 *
 *   - every accepted revision is APPENDED; a superseded object is marked
 *     SUPERSEDED and kept forever (unlike the older `KnowledgeStore.put`, which
 *     filtered the superseded row out of the file — see the CP2 audit in
 *     docs/checkpoint-2-knowledge-foundation.md);
 *   - a candidate the gate refuses is either discarded (REJECT — never stored at
 *     all) or parked in the quarantine area (QUARANTINE), never written into the
 *     active set;
 *   - every gate decision is appended to an audit log with its five phases, so
 *     "why is this knowledge here?" is answerable from the file alone.
 *
 * The store owns persistence only; every decision is made by the pure gate in
 * src/shared/knowledge-object.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../commander/durable-json";
import {
  conflictMemberFor,
  conflictSetIdFor,
  gateKnowledgeWrite,
  knowledgeIdFor,
  knowledgeKeyFor,
  resolveKnowledgeConflict,
  type KnowledgeCandidate,
  type KnowledgeConflictSet,
  type KnowledgeGatePhase,
  type KnowledgeObject,
  type KnowledgeStatus,
  type KnowledgeType,
  type KnowledgeWriteOutcome
} from "../../src/shared/knowledge-object";
import type { KnowledgeScope } from "../../src/shared/tenx/knowledge";

export interface KnowledgeGateLogEntry {
  at: string;
  type: KnowledgeType;
  scope: KnowledgeScope;
  subject: string;
  source: string;
  source_hash: string;
  authority: string;
  producer: string;
  verification: string;
  task_ref?: string;
  document_ref?: string;
  outcome: KnowledgeWriteOutcome;
  phases: KnowledgeGatePhase[];
  reasons: string[];
  object_id?: string;
  supersedes?: string;
  conflicts_with: string[];
  deduplicated: boolean;
}

export interface KnowledgeBaseFile {
  schemaVersion: 1;
  /** Every revision ever accepted, ACTIVE or SUPERSEDED. Never pruned. */
  objects: KnowledgeObject[];
  /** Parked candidates (self-certified, weaker or contradictory claims). */
  quarantine: KnowledgeObject[];
  conflicts: KnowledgeConflictSet[];
  gate_log: KnowledgeGateLogEntry[];
}

export interface KnowledgeCommitResult {
  outcome: KnowledgeWriteOutcome;
  reasons: string[];
  object?: KnowledgeObject;
  conflictSet?: KnowledgeConflictSet;
  deduplicated: boolean;
}

export interface KnowledgeBaseSummary {
  active: number;
  superseded: number;
  quarantined: number;
  conflicts: number;
  unresolvedConflicts: number;
  rejected: number;
  byType: Partial<Record<KnowledgeType, number>>;
  scopes: KnowledgeScope[];
}

const EMPTY: KnowledgeBaseFile = { schemaVersion: 1, objects: [], quarantine: [], conflicts: [], gate_log: [] };

export class KnowledgeBase {
  private value: KnowledgeBaseFile;

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.value = this.load();
  }

  /* ---------------- §5.3 write path ---------------- */

  /**
   * Runs one candidate through the gate and applies the outcome. The gate reads
   * the ACTIVE set only: quarantined or superseded claims never block a better
   * fact from being recorded.
   */
  commit(candidate: KnowledgeCandidate, options: { producerId?: string } = {}): KnowledgeCommitResult {
    const at = this.now();
    const existing = this.value.objects.filter((object) => object.status === "ACTIVE");
    const result = gateKnowledgeWrite(candidate, existing, { now: at, ...options });
    const log: KnowledgeGateLogEntry = {
      at,
      type: candidate.type,
      scope: candidate.scope,
      subject: candidate.subject,
      source: candidate.source,
      source_hash: candidate.source_hash,
      authority: candidate.authority,
      producer: candidate.producer,
      verification: candidate.verification,
      outcome: result.outcome,
      phases: result.phases,
      reasons: result.reasons,
      conflicts_with: result.conflicts_with,
      deduplicated: result.deduplicated
    };
    if (candidate.task_ref) log.task_ref = candidate.task_ref;
    if (candidate.document_ref) log.document_ref = candidate.document_ref;

    let conflictSet: KnowledgeConflictSet | undefined;
    let decided = false;

    if (result.outcome === "ACCEPT" && result.object) {
      if (!result.deduplicated) this.value.objects.push(result.object);
      log.object_id = result.object.id;
    } else if (result.outcome === "SUPERSEDE" && result.object) {
      const superseded = this.value.objects.find((object) => object.id === result.supersedes);
      if (superseded) {
        superseded.status = "SUPERSEDED";
        superseded.updatedAt = at;
      }
      this.value.objects.push(result.object);
      log.object_id = result.object.id;
      log.supersedes = result.supersedes;
      conflictSet = this.openConflictSet([result.object, ...(superseded ? [superseded] : [])], at, {
        winnerId: result.object.id,
        resolution: "ACTIVE",
        reasons: ["a stronger, verified claim superseded the previous active knowledge", ...result.reasons]
      });
      decided = true;
    } else if (result.outcome === "QUARANTINE") {
      const challenger = this.parkQuarantined(candidate, at);
      log.object_id = challenger.id;
      if (result.conflicts_with.length) {
        const members = this.value.objects.filter((object) => result.conflicts_with.includes(object.id));
        conflictSet = this.openConflictSet([...members, challenger], at);
      }
    }
    // REJECT stores nothing at all — the audit log is the only trace.

    this.value.gate_log.push(log);
    if (!decided) this.reconcileConflictSet(conflictSet, at);
    this.persist();
    const commit: KnowledgeCommitResult = { outcome: result.outcome, reasons: result.reasons, deduplicated: result.deduplicated };
    if (result.object) commit.object = result.object;
    if (conflictSet) commit.conflictSet = conflictSet;
    return commit;
  }

  /**
   * §5.4 for a claim the gate refused to activate: it is materialized with the
   * conflict decision as its status and parked outside the active set, so it is
   * visible to an owner and invisible to retrieval. The id is content-derived,
   * so committing the same refused claim twice parks it once.
   */
  private parkQuarantined(candidate: KnowledgeCandidate, at: string): KnowledgeObject {
    const id = `kq-${knowledgeIdFor(candidate).slice(3)}`;
    const existing = this.value.quarantine.find((object) => object.id === id);
    if (existing) { existing.updatedAt = at; return existing; }
    const parked: KnowledgeObject = {
      id,
      type: candidate.type,
      scope: candidate.scope,
      subject: candidate.subject.replace(/\s+/g, " ").trim().toLocaleLowerCase(),
      key: knowledgeKeyFor(candidate),
      source: candidate.source,
      content: candidate.content,
      summary: candidate.summary,
      provenance: {
        source: candidate.source,
        source_hash: candidate.source_hash,
        captured_at: candidate.captured_at,
        producer: candidate.producer,
        produced_by: candidate.produced_by,
        verification: candidate.verification,
        verification_evidence: [...(candidate.verification_evidence ?? [])]
      },
      confidence: candidate.confidence,
      authority: candidate.authority,
      freshness: candidate.freshness,
      status: "UNRESOLVED",
      version: 0,
      createdAt: at,
      updatedAt: at
    };
    if (candidate.document_ref) parked.provenance.document_ref = candidate.document_ref;
    if (candidate.task_ref) parked.provenance.task_ref = candidate.task_ref;
    if (candidate.run_ref) parked.provenance.run_ref = candidate.run_ref;
    this.value.quarantine.push(parked);
    return parked;
  }

  private openConflictSet(members: KnowledgeObject[], at: string, decision?: { winnerId?: string; resolution: KnowledgeStatus; reasons: string[] }): KnowledgeConflictSet {
    const first = members[0];
    const key = first.key;
    const existing = this.value.conflicts.find((set) => set.key === key && set.resolution === "UNRESOLVED");
    const target = existing ?? {
      id: conflictSetIdFor(key),
      key,
      scope: first.scope,
      type: first.type,
      subject: first.subject,
      members: [],
      resolution: "UNRESOLVED" as KnowledgeStatus,
      superseded_ids: [],
      reasons: [],
      createdAt: at,
      updatedAt: at
    };
    for (const member of members) {
      if (!target.members.some((entry) => entry.object_id === member.id)) target.members.push(conflictMemberFor(member));
    }
    target.updatedAt = at;
    if (decision) {
      target.resolution = decision.resolution;
      if (decision.winnerId) target.winner_id = decision.winnerId;
      target.superseded_ids = target.members.filter((member) => member.object_id !== decision.winnerId).map((member) => member.object_id);
      target.reasons = [...decision.reasons];
    }
    if (!existing) this.value.conflicts.push(target);
    return target;
  }

  /** Applies the deterministic §5.4 decision to a conflict the gate opened. */
  private reconcileConflictSet(set: KnowledgeConflictSet | undefined, at: string): void {
    if (!set) return;
    const resolution = resolveKnowledgeConflict(set, at);
    set.resolution = resolution.resolution;
    set.superseded_ids = resolution.superseded_ids;
    if (resolution.winner_id) set.winner_id = resolution.winner_id;
    set.reasons = [...new Set([...set.reasons, ...resolution.reasons])];
    set.updatedAt = at;
    for (const [objectId, status] of Object.entries(resolution.statuses)) {
      const parked = this.value.quarantine.find((object) => object.id === objectId);
      if (parked) parked.status = status === "ACTIVE" ? "UNRESOLVED" : status;
    }
  }

  /**
   * §5.4 owner decision surface: closes an UNRESOLVED conflict without deleting
   * anything. The loser becomes SUPERSEDED, never absent.
   */
  decideConflict(setId: string, decision: { owner: string; winnerId?: string; resolution: "ACTIVE" | "SUPERSEDED"; reason: string }): KnowledgeConflictSet {
    const set = this.value.conflicts.find((entry) => entry.id === setId);
    if (!set) throw new Error(`Unknown knowledge conflict: ${setId}`);
    const at = this.now();
    const winner = decision.winnerId ?? set.members[0]?.object_id;
    set.resolution = decision.resolution;
    if (winner) set.winner_id = winner;
    set.superseded_ids = set.members.filter((member) => member.object_id !== winner).map((member) => member.object_id);
    set.reasons = [...set.reasons, `owner decision by ${decision.owner}: ${decision.reason}`];
    set.updatedAt = at;
    for (const member of set.members) {
      const object = this.value.objects.find((entry) => entry.id === member.object_id);
      if (object) { object.status = member.object_id === winner ? "ACTIVE" : "SUPERSEDED"; object.updatedAt = at; }
      const parked = this.value.quarantine.find((entry) => entry.id === member.object_id);
      if (parked) parked.status = member.object_id === winner ? "ACTIVE" : "SUPERSEDED";
    }
    this.persist();
    return set;
  }

  /* ---------------- read surface ---------------- */

  /** Every revision ever accepted (ACTIVE and SUPERSEDED). */
  objects(): KnowledgeObject[] {
    return this.value.objects.map((object) => structuredClone(object));
  }

  active(scope?: KnowledgeScope): KnowledgeObject[] {
    return this.value.objects.filter((object) => object.status === "ACTIVE" && (!scope || object.scope === scope)).map((object) => structuredClone(object));
  }

  quarantine(): KnowledgeObject[] {
    return this.value.quarantine.map((object) => structuredClone(object));
  }

  conflicts(): KnowledgeConflictSet[] {
    return this.value.conflicts.map((set) => structuredClone(set));
  }

  unresolvedConflicts(): KnowledgeConflictSet[] {
    return this.value.conflicts.filter((set) => set.resolution === "UNRESOLVED").map((set) => structuredClone(set));
  }

  gateLog(): KnowledgeGateLogEntry[] {
    return this.value.gate_log.map((entry) => structuredClone(entry));
  }

  history(id: string): KnowledgeObject[] {
    return this.value.objects.filter((object) => object.id === id).map((object) => structuredClone(object));
  }

  summary(): KnowledgeBaseSummary {
    const byType: Partial<Record<KnowledgeType, number>> = {};
    for (const object of this.value.objects.filter((entry) => entry.status === "ACTIVE")) {
      byType[object.type] = (byType[object.type] ?? 0) + 1;
    }
    return {
      active: this.value.objects.filter((object) => object.status === "ACTIVE").length,
      superseded: this.value.objects.filter((object) => object.status === "SUPERSEDED").length,
      quarantined: this.value.quarantine.length,
      conflicts: this.value.conflicts.length,
      unresolvedConflicts: this.value.conflicts.filter((set) => set.resolution === "UNRESOLVED").length,
      rejected: this.value.gate_log.filter((entry) => entry.outcome === "REJECT").length,
      byType,
      scopes: [...new Set(this.value.objects.filter((object) => object.status === "ACTIVE").map((object) => object.scope))].sort()
    };
  }

  /* ---------------- persistence ---------------- */

  private load(): KnowledgeBaseFile {
    if (!this.filePath) return structuredClone(EMPTY);
    try {
      const parsed = readJson<KnowledgeBaseFile>(this.filePath);
      if (!parsed) return structuredClone(EMPTY);
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.objects)) throw new Error("invalid schema");
      return {
        schemaVersion: 1,
        objects: parsed.objects,
        quarantine: Array.isArray(parsed.quarantine) ? parsed.quarantine : [],
        conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
        gate_log: Array.isArray(parsed.gate_log) ? parsed.gate_log : []
      };
    } catch (error) {
      // §2.5 fault isolation: a corrupt knowledge file must never stop Boss from
      // starting. It is reported through `loadFailure()` instead of being
      // silently overwritten — nothing is written until the next commit.
      this.loadError = String((error as Error).message ?? error);
      return structuredClone(EMPTY);
    }
  }

  /** Non-empty when the on-disk file could not be read (never hidden). */
  loadFailure(): string | undefined {
    return this.loadError;
  }
  private loadError?: string;

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeJson(this.filePath, this.value);
  }
}
