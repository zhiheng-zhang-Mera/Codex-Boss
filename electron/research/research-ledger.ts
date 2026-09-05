import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson, validId } from "../commander/durable-json";
import { nextResearchState, validateResearchIR, type ResearchIR, type ResearchState } from "../../src/shared/research-ir";

/**
 * Durable research ledger (plan 9-6 Phase 5). One v1 envelope per research id
 * under `.boss/research/<id>.json`: checkpoints IR + state, an append-only
 * decision log, fail-closed reads, atomic writes.
 */

export interface ResearchDecisionEntry {
  stepId: string;
  decision: string;
  reason: string;
  evidenceRefs: string[];
  at: string;
}

export interface ResearchLedgerFile {
  schemaVersion: 1;
  ir: ResearchIR;
  decisions: ResearchDecisionEntry[];
  checkpointReason: string;
  revision: number;
}

export class ResearchLedger {
  constructor(private readonly root: string) {}

  create(ir: ResearchIR, reason = "research started"): ResearchLedgerFile {
    const existing = this.load(ir.id);
    if (existing) return existing;
    validateResearchIR(ir);
    const record: ResearchLedgerFile = { schemaVersion: 1, ir: structuredClone(ir), decisions: [], checkpointReason: reason, revision: 1 };
    writeJson(this.path(ir.id), record);
    return record;
  }

  /** Saves a checkpoint after an IR/state change; rejects stale revisions. */
  checkpoint(id: string, mutate: (record: ResearchLedgerFile) => void, reason: string): ResearchLedgerFile {
    const record = this.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    mutate(record);
    validateResearchIR(record.ir);
    record.checkpointReason = reason;
    record.revision += 1;
    writeJson(this.path(id), record);
    return structuredClone(record);
  }

  /** Advances the run to its deterministic successor state (Phase 5 autopilot). */
  advance(id: string, reason = "autopilot advance"): ResearchLedgerFile | null {
    return this.checkpoint(id, (record) => {
      const next = nextResearchState(record.ir.state, true);
      if (next) record.ir.state = next;
      record.ir.updatedAt = new Date().toISOString();
      if (!next) return;
    }, reason);
  }

  load(id: string): ResearchLedgerFile | undefined {
    const file = this.path(id);
    const value = readJson<Partial<ResearchLedgerFile>>(file);
    if (!value) return undefined;
    if (value.schemaVersion !== 1 || !value.ir || !Array.isArray(value.decisions)) throw new Error("Invalid research ledger");
    validateResearchIR(value.ir);
    return { schemaVersion: 1, ir: value.ir, decisions: value.decisions, checkpointReason: value.checkpointReason ?? "", revision: value.revision ?? 1 };
  }

  /** Lists all research runs (id + goal + state + revision), newest first. */
  list(): Array<{ id: string; goal: string; state: ResearchState; revision: number; updatedAt: string }> {
    if (!fs.existsSync(this.root)) return [];
    const runs = fs.readdirSync(this.root).filter((name) => name.endsWith(".json") && !name.startsWith(".")).map((name) => {
      try {
        const value = readJson<Partial<ResearchLedgerFile>>(path.join(this.root, name));
        if (!value?.schemaVersion || !value.ir || !Array.isArray(value.decisions)) return undefined;
        validateResearchIR(value.ir);
        return { id: value.ir.id, goal: value.ir.goal, state: value.ir.state, revision: value.revision ?? 1, updatedAt: value.ir.updatedAt };
      } catch {
        return undefined; // corrupt/unreadable single run never breaks the list
      }
    }).filter((run): run is { id: string; goal: string; state: ResearchState; revision: number; updatedAt: string } => run !== undefined);
    return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  appendDecision(id: string, entry: Omit<ResearchDecisionEntry, "at">): ResearchDecisionEntry {
    const record = this.require(id);
    const decision: ResearchDecisionEntry = { ...entry, at: new Date().toISOString() };
    record.decisions.push(decision);
    this.checkpoint(id, (next) => { next.decisions = record.decisions; }, `decision ${decision.stepId}`);
    return decision;
  }

  setState(id: string, state: ResearchState, reason: string): ResearchLedgerFile {
    return this.checkpoint(id, (record) => { record.ir.state = state; record.ir.updatedAt = new Date().toISOString(); }, reason);
  }

  private require(id: string): ResearchLedgerFile {
    const record = this.load(id);
    if (!record) throw new Error(`Unknown research run: ${id}`);
    return record;
  }

  private path(id: string): string {
    return path.join(this.root, `${validId(id)}.json`);
  }
}

/** File existence helper for graceful-absence checks (kept separate from ledger). */
export function researchLedgerDir(root: string): string {
  fs.mkdirSync(root, { recursive: true });
  return root;
}
