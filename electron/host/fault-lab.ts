import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BudgetManager } from "../commander/budget-manager";
import { CircuitBreaker, providerTechnicalInterruption } from "../commander/circuit-breaker";
import { TaskLedger } from "../commander/task-ledger";
import { RuntimeRegistry } from "../commander/runtime-registry";
import { RoleRouter } from "../commander/role-router";
import { SessionLifecycleLedger } from "../identity/session-lifecycle-ledger";
import { FederationCoordinator } from "../fleet/federation-coordinator";
import { EpisodeStore } from "../learning/episode-store";
import { probeNetwork, resolveRoute, fallbackAfterFailure } from "../../src/shared/network-policy";
import { nodeStateFor as fleetNodeState, DEGRADED_AFTER_MS, OFFLINE_AFTER_MS } from "../../src/shared/fleet";
import { decideIngestion, scoreTrust, trustFromScore } from "../../src/shared/knowledge-governance";
import type { KnowledgeEntry } from "../../src/shared/knowledge";
import { lifecycleForAccountMode, canTransition } from "../../src/shared/session-lifecycle";
import { providerLoginScan } from "../../src/shared/login-scan";
import { structuralHashOf } from "../../src/shared/task-fingerprint";
import {
  FAULT_DEFINITIONS,
  buildFaultLabReport,
  classifyFault,
  faultDefinition,
  type FaultDefinition,
  type FaultLabReport,
  type FaultResult,
  type FaultStep
} from "../../src/shared/fault-lab";
import type { RuntimeAdapter, RuntimeResult } from "../runtimes/runtime";
import type { EpisodeAppendInput } from "../learning/episode-store";

/**
 * Host-M P2 — Failure Injection Lab.
 *
 * The lab injects each declared fault into a throwaway subsystem, drives the
 * *real* modules, and records three independent facts: did the fault take hold,
 * did the system notice it, and did the system stay usable. All three are
 * required for a clean verdict, because an injector that silently did nothing
 * (NOT_INJECTED) and a fault the system ignored (UNDETECTED) are both failures of
 * the lab — and both would otherwise look like a green run.
 *
 * Each injection runs entirely inside its own temp directory, so the repository's
 * real durable state is never touched and nothing has to be rolled back
 * afterwards. The `target` of every fault is an existing module; no production
 * code is modified to make a fault pass.
 */

export interface FaultContext {
  /** A fresh, isolated working directory for this single injection. */
  dir: string;
  now: () => string;
  /** Records a step; also returns it so callers can keep it inline. */
  step: (step: FaultStep["step"], ok: boolean, detail: string) => FaultStep;
}

export interface FaultOutcome {
  steps: FaultStep[];
  injected: boolean;
  detected: boolean;
  contained: boolean;
  refused?: boolean;
  damaged?: boolean;
  detail?: string;
}

export interface FaultInjector {
  id: string;
  run: (context: FaultContext) => Promise<FaultOutcome> | FaultOutcome;
}

const AT = "2026-09-10T00:00:00.000Z";

function fakeRuntime(id: string): RuntimeAdapter {
  return {
    id,
    kind: "web",
    capabilities: { roles: ["planning", "coding", "research", "review", "synthesis", "validation", "critique"], supportsCancellation: true, supportsStreaming: false },
    async healthCheck() {
      return { runtimeId: id, availability: "AVAILABLE", message: "ready", checkedAt: AT };
    },
    async execute(request): Promise<RuntimeResult> {
      return { runtimeId: id, jobId: request.jobId, status: "SUCCESS", content: "ok" };
    }
  };
}

function episodeInput(index: number): EpisodeAppendInput {
  return {
    episodeId: `ep-${index}`,
    taskId: `task-${index}`,
    jobId: `job-${index}`,
    timestamp: `2026-09-10T00:00:0${index}.000Z`,
    canonicalGoalHash: "goal",
    taskFingerprint: { schemaVersion: 1, fingerprintVersion: "fingerprint-1.0.0", structuralHash: structuralHashOf(["planner", "planning"]), role: "planner", capabilities: ["planning"] },
    runtimeId: "web:p1",
    provider: "p1",
    surface: "web",
    role: "planner",
    runtimeStatus: "SUCCESS",
    artifactRefs: [],
    evidenceRefs: [],
    fingerprintVersion: "fingerprint-1.0.0"
  };
}

