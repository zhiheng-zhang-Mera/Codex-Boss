import { readJson, writeJson } from "../commander/durable-json";

/**
 * Workspace Project State + Research Ledger (plan AP15). A goal tree with
 * initiatives, accepted/rejected decision history, constraints, open
 * questions, next actions, and a research ledger that records what was
 * investigated, why and what changed — linked to a reproducibility snapshot
 * when one exists.
 */

export interface GoalNode {
  id: string;
  title: string;
  parent?: string;         // goal tree parent id; absent = root
  status: "open" | "active" | "done" | "abandoned";
}

export interface DecisionRecord {
  id: string;
  decision: string;
  outcome: "accepted" | "rejected";
  reason: string;
  evidenceRefs: string[];
  at: string;
}

export interface ResearchLedgerEntry {
  id: string;
  question: string;
  investigatedAt: string;
  findings: string;
  reproSnapshotId?: string;
  changedDecisionIds: string[];
}

export interface ProjectState {
  workspaceId: string;
  goals: GoalNode[];
  decisions: DecisionRecord[];
  constraints: string[];
  openQuestions: string[];
  nextActions: string[];
  research: ResearchLedgerEntry[];
  updatedAt: string;
}

export interface ProjectStateFile {
  schemaVersion: 1;
  state: ProjectState;
}

export class ProjectStateStore {
  constructor(private readonly file: string) {}

  load(workspaceId: string): ProjectState {
    const value = readJson<Partial<ProjectStateFile>>(this.file);
    if (!value) return emptyState(workspaceId);
    if (value.schemaVersion !== 1 || !value.state) throw new Error("Invalid project state");
    if (value.state.workspaceId !== workspaceId) return emptyState(workspaceId);
    return value.state;
  }

  save(state: ProjectState): void {
    writeJson(this.file, { schemaVersion: 1, state: { ...state, updatedAt: new Date().toISOString() } });
  }

  appendDecision(workspaceId: string, decision: Omit<DecisionRecord, "id" | "at">): DecisionRecord {
    const state = this.load(workspaceId);
    const record: DecisionRecord = { ...decision, id: `decision-${Date.now()}-${state.decisions.length}`, at: new Date().toISOString() };
    state.decisions.push(record);
    this.save(state);
    return record;
  }

  appendResearch(workspaceId: string, entry: Omit<ResearchLedgerEntry, "id" | "investigatedAt">): ResearchLedgerEntry {
    const state = this.load(workspaceId);
    const record: ResearchLedgerEntry = { ...entry, id: `research-${Date.now()}-${state.research.length}`, investigatedAt: new Date().toISOString() };
    state.research.push(record);
    this.save(state);
    return record;
  }

  setOpenQuestions(workspaceId: string, questions: string[]): void {
    const state = this.load(workspaceId);
    state.openQuestions = questions.slice(0, 200);
    state.nextActions = [...state.nextActions];
    this.save(state);
  }
}

export function emptyState(workspaceId: string): ProjectState {
  return { workspaceId, goals: [], decisions: [], constraints: [], openQuestions: [], nextActions: [], research: [], updatedAt: new Date(0).toISOString() };
}
