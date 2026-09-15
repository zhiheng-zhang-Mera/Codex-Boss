import type { BootModule, IpcRegistrar } from "./boot-module";
import { ResearchContractStore, auditRun } from "../research/research-contract-store";
import { ReviewRoundStore } from "../research/review-round-store";
import { buildOwnerDashboard } from "../../src/shared/owner-dashboard";
import type { ResearchContract } from "../../src/shared/research-contract";
import type { ReviewRound } from "../../src/shared/research-review";
import type { InterventionKind } from "../../src/shared/intervention";

/**
 * Research records and the Owner read-model (convergence book, Phase F/G).
 *
 * Six channels: the durable Research Contract and its sufficiency audit, the review
 * rounds, the Owner dashboard, answering a human-guidance request, and the project
 * state summary.
 *
 * They are grouped because they all read or write a *durable record about work*
 * rather than driving the work: each one opens a store, or projects the current
 * snapshot into a view an operator reads. Three properties are deliberate:
 *
 *   - **The data root is injected, not discovered.** These stores are opened per call
 *     under the application's data directory; the module asks for a path rather than
 *     reaching for `app.getPath`, because a boot module must never import Electron.
 *   - **An absent subsystem is an empty answer.** The guidance gate, the decision
 *     ledger and the research service are all optional; when they are not composed
 *     the dashboard and the intervention channels answer with nothing rather than
 *     throwing, because the renderer polls them.
 *   - **Answering an intervention may resume research.** That is the one place these
 *     channels cause work to continue, and it is announced when it happens.
 */

/** One human-guidance request, reduced to what the dashboard reads. */
interface InterventionRecord {
  taskId: string;
  kind: InterventionKind;
  question: string;
  resolvedAt?: string;
}

interface ResearchOwnerSurface {
  /** An absolute path under the application's data root. */
  dataFile(...segments: string[]): string;
  /** The research ledger's decisions for a run, shaped for the sufficiency gate. */
  researchDecisions(runId: string): Parameters<typeof auditRun>[1];
  /** Resumes a paused research run; false when the task is not a research run. */
  resumeResearch(taskId: string): boolean | undefined;
  /** Every human-guidance request; empty when the gate is not composed. */
  interventions(): InterventionRecord[];
  /**
   * Answers a request and returns the answered request, or undefined when the gate is
   * not composed. Deliberately not typed as a boolean: the channel's answer is the
   * request itself, and this module only asks whether one came back.
   */
  resolveIntervention(taskId: string, kind: InterventionKind, answer: string): unknown;
  snapshot(): Parameters<typeof buildOwnerDashboard>[0]["snapshot"];
  /** The decision ledger's entries; empty when it is not composed. */
  decisionLedgerEntries(): Parameters<typeof buildOwnerDashboard>[0]["ledgerEntries"];
  /** The workspace the renderer is looking at, when no id is given. */
  activeWorkspaceId(): string;
  projectState(target: string): { summary(target: string): unknown };
  now(): string;
}

interface ResearchOwnerEvent {
  type: "HUMAN_APPROVED";
  taskId: string;
  message: string;
}

interface ResearchOwnerIpcDeps {
  handle: IpcRegistrar["handle"];
  owner: ResearchOwnerSurface;
  events: { publish(event: ResearchOwnerEvent): void };
}

export const RESEARCH_OWNER_IPC_CHANNELS = [
  "boss:research-contract-record",
  "boss:research-contract-audit",
  "boss:research-review-round",
  "boss:owner-dashboard",
  "boss:resolve-intervention",
  "boss:project-state"
] as const;

export function createResearchOwnerIpcModule(deps: ResearchOwnerIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:research-contract-record", (_event, id: string, contract: ResearchContract) => {
    // R-701: persist the Research Contract for a run (durable; paper expansion and
    // the sufficiency gate read it from here).
    const store = new ResearchContractStore(deps.owner.dataFile(".boss", "research-contracts"));
    store.save(id, contract);
    return store.load(id);
  });

  on("boss:research-contract-audit", (_event, id: string) => {
    // R-702: sufficiency gate over the durable ledger decisions vs the contract.
    const store = new ResearchContractStore(deps.owner.dataFile(".boss", "research-contracts"));
    return auditRun(store.load(id), deps.owner.researchDecisions(id));
  });

  on("boss:research-review-round", (_event, id: string, round: ReviewRound) => {
    // R-703: persist a review round for the run (responses/revisions drive re-review).
    const store = new ReviewRoundStore(deps.owner.dataFile(".boss", "research-reviews"));
    store.save(id, round);
    return store.load(id).map((item) => item.roundId);
  });

  on("boss:owner-dashboard", () => {
    const interventions = deps.owner.interventions();
    return buildOwnerDashboard({
      snapshot: deps.owner.snapshot(),
      interventions: interventions.map(({ taskId, kind, question, resolvedAt }) => ({ taskId, kind, question, resolvedAt })),
      ledgerEntries: deps.owner.decisionLedgerEntries(),
      activeInterventionTaskIds: interventions.filter((item) => !item.resolvedAt).map((item) => item.taskId),
      now: () => deps.owner.now()
    });
  });

  on("boss:resolve-intervention", (_event, taskId: string, kind: InterventionKind, answer: string) => {
    const resolved = deps.owner.resolveIntervention(taskId, kind, answer);
    // If the paused task is a research run, resume it from its control state.
    if (resolved && deps.owner.resumeResearch(taskId)) {
      deps.events.publish({ type: "HUMAN_APPROVED", taskId, message: "intervention answered; research resumed" });
    }
    return resolved;
  });

  on("boss:project-state", (_event, workspaceId?: string) => {
    const target = workspaceId ?? deps.owner.activeWorkspaceId();
    return deps.owner.projectState(target).summary(target);
  });

  return {
    service: { channels: RESEARCH_OWNER_IPC_CHANNELS },
    health: () => ({
      module: "research-owner-ipc",
      status: registered.length === RESEARCH_OWNER_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${RESEARCH_OWNER_IPC_CHANNELS.length} research/owner channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
