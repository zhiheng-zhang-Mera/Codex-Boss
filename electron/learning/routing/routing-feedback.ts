import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../../commander/durable-json";
import type { AdaptiveRoutingDecision } from "../../../src/shared/adaptive-routing";

/**
 * Engine Phase 6 — routing feedback ledger (durable, append-oriented).
 *
 * Stores every adaptive decision with enough explanation to answer "why B and
 * not A" (book §19) and links the episode produced by the selected candidate
 * back to the decision, so loop A (execution adaptation) and loop B (behaviour
 * learning) stay connected. Recording failures degrade learning only.
 */

export interface RoutingFeedbackRecord {
  schemaVersion: 1;
  decisionId: string;
  taskId: string;
  policyVersion: string;
  selectedRuntimeId?: string;
  usedFallbackRouter: boolean;
  candidates: Array<{ runtimeId: string; expectedUtility?: number; confidence?: number; explanation: string[] }>;
  exploration?: { enabled: boolean; reason?: string };
  episodeIds: string[];
  recordedAt: string;
}

export interface RoutingFeedbackFile {
  schemaVersion: 1;
  records: RoutingFeedbackRecord[];
}

export class RoutingFeedbackLedger {
  private readonly records = new Map<string, RoutingFeedbackRecord>();
  private degraded?: string;

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  record(decision: AdaptiveRoutingDecision): RoutingFeedbackRecord {
    const record: RoutingFeedbackRecord = {
      schemaVersion: 1,
      decisionId: decision.decisionId,
      taskId: decision.taskId,
      policyVersion: decision.policyVersion,
      selectedRuntimeId: decision.selectedRuntimeId,
      usedFallbackRouter: decision.usedFallbackRouter,
      candidates: decision.candidates.map((candidate) => ({
        runtimeId: candidate.runtimeId,
        expectedUtility: candidate.expectedUtility,
        confidence: candidate.confidence,
        explanation: [...candidate.explanation]
      })),
      exploration: decision.exploration,
      episodeIds: [],
      recordedAt: this.now()
    };
    this.records.set(record.decisionId, record);
    this.persist();
    return structuredClone(record);
  }

  /** Attach the episode produced by this decision (learning loop closure). */
  attachEpisode(decisionId: string, episodeId: string): RoutingFeedbackRecord | undefined {
    const record = this.records.get(decisionId);
    if (!record) return undefined;
    const next: RoutingFeedbackRecord = { ...record, episodeIds: [...new Set([...record.episodeIds, episodeId])] };
    this.records.set(decisionId, next);
    this.persist();
    return structuredClone(next);
  }

  get(decisionId: string): RoutingFeedbackRecord | undefined {
    const record = this.records.get(decisionId);
    return record ? structuredClone(record) : undefined;
  }

  /** Most recent decision for a task (used to attach the episode). */
  latestForTask(taskId: string): RoutingFeedbackRecord | undefined {
    const matches = [...this.records.values()].filter((record) => record.taskId === taskId);
    matches.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.decisionId.localeCompare(a.decisionId));
    return matches[0] ? structuredClone(matches[0]) : undefined;
  }

  /** Human-readable "why B not A" explanation (book §19, A35). */
  explain(decisionId: string, runtimeId?: string): string[] {
    const record = this.records.get(decisionId);
    if (!record) return ["unknown routing decision"];
    const target = runtimeId ?? record.selectedRuntimeId;
    const lines: string[] = [`selected ${target ?? "none"} for task ${record.taskId} (policy ${record.policyVersion})`];
    for (const candidate of record.candidates) {
      lines.push(`${candidate.runtimeId}: utility=${candidate.expectedUtility ?? "n/a"} confidence=${candidate.confidence ?? 0} — ${candidate.explanation.join("; ")}`);
    }
    if (record.usedFallbackRouter) lines.push("adaptive scorer unavailable/disabled — deterministic order used");
    return lines;
  }

  list(): RoutingFeedbackRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record)).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  }

  count(): number {
    return this.records.size;
  }

  status(): { count: number; degradedReason?: string } {
    return { count: this.records.size, degradedReason: this.degraded };
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<RoutingFeedbackFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error("Invalid routing feedback file");
      for (const record of parsed.records) {
        if (!record || typeof record.decisionId !== "string") throw new Error("Invalid routing feedback row");
        this.records.set(record.decisionId, record);
      }
    } catch (error) {
      this.records.clear();
      this.degraded = `routing feedback unreadable: ${String(error)}`;
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: RoutingFeedbackFile = { schemaVersion: 1, records: [...this.records.values()] };
      writeJson(this.filePath, file);
    } catch (error) {
      this.degraded = `routing feedback persist failed: ${String(error)}`;
    }
  }
}