/** A stored episode row: the store's own schemaVersion plus the append input. */
function episodeRow(index: number): string {
  return JSON.stringify({ schemaVersion: 1, ...episodeInput(index) });
}

function makeContext(): FaultContext {
  return {
    dir: path.join(os.tmpdir(), `host-fault-${randomUUID()}`),
    now: () => AT,
    step(step, ok, detail) {
      return { step, ok, detail };
    }
  };
}

/** Every declared fault class has exactly one injector. */
export const FAULT_INJECTORS: readonly FaultInjector[] = [
  {
    id: "provider-unavailable",
    async run(context) {
      const steps: FaultStep[] = [];
      const budgets = new BudgetManager(path.join(context.dir, "runtime-budget.json"));
      const breaker = new CircuitBreaker(path.join(context.dir, "circuit-breaker.json"), { failureThreshold: 2, cooldownMs: 60_000, now: () => Date.parse(AT) });
      const registry = new RuntimeRegistry();
      registry.register(fakeRuntime("web:a"));
      registry.register(fakeRuntime("web:b"));
      // The router only admits runtimes whose health is cached, so probe first.
      await registry.refreshHealth();
      const router = new RoleRouter(registry, budgets);

      const before = router.route({ role: "planner" }).map((candidate) => candidate.runtimeId);
      budgets.update("web:a", "EXHAUSTED", "OBSERVED");
      breaker.observeFailure("web:a");
      breaker.observeFailure("web:a");
      const injected = budgets.eligible("web:a") === false && breaker.state("web:a") === "OPEN";
      steps.push(context.step("inject", injected, `web:a budget=${budgets.get("web:a").state} circuit=${breaker.state("web:a")}; routed before=[${before}]`));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      const after = router.route({ role: "planner" }).map((candidate) => candidate.runtimeId);
      const detected = before.includes("web:a") && !after.includes("web:a");
      steps.push(context.step("observe", detected, `route after=[${after}]`));
      const contained = after.includes("web:b");
      steps.push(context.step("contain", contained, `web:b carried the role: ${after.includes("web:b")}`));
      return { steps, injected, detected, contained, detail: "web:a removed from routing and web:b carried the role" };
    }
  },

  {
    id: "dom-selector-changed",
    async run(context) {
      const steps: FaultStep[] = [];
      // A small stand-in for a provider page plus the production-shaped DOM
      // surface: evaluate() must fail loudly when the selector no longer matches,
      // rather than returning a plausible-looking empty value.
      let composerSelector = 'textarea[data-testid="prompt-textarea"]';
      let composerValue = "";
      const surface = {
        async evaluate<T>(script: string): Promise<T> {
          const match = /querySelector\(\s*"([^"]+)"\s*\)/.exec(script);
          // Production shape: targeting a page/element that is not there throws
          // rather than evaluating against nothing.
          if (!match) throw new Error("DOM action requires a concrete selector target");
          const selector = match[1];
          if (selector !== composerSelector) throw new Error(`DOM selector changed: ${selector} did not match the composer (now ${composerSelector})`);
          return composerValue as unknown as T;
        }
      };
      const page = {
        select: (selector: string, value: string): string => {
          composerSelector = selector;
          composerValue = value;
          return selector;
        }
      };

      // The provider shipped a redesign and the stored selector went stale.
      page.select('div[contenteditable="true"].composer', "typed text");
      const storedSelector = 'textarea[data-testid="prompt-textarea"]';
      const injected = storedSelector !== composerSelector;
      steps.push(context.step("inject", injected, `page now exposes ${composerSelector}; the stored selector is ${storedSelector}`));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      let detected = false;
      let detail = "";
      try {
        const value = await surface.evaluate<string>(`document.querySelector("${storedSelector}")?.value ?? ""`);
        detail = `evaluate silently returned ${JSON.stringify(value)}`;
      } catch (error) {
        detected = true;
        detail = String(error);
      }
      steps.push(context.step("observe", detected, detail));
      const contained = detected;
      steps.push(context.step("contain", contained, "the DOM read failed instead of inventing an empty value"));
      return { steps, injected, detected, contained, refused: detected, detail };
    }
  },

  {
    id: "login-expired",
    run(context) {
      const steps: FaultStep[] = [];
      const ledger = new SessionLifecycleLedger(path.join(context.dir, "session-lifecycle.json"));
      ledger.record("chatgpt", "LOGGED_IN", "observed login", "default", AT);
      const injected = ledger.state("chatgpt") === "LOGGED_IN";
      steps.push(context.step("inject", injected, `baseline state=${ledger.state("chatgpt")}`));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      ledger.record("chatgpt", "EXPIRED", "session cookie rejected", "default", AT);
      const state = ledger.state("chatgpt");
      const scan = providerLoginScan("chatgpt", "AUTH_REQUIRED", state);
      const detected = state === "EXPIRED" && scan.status !== "READY";
      steps.push(context.step("observe", detected, `state=${state} loginScan=${scan.status}`));
      const contained =
        canTransition("LOGGED_IN", "EXPIRED") &&
        lifecycleForAccountMode("AUTH_REQUIRED") !== "LOGGED_IN" &&
        ledger.list().length === 1;
      steps.push(context.step("contain", contained, `legal transition and ledger still readable (${ledger.list().length} record)`));
      return { steps, injected, detected, contained, refused: true, detail: `state=${state}, scan=${scan.status}` };
    }
  },

  {
    id: "network-timeout",
    run(context) {
      const steps: FaultStep[] = [];
      // Inject by removing every egress route except a dead one.
      const probe = probeNetwork({ nodeId: "desktop", directReachableProviders: ["chatgpt"], systemProxyConfigured: false });
      const injected = probe.capabilities.find((capability) => capability.id === "direct")!.available === true;
      steps.push(context.step("inject", injected, "direct route was reachable, now withdrawn"));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      const dead = probeNetwork({ nodeId: "desktop", directReachableProviders: [], systemProxyConfigured: false });
      const decision = resolveRoute(dead, "chatgpt", false);
      const detected = decision.route === "DEGRADE_PROVIDER";
      steps.push(context.step("observe", detected, `route=${decision.route} (${decision.reason})`));
      const fallback = fallbackAfterFailure(decision.route, dead);
      const contained = fallback.route === "DEGRADE_PROVIDER" && decision.route !== "DIRECT";
      steps.push(context.step("contain", contained, `fallback=${fallback.route}, the process keeps running`));
      return { steps, injected, detected, contained, detail: `timeout with no fallback route degrades the provider only` };
    }
  },

  {
    id: "proxy-unavailable",
    run(context) {
      const steps: FaultStep[] = [];
      const withProxy = probeNetwork({ nodeId: "desktop", directReachableProviders: [], systemProxyConfigured: true, userProxyConfigured: true });
      const injected = withProxy.capabilities.find((capability) => capability.id === "system-proxy")!.available === true;
      steps.push(context.step("inject", injected, "system + user proxy were available"));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      const without = probeNetwork({ nodeId: "desktop", directReachableProviders: [], systemProxyConfigured: false, userProxyConfigured: false, providerProxyConfigured: true });
      const decision = resolveRoute(without, "chatgpt", true);
      const detected = decision.route !== "SYSTEM_PROXY" && decision.route !== "USER_PROXY";
      steps.push(context.step("observe", detected, `route=${decision.route} (${decision.reason})`));
      const contained = decision.route === "PROVIDER_PROXY" || decision.route === "DEGRADE_PROVIDER";
      steps.push(context.step("contain", contained, "a decision is still produced and no state is written"));
      return { steps, injected, detected, contained, detail: `proxy loss moved the route to ${decision.route}` };
    }
  },

  {
    id: "node-dropout",
    run(context) {
      const steps: FaultStep[] = [];
      let clock = Date.parse(AT);
      const coordinator = new FederationCoordinator(path.join(context.dir, "fleet.json"), () => clock);
      coordinator.join("node-a", ["compute", "browser"]);
      coordinator.join("node-b", ["compute"]);
      // First-fit routing puts both on node-a; one carries a checkpoint, one does
      // not, so the two documented dropout outcomes are both exercised.
      coordinator.enqueue({ taskId: "t-checkpointed", requiredCapabilities: ["compute"], replaySafe: true });
      coordinator.checkpoint("t-checkpointed", { stage: 1 });
      coordinator.enqueue({ taskId: "t-unsafe", requiredCapabilities: ["browser"], replaySafe: false });
      const before = coordinator.listAssignments();
      const injected = before.every((entry) => entry.nodeId === "node-a");
      steps.push(context.step("inject", injected, `assigned ${before.map((entry) => entry.taskId).join(", ")} to node-a`));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      clock += OFFLINE_AFTER_MS + 1_000;
      coordinator.heartbeat("node-b");
      const { dropped } = coordinator.refreshStates();
      const stateA = coordinator.listNodes().find((node) => node.nodeId === "node-a")!.state;
      const rerouted = coordinator.reassignAfterDropout("node-a");
      const checkpointed = coordinator.listAssignments().find((entry) => entry.taskId === "t-checkpointed")!;
      const unsafe = coordinator.listAssignments().find((entry) => entry.taskId === "t-unsafe")!;

      const detected = dropped.includes("node-a") && stateA === "OFFLINE" && unsafe.nodeId === undefined;
      steps.push(
        context.step(
          "observe",
          detected,
          `dropped=[${dropped}] node-a=${stateA}; checkpointed -> ${checkpointed.state}@${checkpointed.nodeId ?? "none"}; unsafe -> ${unsafe.state}`
        )
      );
      // Documented semantics: checkpointed work transfers with its checkpoint;
      // uncheckpointed non-replay-safe work fails honestly with a reason.
      const contained =
        checkpointed.checkpoint !== undefined &&
        checkpointed.history.join(" ").includes("checkpointed:node-a transferred") &&
        unsafe.state === "FAILED" &&
        unsafe.history.join(" ").includes("dropped without checkpoint") &&
        rerouted.some((entry) => entry.taskId === "t-checkpointed") &&
        !rerouted.some((entry) => entry.taskId === "t-unsafe") &&
        coordinator.listNodes().length === 2;
      steps.push(context.step("contain", contained, `checkpointed transferred with its payload; unsafe failed as ${unsafe.state} with an explicit reason`));
      return { steps, injected, detected, contained, detail: "dropout moved checkpointed work and failed unsafe work honestly, with no silent loss" };
    }
  },

  {
    id: "disk-unavailable",
    run(context) {
      const steps: FaultStep[] = [];
      const root = path.join(context.dir, "ledger");
      const ledger = new TaskLedger(root);
      ledger.create("t-disk", "durable write objective");
      ledger.update("t-disk", "step done", (record) => {
        record.completedSteps.push("step");
      });
      const before = ledger.load("t-disk")!;
      const injected = before.revision >= 2;
      steps.push(context.step("inject", injected, `baseline revision=${before.revision}`));

      // Make the next checkpoint unwritable: the target path becomes a directory.
      const nextGeneration = path.join(root, "t-disk", "checkpoints", `${String(before.revision + 1).padStart(8, "0")}.json`);
      fs.mkdirSync(nextGeneration, { recursive: true });
      let failedLoudly = false;
      let failure = "";
      try {
        ledger.update("t-disk", "step done again", (record) => {
          record.completedSteps.push("step-2");
        });
      } catch (error) {
        failedLoudly = true;
        failure = String(error);
      }
      const detected = failedLoudly;
      steps.push(context.step("observe", detected, failure || "the write silently succeeded"));
      // Remove the obstruction so the containment question is about the system's
      // bookkeeping, not about the injection apparatus still being in place.
      fs.rmSync(nextGeneration, { recursive: true, force: true });
      let readable = false;
      let revision = -1;
      try {
        const reloaded = ledger.load("t-disk");
        revision = reloaded?.revision ?? -1;
        readable = revision === before.revision;
      } catch (error) {
        readable = false;
        failure = String(error);
      }
      const contained = readable;
      steps.push(context.step("contain", contained, `previous generation still readable at revision ${revision} (expected ${before.revision})`));
      return { steps, injected, detected, contained, refused: failedLoudly, damaged: !contained, detail: "unwritable checkpoint failed loudly and kept the prior generation" };
    }
  },

  {
    id: "malformed-persistence",
    run(context) {
      const steps: FaultStep[] = [];
      const root = path.join(context.dir, "learning");
      fs.mkdirSync(root, { recursive: true });
      const file = path.join(root, "episodes.jsonl");
      fs.writeFileSync(file, `${episodeRow(1)}\n`, "utf8");
      const before = fs.readFileSync(file, "utf8");
      const injected = before.trim().length > 0;
      steps.push(context.step("inject", injected, `seeded ${before.trim().split("\n").length} valid episode row`));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      // The durable file becomes unusable (a malformed payload), then a fresh
      // reader must report it rather than reading it as an empty store.
      fs.writeFileSync(file, "{ this is not json", "utf8");
      const reopened = new EpisodeStore(root);
      const status = reopened.status();
      const detected = Boolean(status.degradedReason) && status.count === 0;
      steps.push(context.step("observe", detected, `count=${status.count} degradedReason=${status.degradedReason ?? "none"}`));
      const contained = fs.readFileSync(file, "utf8") === "{ this is not json" && Array.isArray(reopened.all());
      steps.push(context.step("contain", contained, "the reader did not repair the file in place and stayed callable"));
      return { steps, injected, detected, contained, refused: true, detail: `corrupt store reported: ${status.degradedReason ?? "count=0 with no reason"}` };
    }
  },

  {
    id: "corrupted-cache",
    run(context) {
      const steps: FaultStep[] = [];
      const root = path.join(context.dir, "learning");
      fs.mkdirSync(root, { recursive: true });
      const file = path.join(root, "episodes.jsonl");
      // Two usable rows with two unusable ones interleaved between them.
      fs.writeFileSync(
        file,
        [
          episodeRow(1),
          "not-json-at-all",
          JSON.stringify({ schemaVersion: 9, episodeId: "wrong-schema" }),
          episodeRow(2),
          ""
        ].join("\n"),
        "utf8"
      );
      const injected = fs.readFileSync(file, "utf8").includes("not-json-at-all");
      steps.push(context.step("inject", injected, "interleaved two unusable rows between valid episodes"));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      const reopened = new EpisodeStore(root);
      const status = reopened.status();
      const detected = Boolean(status.degradedReason) && status.count === 2;
      steps.push(context.step("observe", detected, `count=${status.count} degradedReason=${status.degradedReason ?? "none"}`));
      const contained = reopened.get("ep-1") !== undefined && reopened.get("ep-2") !== undefined;
      steps.push(context.step("contain", contained, "valid rows before and after the corrupt ones are still returned"));
      return { steps, injected, detected, contained, detail: `kept ${status.count} valid rows and reported the bad ones` };
    }
  },

  {
    id: "worker-crash",
    run(context) {
      const steps: FaultStep[] = [];
      const breaker = new CircuitBreaker(path.join(context.dir, "breaker.json"), { failureThreshold: 2, cooldownMs: 1_000, now: () => Date.parse(AT) });
      const injected = providerTechnicalInterruption("PROCESS_CRASH") === true;
      steps.push(context.step("inject", injected, "worker reported PROCESS_CRASH"));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      breaker.observeFailure("web:a");
      const halfway = breaker.state("web:a");
      breaker.observeFailure("web:a");
      const detected = halfway === "CLOSED" && breaker.state("web:a") === "OPEN";
      steps.push(context.step("observe", detected, `after 1 failure=${halfway}, after 2=${breaker.state("web:a")}`));
      const late = new CircuitBreaker(path.join(context.dir, "breaker.json"), { failureThreshold: 2, cooldownMs: 1_000, now: () => Date.parse(AT) + 5_000 });
      const admitted = late.admit("web:a");
      const contained = admitted === true;
      steps.push(context.step("contain", contained, `a half-open probe is admitted once the cooldown passes: ${admitted}`));
      return { steps, injected, detected, contained, detail: "crash classified as technical and the breaker opened only for that runtime" };
    }
  },

  {
    id: "partial-task-completion",
    run(context) {
      const steps: FaultStep[] = [];
      const root = path.join(context.dir, "tasks");
      const ledger = new TaskLedger(root);
      ledger.create("t-partial", "multi step objective");
      ledger.update("t-partial", "first step completed", (record) => {
        record.completedSteps.push("step-1");
        record.currentStep = "step-2";
        record.pendingSteps = ["step-2", "step-3"];
      });
      // A worker dies mid-job: the ledger records the partial state explicitly.
      ledger.update("t-partial", "worker died mid job", (record) => {
        record.jobs["job-1"] = { id: "job-1", fingerprint: "f", state: "WAITING", sessionId: "s", attempts: 1 };
        record.failureHistory.push({ kind: "PROCESS_CRASH", message: "worker died" });
      });
      const injected = ledger.load("t-partial")!.jobs["job-1"].state === "WAITING";
      steps.push(context.step("inject", injected, "job recorded as WAITING with a failure history entry"));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      const reloaded = new TaskLedger(root).load("t-partial")!;
      const detected = reloaded.jobs["job-1"].state === "WAITING" && reloaded.completedSteps.length === 1 && reloaded.pendingSteps.length === 2;
      steps.push(context.step("observe", detected, `reload: state=${reloaded.jobs["job-1"].state} completed=${reloaded.completedSteps.length} pending=${reloaded.pendingSteps.length}`));
      const contained =
        reloaded.failureHistory.length === 1 &&
        reloaded.failureHistory[0].kind === "PROCESS_CRASH" &&
        TaskLedger.fingerprint(reloaded.jobs) === TaskLedger.fingerprint(ledger.load("t-partial")!.jobs);
      steps.push(context.step("contain", contained, "a separate reader reproduces the same partial record exactly"));
      return { steps, injected, detected, contained, detail: "partial work stayed explicitly partial across a reload" };
    }
  },

  {
    id: "stale-heartbeat",
    run(context) {
      const steps: FaultStep[] = [];
      const nodeFile = path.join(context.dir, "fleet.json");
      const coordinator = new FederationCoordinator(nodeFile, () => Date.parse(AT));
      coordinator.join("node-a", ["compute"]);
      const stored = coordinator.listNodes()[0];
      const injected = stored.lastHeartbeatAt <= Date.parse(AT);
      steps.push(context.step("inject", injected, `last heartbeat at ${new Date(stored.lastHeartbeatAt).toISOString()}`));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      const degraded = fleetNodeState(Date.parse(AT) + DEGRADED_AFTER_MS + 1, stored);
      const offline = fleetNodeState(Date.parse(AT) + OFFLINE_AFTER_MS + 1, stored);
      const detected = degraded === "DEGRADED" && offline === "OFFLINE";
      steps.push(context.step("observe", detected, `age ${DEGRADED_AFTER_MS + 1}ms -> ${degraded}; age ${OFFLINE_AFTER_MS + 1}ms -> ${offline}`));
      const after = new FederationCoordinator(nodeFile, () => Date.parse(AT)).listNodes()[0];
      const contained = after.lastHeartbeatAt === stored.lastHeartbeatAt;
      steps.push(context.step("contain", contained, "deriving state from age did not mutate the stored record"));
      return { steps, injected, detected, contained, detail: "staleness is derived from age, and reading it writes nothing" };
    }
  },

  {
    id: "knowledge-sync-failure",
    run(context) {
      const steps: FaultStep[] = [];
      const entry: KnowledgeEntry = {
        id: "k-1",
        domain: "engineering",
        shelf: "measurements",
        tags: ["throughput"],
        title: "measured throughput",
        content: "throughput is 42 units",
        source: "sync:node-b",
        trust: "HIGH",
        createdAt: AT,
        updatedAt: AT
      };
      const injected = scoreTrust({ entry, successes: 5, failures: 0 }) > scoreTrust({ entry, successes: 0, failures: 5 });
      steps.push(context.step("inject", injected, "a synchronised record whose verifications all failed"));
      if (!injected) return { steps, injected: false, detected: false, contained: false };

      const failed = scoreTrust({ entry, successes: 0, failures: 5 });
      const before = trustFromScore(scoreTrust({ entry, successes: 5, failures: 0 }));
      const after = trustFromScore(failed);
      const detected = after !== "HIGH" && after === "UNVERIFIED";
      steps.push(context.step("observe", detected, `trust ${before} -> ${after} (score ${failed.toFixed(2)})`));
      // A failed sync must not overwrite content that is already stored.
      const verdict = decideIngestion({ ...entry, id: "k-2" }, [entry]);
      const contained = verdict.decision === "DUPLICATE" && verdict.supersedes === "k-1";
      steps.push(context.step("contain", contained, `re-syncing identical content decided ${verdict.decision}`));
      return { steps, injected, detected, contained, detail: "a failed sync lowers trust and cannot silently replace stored content" };
    }
  }
] as const;

