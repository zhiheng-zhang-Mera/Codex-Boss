import type { BootModule, IpcRegistrar } from "./boot-module";

/**
 * Research run-control IPC (convergence book, Phase F/G).
 *
 * The channels that drive an already-started research run: read its status, list
 * runs, advance one stage, autopilot until a genuine block, resume a parked run,
 * raise a guidance question, and freeze a protocol.
 *
 * Two rules live here because they are the IPC layer's own, and both are about
 * *not* inventing an answer:
 *
 *  - an absent research service answers `null`/`false` rather than throwing, since
 *    the renderer polls these and a session without the subsystem is not an error;
 *  - a guidance question is classified before it is raised: an intercepted
 *    (auto-decidable) question is answered durably by the supervisor and never
 *    parks a human, and only a genuine blocker reaches the intervention gate.
 */

/**
 * The narrow slice of the research subsystem these channels use: the service owns
 * run state (status/step/freeze/ledger), the supervisor owns advancing it.
 */
export interface ResearchPort {
  status(id: string): unknown;
  step(id: string): Promise<unknown>;
  freeze(id: string, protocol: unknown): unknown;
  ledger: { list(): unknown[] };
  supervisor: {
    runUntilBlocked(id: string, options: { maxSteps?: number }): Promise<unknown>;
    /** True when a parked run went back to its pending stage. */
    resume(id: string): boolean;
    /** Classifies a question; `intercepted` means it was decided without a human. */
    requestGuidance(input: { id: string; kind: string; question: string; options?: string[] }): { intercepted: boolean; parked: boolean; decision?: unknown };
  };
}

export interface HumanGuidancePort {
  raise(input: { taskId: string; kind: string; question: string; options?: string[]; blockingStepId: string; contextSummary?: string }): unknown;
}

export interface ResearchEventPort {
  publish(event: { type: "HUMAN_APPROVED"; taskId: string; message: string }): void;
}

export interface ResearchIpcDeps {
  handle: IpcRegistrar["handle"];
  /** Absent when the research subsystem is not installed in this session. */
  research?: ResearchPort | undefined;
  guidance?: HumanGuidancePort | undefined;
  events: ResearchEventPort;
}

export const RESEARCH_IPC_CHANNELS = [
  "boss:research-status",
  "boss:research-list",
  "boss:research-step",
  "boss:research-autopilot",
  "boss:research-resume",
  "boss:research-wait",
  "boss:research-protocol-freeze"
] as const;

export function createResearchIpcModule(deps: ResearchIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:research-status", (_event, id: string) => deps.research?.status(id) ?? null);
  on("boss:research-list", () => deps.research?.ledger.list() ?? []);
  on("boss:research-step", async (_event, id: string) => (deps.research ? await deps.research.step(id) : null));

  // Autopilot advances the run until a genuine block (reviewer gate / user
  // decision / provider wait) or a terminal READY/FAILED state.
  on("boss:research-autopilot", async (_event, id: string, maxSteps?: number) => (deps.research ? await deps.research.supervisor.runUntilBlocked(id, { maxSteps }) : null));

  on("boss:research-resume", (_event, id: string) => {
    const resumed = deps.research?.supervisor.resume(id) ?? false;
    // A run parked at WAITING_FOR_PROVIDER by a reviewer gate, or at
    // WAITING_FOR_USER by research-wait, is now back at its pending stage.
    if (resumed) deps.events.publish({ type: "HUMAN_APPROVED", taskId: id, message: "research run resumed to its pending stage" });
    return resumed;
  });

  on("boss:research-wait", (_event, input: { id: string; kind: string; question: string; options?: string[]; blockingStepId: string; contextSummary?: string }) => {
    const { id, ...rest } = input;
    // Owner-Result interception: the question is classified before it is raised.
    // An AUTOPILOT run's DECIDABLE guidance is auto-decided durably (the
    // supervisor records it and never parks) — no human pause and no fabricated
    // answer. Only a genuine HARD_BLOCKER (or a GUIDED/ASSISTED run) parks and
    // surfaces a durable human intervention.
    const outcome = deps.research?.supervisor.requestGuidance({ id, kind: rest.kind, question: rest.question, options: rest.options }) ?? { intercepted: false, parked: false };
    if (outcome.intercepted) return { intercepted: true, decision: outcome.decision };
    const raised = deps.guidance?.raise({ taskId: id, ...rest, contextSummary: rest.contextSummary ?? rest.question.slice(0, 300) });
    return raised ?? null;
  });

  // Service freeze() freezes the protocol AND records the canonical hash on the
  // run IR (state → PROTOCOL_FROZEN) in one call.
  on("boss:research-protocol-freeze", (_event, id: string, protocol: unknown) => {
    if (!deps.research) throw new Error("Research subsystem is not available in this session");
    return deps.research.freeze(id, protocol);
  });

  return {
    service: { channels: RESEARCH_IPC_CHANNELS },
    health: () => ({
      module: "research-ipc",
      status: registered.length === RESEARCH_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${RESEARCH_IPC_CHANNELS.length} channel(s): ${registered.join(", ")}${deps.research ? "" : "; research subsystem not installed"}`
    }),
    dispose: () => undefined
  };
}
