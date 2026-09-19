/**
 * Case Record — the durable, append-only case log.
 *
 * One JSONL file per root, one row per EVENT, never a snapshot per case. That is what makes the
 * store genuinely append-only rather than append-shaped: a case that changes writes another row,
 * and a reader folds the rows. A torn row costs one row and is counted, so a damaged log reports
 * itself instead of quietly shortening a history.
 *
 * The store records. It does not diagnose and it does not treat: it has no method that produces a
 * hypothesis and none that performs an action.
 */

import fs from "node:fs";
import path from "node:path";
import {
  CASE_SCHEMA_VERSION,
  type CaseEvent,
  type CaseProvenance,
  type CaseTimeline,
  type SelfDiagnosisCase
} from "../../src/shared/self-case-record/case";
import { appendEvent, foldCase, openCase, type TimelineOperation } from "../../src/shared/self-case-record/timeline";
import { lessonCandidates, priorEvidenceOf, type LessonCandidate } from "../../src/shared/self-case-record/recurrence";
import { dogfoodMetrics, type DogfoodMetrics } from "../../src/shared/self-case-record/dogfood";
import type { PriorEvidence } from "../../src/shared/self-diagnosis/hypotheses";

export const CASE_LOG_FILENAME = "case-record.jsonl";

export interface CaseStoreOptions {
  rootDir: string;
  now?: () => string;
}

export interface CaseStoreStatus {
  schemaVersion: number;
  rootDir: string;
  file: string;
  cases: number;
  events: number;
  open: number;
  closed: number;
  recurrent: number;
  unreadableRows: number;
  bytes: number;
  degradedReason?: string;
}

export class CaseStore {
  private readonly options: CaseStoreOptions;
  private readonly now: () => string;
  private unreadableRows = 0;
  private degradedReason?: string;

  constructor(options: CaseStoreOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private file(): string {
    return path.join(this.options.rootDir, CASE_LOG_FILENAME);
  }

  /**
   * Every event in the log, grouped by case and ordered by sequence.
   *
   * A row that cannot be parsed is counted and skipped: one damaged row must not cost the case, and
   * it must not be invisible either.
   */
  timelines(): CaseTimeline[] {
    const file = this.file();
    if (!fs.existsSync(file)) return [];
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      this.degradedReason = `${CASE_LOG_FILENAME} could not be read: ${error instanceof Error ? error.message : String(error)}`;
      return [];
    }
    const byCase = new Map<string, CaseEvent[]>();
    this.unreadableRows = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        const parsed = JSON.parse(line) as CaseEvent & { caseId?: string };
        if (typeof parsed.caseId !== "string" || typeof parsed.sequence !== "number") {
          this.unreadableRows += 1;
          continue;
        }
        byCase.set(parsed.caseId, [...(byCase.get(parsed.caseId) ?? []), parsed]);
      } catch {
        this.unreadableRows += 1;
      }
    }
    return [...byCase.entries()]
      .map(([caseId, events]) => ({ caseId, events: [...events].sort((left, right) => left.sequence - right.sequence) }))
      .sort((left, right) => (left.caseId < right.caseId ? -1 : 1));
  }

  /** Every case the log folds to, with the fold's problems reported rather than hidden. */
  records(): Array<{ record: SelfDiagnosisCase; problems: string[] }> {
    return this.timelines().map((timeline) => {
      const folded = foldCase(timeline);
      return { record: folded.case as SelfDiagnosisCase, problems: folded.problems };
    });
  }

  record(caseId: string): SelfDiagnosisCase | undefined {
    return this.records().find((entry) => entry.record.caseId === caseId)?.record;
  }

  private appendRow(caseId: string, event: CaseEvent): void {
    fs.mkdirSync(this.options.rootDir, { recursive: true });
    fs.appendFileSync(this.file(), `${JSON.stringify({ ...event, caseId })}\n`, "utf8");
  }

  /** Opens a case and writes its first event. */
  openCase(input: { caseId: string; at?: string; trigger: string; provenance: CaseProvenance; affectedComponents?: readonly string[]; symptoms?: readonly import("../../src/shared/self-diagnosis/hypotheses").DiagnosticSymptom[]; relatedTasks?: readonly string[]; relatedCommits?: readonly string[]; relatedRuntimeEvents?: readonly string[] }): TimelineOperation {
    if (this.record(input.caseId) !== undefined) return { ok: false, problems: [`a case ${input.caseId} already exists: a case is never opened twice, and a recurrence is a link rather than a second opening`] };
    const opened = openCase({ ...input, at: input.at ?? this.now(), caseId: input.caseId });
    if (!opened.ok || opened.timeline === undefined) return opened;
    this.appendRow(input.caseId, opened.timeline.events[0]);
    return { ...opened, timeline: opened.timeline };
  }

  /** Appends one event to an existing case. */
  append(input: { caseId: string; type: CaseEvent["type"]; at?: string; detail: Record<string, unknown> }): TimelineOperation {
    const timeline = this.timelines().find((entry) => entry.caseId === input.caseId);
    if (timeline === undefined) return { ok: false, problems: [`no case ${input.caseId} is recorded, so there is nothing to append to`] };
    const applied = appendEvent(timeline, { at: input.at ?? this.now(), type: input.type, detail: input.detail });
    if (!applied.ok || applied.timeline === undefined) return applied;
    this.appendRow(input.caseId, applied.timeline.events[applied.timeline.events.length - 1]);
    return applied;
  }

  /** The lesson candidates this log's closed cases have earned. */
  lessonCandidates(at?: string): LessonCandidate[] {
    return lessonCandidates({ cases: this.records().map((entry) => entry.record), at: at ?? this.now() });
  }

  /** The prior evidence a diagnosis may use about one component. */
  priorEvidence(input: { componentId: string; failureMode?: string }): PriorEvidence[] {
    return priorEvidenceOf({ cases: this.records().map((entry) => entry.record), ...input });
  }

  /** The dogfood metrics over the cases this store holds. */
  dogfood(at?: string): DogfoodMetrics {
    return dogfoodMetrics({ cases: this.records().map((entry) => entry.record), at: at ?? this.now() });
  }

  status(): CaseStoreStatus {
    const timelines = this.timelines();
    const records = timelines.map((timeline) => foldCase(timeline).case as SelfDiagnosisCase);
    let bytes = 0;
    try {
      bytes = fs.existsSync(this.file()) ? fs.statSync(this.file()).size : 0;
    } catch {
      bytes = 0;
    }
    return {
      schemaVersion: CASE_SCHEMA_VERSION,
      rootDir: this.options.rootDir,
      file: this.file(),
      cases: timelines.length,
      events: timelines.reduce((total, timeline) => total + timeline.events.length, 0),
      open: records.filter((record) => record.closedAt === undefined).length,
      closed: records.filter((record) => record.closedAt !== undefined).length,
      recurrent: records.filter((record) => record.status === "RECURRENT").length,
      unreadableRows: this.unreadableRows,
      bytes,
      ...(this.degradedReason === undefined ? {} : { degradedReason: this.degradedReason })
    };
  }
}