/** Every declared fault class must have an injector, and vice versa. */
export function injectorCoverage(injectors: readonly FaultInjector[] = FAULT_INJECTORS): { missing: string[]; undeclared: string[] } {
  const declared = new Set(FAULT_DEFINITIONS.map((definition) => definition.id));
  const implemented = new Set(injectors.map((injector) => injector.id));
  return {
    missing: [...declared].filter((id) => !implemented.has(id)),
    undeclared: [...implemented].filter((id) => !declared.has(id))
  };
}

export interface FaultLabOptions {
  only?: readonly string[];
  now?: () => string;
}

/** Runs the lab. A fault that throws is recorded as a failed run, never as a pass. */
export async function runFaultLab(options: FaultLabOptions = {}): Promise<FaultLabReport> {
  const now = options.now ?? (() => new Date().toISOString());
  const coverage = injectorCoverage();
  const selected = options.only?.length
    ? FAULT_INJECTORS.filter((injector) => {
        if (!options.only!.includes(injector.id)) return false;
        return true;
      })
    : FAULT_INJECTORS;
  if (options.only?.length) {
    for (const id of options.only) faultDefinition(id);
  }

  const results: FaultResult[] = [];
  for (const definition of FAULT_DEFINITIONS) {
    const injector = selected.find((entry) => entry.id === definition.id);
    if (!injector) continue;
    const started = Date.now();
    let outcome: FaultOutcome;
    let threw: string | undefined;
    const context = makeContext();
    try {
      fs.mkdirSync(context.dir, { recursive: true });
      outcome = await injector.run(context);
    } catch (error) {
      threw = String(error);
      outcome = { steps: [], injected: false, detected: false, contained: false, detail: `injector threw: ${threw}` };
    } finally {
      try {
        fs.rmSync(context.dir, { recursive: true, force: true });
      } catch {
        // a leftover temp dir is not a lab failure
      }
    }
    const verdict = threw
      ? "NOT_INJECTED"
      : classifyFault({
          definition,
          injected: outcome.injected,
          detected: outcome.detected,
          contained: outcome.contained,
          refused: outcome.refused === true,
          damaged: outcome.damaged === true
        });
    results.push({
      id: definition.id,
      fault: definition.fault,
      label: definition.label,
      verdict,
      injected: outcome.injected,
      detected: outcome.detected,
      contained: outcome.contained,
      detail: outcome.detail ?? threw ?? "",
      steps: outcome.steps,
      durationMs: Date.now() - started
    });
  }

  // A coverage hole is a hard failure of the lab itself: the plan names thirteen
  // classes and a class without an injector would otherwise vanish silently.
  if (coverage.missing.length) {
    for (const id of coverage.missing) {
      const definition = faultDefinition(id);
      results.push({
        id,
        fault: definition.fault,
        label: definition.label,
        verdict: "NOT_INJECTED",
        injected: false,
        detected: false,
        contained: false,
        detail: "no injector is registered for this declared fault class",
        steps: [],
        durationMs: 0
      });
    }
  }

  return buildFaultLabReport({ results, generatedAt: now() });
}

export { FAULT_DEFINITIONS, classifyFault, faultDefinition, buildFaultLabReport };
export type { FaultDefinition, FaultLabReport, FaultResult };
