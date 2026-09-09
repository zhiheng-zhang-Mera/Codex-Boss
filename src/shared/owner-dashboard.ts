/**
 * Owner dashboard read-model (Owner-Result.md Rev.2 §37/§38/§44). Pure + shareable.
 *
 * Owner UI shows only GOAL / STATUS / PROGRESS / RESULT / EVIDENCE /
 * HARD_BLOCKER. Every internal decision stays in the decision ledger (§38) and
 * is summarized here for post-hoc audit — never surfaced as a pre-approval.
 * This module computes the read-model from an AppSnapshot plus ledger entries;
 * the renderer just renders it.
 */

import type { AppSnapshot, BossTask, EvidenceDecision, FinalResponse } from "./contracts";
import type { DecisionLedgerEntry } from "./decision-ledger";
import type { InterventionKind } from "./intervention";
import type { RunMode } from "./owner-result";

/** §44 hard-blocker buckets shown to the owner. */
export type OwnerBlocker = "HB1" | "HB2" | "HB3" | "HB4" | "OPERATOR_QUESTION" | "NONE";

/** Legacy intervention kinds → owner-visible blocker bucket. */
export function blockerForIntervention(kind: InterventionKind): OwnerBlocker {
  switch (kind) {
    case "LOGIN":
    case "CAPTCHA":
    case "AUTHORIZATION":
      return "HB1";
    case "BUDGET":
    case "EXTERNAL_ACTION":
      return "HB2";
    default:
      return "OPERATOR_QUESTION";
  }
}

export interface OwnerTaskCard {
  taskId: string;
  goal: string;
  status: string;
  runMode: RunMode;
  /** PROGRESS: what the system is doing right now (or waiting on). */
  progressLabel: string;
  /** RESULT: a final response exists and when it was finalized. */
  result?: { source: FinalResponse["source"]; finalizedAt: string; preview: string };
  /** EVIDENCE: the last evidence decision for the task. */
  evidence?: { decision: EvidenceDecision; artifacts: number; claims: number; heldClaims: number };
  /** HARD_BLOCKER: only HB1–HB4 (or an operator question under ASSISTED). */
  hardBlocker: OwnerBlocker;
  blockerDetail?: string;
}

export interface OwnerDashboardSummary {
  generatedAt: string;
  counts: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    hardBlockers: number;
    /** §44: decisions made internally (question-interceptor/direction-stall/…). */
    internalAutoDecisions: number;
  };
  tasks: OwnerTaskCard[];
}

const RUNNING_STATUSES = new Set(["queued", "running", "waiting", "paused"]);
const OWNER_RESULT_DECISION_SOURCES = new Set(["question-interceptor", "direction-stall", "continuation-controller", "episode-supervisor", "result-validator", "provider-replacement", "recovery", "planner"]);

export interface DashboardInput {
  snapshot: Pick<AppSnapshot, "tasks" | "finalResponses" | "evidenceBundles">;
  interventions?: Array<{ taskId: string; kind: InterventionKind; question: string; resolvedAt?: string }>;
  ledgerEntries?: DecisionLedgerEntry[];
  /** Tasks with an active (unresolved) operator question. */
  activeInterventionTaskIds?: Iterable<string>;
  now?: () => string;
}

function lastEvidenceDecision(snapshot: DashboardInput["snapshot"], taskId: string): { decision: EvidenceDecision; artifacts: number; claims: number; heldClaims: number } | undefined {
  const bundles = snapshot.evidenceBundles.filter((bundle) => bundle.taskId === taskId);
  if (!bundles.length) return undefined;
  const latest = bundles.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    decision: latest.decision,
    artifacts: latest.manifest.length,
    claims: latest.claims.length,
    heldClaims: latest.claims.filter((claim) => claim.status === "DISPUTED" || claim.status === "INSUFFICIENT").length
  };
}

function lastFinalResponse(snapshot: DashboardInput["snapshot"], taskId: string): FinalResponse | undefined {
  return snapshot.finalResponses.filter((item) => item.taskId === taskId).sort((a, b) => b.finalizedAt.localeCompare(a.finalizedAt))[0];
}

export function progressLabelFor(task: BossTask): string {
  const parts: string[] = [];
  if (task.nextAction && task.nextAction !== "NEXT_STEP") parts.push(String(task.nextAction));
  if (task.executionPhase) parts.push(String(task.executionPhase));
  if (task.status === "waiting" && task.recoveryAt) parts.push(`recovery at ${new Date(task.recoveryAt).toISOString()}`);
  if (!parts.length) return task.status;
  return parts.join(" · ");
}

/** Pure dashboard computation. Deterministic over the snapshot + inputs. */
export function buildOwnerDashboard(input: DashboardInput): OwnerDashboardSummary {
  const snapshot = input.snapshot;
  const activeIntervention = new Set(input.activeInterventionTaskIds ?? []);
  const ledgerByTask = new Map<string, number>();
  for (const entry of input.ledgerEntries ?? []) {
    if (OWNER_RESULT_DECISION_SOURCES.has(entry.source)) ledgerByTask.set(entry.taskId, (ledgerByTask.get(entry.taskId) ?? 0) + 1);
  }
  const nowIso = (input.now ?? (() => new Date().toISOString()))();

  const cards: OwnerTaskCard[] = snapshot.tasks.map((task) => {
    const intervention = (input.interventions ?? []).filter((item) => item.taskId === task.id && !item.resolvedAt)[0];
    const final = lastFinalResponse(snapshot, task.id);
    const evidence = lastEvidenceDecision(snapshot, task.id);
    let hardBlocker: OwnerBlocker = "NONE";
    let blockerDetail: string | undefined;
    if (intervention) {
      hardBlocker = blockerForIntervention(intervention.kind);
      blockerDetail = intervention.question.slice(0, 300);
    } else if (activeIntervention.has(task.id)) {
      hardBlocker = "OPERATOR_QUESTION";
    }
    return {
      taskId: task.id,
      goal: task.title,
      status: task.status,
      runMode: task.runMode ?? (task.appMode === "work" || task.mode === "council" ? "OWNER_RESULT" : "ASSISTED"),
      progressLabel: progressLabelFor(task),
      ...(final ? { result: { source: final.source, finalizedAt: final.finalizedAt, preview: final.content.slice(0, 200) } } : {}),
      ...(evidence ? { evidence } : {}),
      hardBlocker,
      ...(blockerDetail ? { blockerDetail } : {})
    };
  });

  const counts = {
    total: cards.length,
    active: cards.filter((card) => RUNNING_STATUSES.has(card.status)).length,
    completed: cards.filter((card) => card.status === "completed").length,
    failed: cards.filter((card) => card.status === "failed").length,
    hardBlockers: cards.filter((card) => card.hardBlocker !== "NONE" && card.hardBlocker !== "OPERATOR_QUESTION").length,
    internalAutoDecisions: [...ledgerByTask.values()].reduce((sum, count) => sum + count, 0)
  };
  const order = [...cards].sort((a, b) => {
    const rank = (card: OwnerTaskCard): number => (card.hardBlocker === "NONE" ? 0 : 1) * 10 + (RUNNING_STATUSES.has(card.status) ? 0 : 1);
    return rank(a) - rank(b) || a.taskId.localeCompare(b.taskId);
  });
  return { generatedAt: nowIso, counts, tasks: order };
}
