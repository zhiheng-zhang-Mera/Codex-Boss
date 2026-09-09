import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeJson } from "../commander/durable-json";
import { detectDedup, validateCandidate, type CandidateKnowledge, type DedupOutcome, type KnowledgeRecordVNext, type PipelineStage, type RawKnowledgeEvent, type ValidationVerdict } from "../../src/shared/tenx/knowledge";
import { TenxKnowledgeSpace } from "./knowledge-space";

/**
 * 10H: knowledge pipeline (forward, durable).
 *
 *   Raw Event → Artifact → Candidate → Validation/Dedup → Knowledge Record →
 *                            task-local retrieval
 *
 * A raw event is never knowledge by itself: every record must pass through an
 * artifact-backed candidate and a validation gate. Validation failures park the
 * candidate (explicit FAILED verdict), they never crash Boss. The pipeline is
 * append-oriented: stage progress + failure records are persisted so a later
 * failure never erases earlier provenance.
 */

export interface PipelineEventRecord {
  stage: PipelineStage;
  status: "ok" | "parked" | "duplicate";
  eventId?: string;
  candidateId?: string;
  outcome?: DedupOutcome;
  verdict?: ValidationVerdict;
  reason: string;
  at: string;
}

export interface PipelineStateFile {
  schemaVersion: 1;
  events: PipelineEventRecord[];
}

export class TenxKnowledgePipeline {
  private readonly events: PipelineEventRecord[] = [];

  constructor(
    private readonly store: TenxKnowledgeSpace,
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  /** Process one raw event through the pipeline; raw events are never direct knowledge. */
  process(event: RawKnowledgeEvent): { record?: KnowledgeRecordVNext; outcome: "recorded" | "duplicate" | "invalid"; reason: string } {
    const candidate = typeof event.payload === "string" ? this.candidateFromEvent(event) : undefined;
    if (!candidate) {
      this.append({ stage: "CANDIDATE", status: "parked", eventId: event.eventId, reason: "raw event payload is not an artifact-backed string (not knowledge by itself)" });
      return { outcome: "invalid", reason: "no artifact-backed candidate derived" };
    }
    this.append({ stage: "CANDIDATE", status: "ok", candidateId: candidate.candidateId, eventId: event.eventId, reason: "candidate derived from artifact" });

    const verdict = this.validate(candidate);
    if (verdict.outcome !== "valid") {
      this.append({ stage: "VALIDATION", status: "parked", candidateId: candidate.candidateId, verdict, reason: verdict.reason });
      return { outcome: "invalid", reason: verdict.reason };
    }
    this.append({ stage: "VALIDATION", status: "ok", candidateId: candidate.candidateId, reason: verdict.reason });

    const record = this.toRecord(candidate);
    const existing = this.store.list();
    const outcome = this.dedup(record, existing);
    if (outcome !== "new") {
      this.append({ stage: "DEDUP", status: "duplicate", candidateId: candidate.candidateId, outcome, reason: `${outcome}: knowledge already present` });
      return { outcome: "duplicate", reason: `${outcome}` };
    }
    this.append({ stage: "DEDUP", status: "ok", candidateId: candidate.candidateId, outcome, reason: "no duplicate detected" });

    const created = this.store.contribute({
      content: record.content,
      source: record.source,
      createdByNode: record.createdByNode,
      artifactRef: record.artifactRef,
      scope: record.scope,
      confidence: record.confidence,
      provenanceChain: record.provenance.chain,
      createdAt: record.createdAt
    });
    this.append({ stage: "RECORD", status: "ok", candidateId: candidate.candidateId, reason: `recorded ${created.knowledgeId}` });
    return { record: created, outcome: "recorded", reason: created.knowledgeId };
  }

  /** Durable audit trail of pipeline stage outcomes. */
  audit(): PipelineEventRecord[] {
    return [...this.events].map((event) => structuredClone(event));
  }

  private candidateFromEvent(event: RawKnowledgeEvent): CandidateKnowledge {
    return {
      candidateId: `cand-${createHash("sha256").update(event.eventId + event.payload).digest("hex").slice(0, 12)}`,
      artifactRef: `event:${event.eventId}`,
      content: event.payload as string,
      source: event.kind,
      nodeId: event.nodeId,
      proposedAt: event.occurredAt
    };
  }

  private validate(candidate: CandidateKnowledge): ValidationVerdict {
    return validateCandidate(candidate);
  }

  private dedup(record: KnowledgeRecordVNext, existing: KnowledgeRecordVNext[]): DedupOutcome {
    return detectDedup(record, existing, 0.85);
  }

  private toRecord(candidate: CandidateKnowledge): KnowledgeRecordVNext {
    const at = candidate.proposedAt || this.now();
    return {
      knowledgeId: `k-${createHash("sha256").update(candidate.content).digest("hex").slice(0, 16)}`,
      content: candidate.content,
      source: candidate.source,
      artifactRef: candidate.artifactRef,
      createdByNode: candidate.nodeId,
      createdAt: at,
      updatedAt: at,
      confidence: 0,
      scope: "global",
      validity: {},
      version: 1,
      provenance: { chain: [candidate.artifactRef] },
      state: "ACTIVE"
    };
  }

  private append(event: Omit<PipelineEventRecord, "at">): void {
    this.events.push({ ...event, at: this.now() });
    this.persist();
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PipelineStateFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.events)) throw new Error("Invalid tenx pipeline state");
    this.events.push(...parsed.events);
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: PipelineStateFile = { schemaVersion: 1, events: this.events };
    writeJson(this.filePath, file);
  }
}
