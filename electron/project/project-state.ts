import { readJson, writeJson } from "../commander/durable-json";
import { buildGoalTree, summaryOf, type ProjectStateSummary } from "../../src/shared/project-tree";

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

  /** Renderer-safe projection (plan AP15 goal-tree UI). */
  summary(workspaceId: string): ProjectStateSummary {
    const state = this.load(workspaceId);
    const tree = buildGoalTree(state.goals);
    return {
      workspaceId,
      goals: tree.valid ? tree.roots : [],
      decisionCount: state.decisions.length,
      researchCount: state.research.length,
      openQuestions: [...state.openQuestions],
      nextActions: [...state.nextActions],
      tree: summaryOf(state.goals),
      updatedAt: state.updatedAt
    };
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

  /** Upserts a goal node in the goal tree (dedupe by id; default root). */
  upsertGoal(workspaceId: string, goal: { id: string; title: string; parent?: string; status?: GoalNode["status"] }): void {
    const state = this.load(workspaceId);
    const existing = state.goals.find((item) => item.id === goal.id);
    const record: GoalNode = { id: goal.id, title: goal.title, ...(goal.parent ? { parent: goal.parent } : existing?.parent ? { parent: existing.parent } : {}), status: goal.status ?? existing?.status ?? "open" };
    state.goals = existing ? state.goals.map((item) => (item.id === goal.id ? record : item)) : [...state.goals, record];
    this.save(state);
  }

  setGoalStatus(workspaceId: string, goalId: string, status: GoalNode["status"]): void {
    const state = this.load(workspaceId);
    const goal = state.goals.find((item) => item.id === goalId);
    if (!goal) throw new Error(`Unknown goal: ${goalId}`);
    goal.status = status;
    this.save(state);
  }

  /**
   * Records a completed task: appends a research-ledger entry and an accepted
   * decision, marks the goal it advanced (by title match or explicit goal id)
   * done, and appends next actions. Deterministic; used by the completion
   * recorder (AP15 seam).
   */
  recordTaskCompletion(workspaceId: string, input: { taskId: string; title: string; goalId?: string; findings: string; nextActions?: string[] }): { decision: DecisionRecord; research: ResearchLedgerEntry } {
    const state = this.load(workspaceId);
    const goal = input.goalId ? state.goals.find((item) => item.id === input.goalId) : state.goals.find((item) => item.title.toLocaleLowerCase() === input.title.toLocaleLowerCase());
    if (goal) { goal.status = "done"; this.save(state); }
    const decision = this.appendDecision(workspaceId, { decision: `Task completed: ${input.title}`, outcome: "accepted", reason: input.findings.slice(0, 400), evidenceRefs: [input.taskId] });
    const research = this.appendResearch(workspaceId, { question: input.title, findings: input.findings.slice(0, 2000), changedDecisionIds: [decision.id] });
    if (input.nextActions?.length) {
      const state2 = this.load(workspaceId);
      state2.nextActions = [...new Set([...state2.nextActions, ...input.nextActions])].slice(0, 100);
      this.save(state2);
    }
    return { decision, research };
  }
}

export function emptyState(workspaceId: string): ProjectState {
  return { workspaceId, goals: [], decisions: [], constraints: [], openQuestions: [], nextActions: [], research: [], updatedAt: new Date(0).toISOString() };
}
