import path from "node:path";
import type { BootModule } from "./boot-module";
import type { StateStore } from "../store";
import type { ExperienceStore } from "../experience/experience-store";
import { DomainEventBus } from "../commander/event-bus";
import { RecoveryScheduler } from "../commander/recovery-scheduler";
import { CircuitBreaker } from "../commander/circuit-breaker";
import { SoftwareLeaseRegistry } from "../computer/software-lease";
import { TelemetryStore } from "../telemetry/telemetry-store";
import { attachTelemetryRecorder } from "../telemetry/telemetry-recorder";
import { attachExperienceRecorder } from "../experience/experience-recorder";
import { attachProgressRecorder } from "../commander/progress-recorder";
import { attachRuntimeIntelligenceCapture, type RuntimeIntelligenceCapture, type LiveCaptureAttachment } from "../runtime-intelligence/live-capture";

/**
 * The event bus, its recorders and the runtime-resilience services
 * (convergence book, Phase F).
 *
 * Everything here reacts to something that already happened: a domain event, a
 * retry time arriving, a runtime failing repeatedly, a capability being held by
 * another session. They were constructed inline in the boot block, which hid two
 * facts an operator wants at startup and a test wants to assert:
 *
 *  - **the bus can lose an effect.** A subscriber that throws is recorded on the
 *    bus (`handlerFailures()`) rather than vanishing into an empty catch, so
 *    "nothing happened" and "the reaction was lost" are different answers — and
 *    that difference is reported here rather than only being readable by whoever
 *    remembers to ask;
 *  - **the recovery scheduler owns a timer.** It is the one module in this set
 *    with something to release, so `dispose()` here really stops it instead of
 *    only marking state.
 *
 * The recorders are named, not counted anonymously: each one is a durable trail
 * (progress, telemetry, experience) and a missing attachment has to be visible in
 * the boot log rather than inferred from silence.
 */

export interface AutomationOptions {
  /** The resolved data root — `app.getPath("userData")` in production. */
  dataRoot: string;
  /** The state document the recovery callback reconciles and the recorders attribute against. */
  store: StateStore;
  /** The durable experience store the experience recorder writes into. */
  experiences: ExperienceStore;
  /**
   * The runtime-intelligence capture the persistence module installed on the ledger.
   *
   * Optional so a caller that has no capture (a test, a host tool) is not forced to build one;
   * when it is absent the plane records nothing and nothing else changes.
   */
  capture?: RuntimeIntelligenceCapture;
  /** The composition root's snapshot fan-out, called when a recovery changes durable state. */
  publish(): void;
}

interface AutomationService {
  /** The one domain event bus every service publishes onto. */
  events: DomainEventBus;
  /** The aggregate the renderer's progress surface reads. */
  progress: ReturnType<typeof attachProgressRecorder>["aggregator"];
  /** Retry times arriving for a parked task. */
  recovery: RecoveryScheduler;
  /** Per-runtime admission after repeated failures. */
  circuitBreaker: CircuitBreaker;
  /** In-memory capability leases; deliberately not durable, so they die with the process. */
  softwareLeases: SoftwareLeaseRegistry;
  /** The durable trails attached to the bus, by name. */
  recorders: readonly string[];
  /** The runtime-intelligence shadow capture, when one was handed in. */
  capture?: LiveCaptureAttachment;
}

export function createAutomationModule(options: AutomationOptions): BootModule<AutomationService> {
  const { dataRoot, store, experiences, publish } = options;
  const boss = (...parts: string[]) => path.join(dataRoot, ".boss", ...parts);

  const events = new DomainEventBus();
  const recorders: string[] = [];
  const progress = attachProgressRecorder(events).aggregator;
  recorders.push("progress");
  attachTelemetryRecorder(events, new TelemetryStore(boss("telemetry.json")));
  recorders.push("telemetry");
  attachExperienceRecorder(events, experiences, { sourceFor: (taskId) => store.snapshot().tasks.find((task) => task.id === taskId)?.workspaceId ?? taskId });
  recorders.push("experience");
  // The runtime-intelligence shadow capture is the fourth observer on this bus. It subscribes to
  // run outcomes only, records them for the prospective window and never publishes, blocks or
  // decides anything: a handler that failed would be recorded by the bus itself.
  const capture = options.capture === undefined ? undefined : attachRuntimeIntelligenceCapture(events, { capture: options.capture });
  if (capture !== undefined) recorders.push("runtime-intelligence-capture");

  const softwareLeases = new SoftwareLeaseRegistry();
  const recovery = new RecoveryScheduler(boss("recovery.json"), () => {
    for (const item of recovery.list().filter((record) => record.state === "PAUSED")) {
      const task = store.snapshot().tasks.find((task) => task.id === item.taskId);
      if (task && (task.recoveryAt || task.recoveryMessage !== item.error)) store.setRecoveryState(item.taskId, undefined, item.error ?? "Recovery paused");
    }
    publish();
  }, events);
  const circuitBreaker = new CircuitBreaker(boss("circuit-breaker.json"));

  let disposed = false;
  return {
    service: { events, progress, recovery, circuitBreaker, softwareLeases, recorders, ...(capture === undefined ? {} : { capture }) },
    health: () => {
      const failures = events.handlerFailures();
      const notClosed = circuitBreaker.list().filter((entry) => entry.state !== "CLOSED").length;
      return {
        module: "automation",
        // A handler failure means an event was published and its effect was LOST.
        // That is the one state in this set that is never normal, so it is the
        // status rather than a number in the detail.
        status: failures.length === 0 ? "READY" : "DEGRADED",
        detail: `${recorders.length} recorder(s) on the bus (${recorders.join(", ")}); ${recovery.list().length} recovery record(s); ${notClosed} circuit(s) not closed; ${failures.length} lost event effect(s)${disposed ? "; disposed" : ""}`
      };
    },
    // The scheduler owns a timer; stopping it is the point. Idempotent, and the
    // services without a handle are left alone (their state is file-backed).
    dispose: () => {
      recovery.dispose();
      // The capture only unsubscribes. It owns no timer and holds no lock, and nothing downstream
      // reads its status in order to decide anything.
      capture?.detach();
      disposed = true;
    }
  };
}
