import type { BootModule, IpcRegistrar } from "./boot-module";
import fs from "node:fs";
import path from "node:path";
import { loginScan } from "../../src/shared/login-scan";
import { probeNetwork } from "../../src/shared/network-policy";
import { inspectDevice } from "../node/node-inspector";
import { parseInterventionFile, unresolvedInterventions } from "../../src/shared/intervention-file";
import type { ProviderAccountMode } from "../../src/shared/provider-contracts";
import type { SessionLifecycle } from "../../src/shared/session-lifecycle";

/**
 * The live `status` read side for human interventions (PF-DEBT-005; ledger CC-075).
 *
 * WHY THIS EXISTS. PF-DEBT-005 is a HIGH-severity historical defect whose recorded status is FIXED: the
 * writer (`electron/commander/human-guidance-gate.ts`) persisted `{ interventions: [...] }` while the
 * reader parsed `{ items: [...] }` inside a `try/catch` that reported every failure as
 * "interventions.json absent". The observation surface therefore reported ZERO unresolved human
 * interventions, ALWAYS -- a defect that looked exactly like good news, because tasks waiting on a
 * human were invisible.
 *
 * The contract that closes it (`src/shared/intervention-file.ts`) IS live: the gate writes through it.
 * What was NOT live is the READ side. Its only implementation sat in
 * `electron/host/host-observer-collector.ts`, which no production code calls, while the debt record's
 * own closure narrative names `status` as the capability that should read the store -- so the defect
 * was marked FIXED while nothing production ran actually read it.
 *
 * It lives HERE, in the live `status` module, so production and the PF-DEBT-005 regression test read
 * through ONE path. It adds no product capability, restores no observer subsystem, does not
 * re-implement the parser (it imports the one shared contract), and never writes.
 */
interface InterventionReadModel {
  /** Unresolved pauses, in store order. Empty when the store is absent -- which is the safe truth. */
  unresolved: Array<{ taskId: string; kind: string; question: string }>;
  /**
   * True when the store exists but could not be understood.
   *
   * This is the distinction the whole defect is about: "there are no interruptions" and "I could not
   * read the interruptions" are opposite facts, and only the first is safe to assume. A caller that
   * renders `unresolved: []` without checking this flag has reintroduced PF-DEBT-005.
   */
  unreadable: boolean;
  /** Why it was unreadable, for a degradation line. Undefined when readable or absent. */
  reason?: string;
}

/** The store's location under a data root: `<dataRoot>/.boss/interventions.json`. */
function interventionStorePath(dataRoot: string): string {
  return path.join(dataRoot, ".boss", "interventions.json");
}

/**
 * Read the intervention store through its one shared contract.
 *
 * READ-ONLY and deliberately not cached: the writer is another capability's live store, so a cached
 * read would report a pause that has already been resolved.
 */
export function readInterventions(dataRoot: string): InterventionReadModel {
  const file = interventionStorePath(dataRoot);
  if (!fs.existsSync(file)) return { unresolved: [], unreadable: false };

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    // An existing-but-unreadable file (permissions, or a directory in its place) is a degradation, not
    // an absence -- the same distinction as a parse failure, and for the same reason.
    return { unresolved: [], unreadable: true, reason: error instanceof Error ? error.message : String(error) };
  }

  const parsed = parseInterventionFile(raw);
  if (parsed.status === "unreadable") {
    return { unresolved: [], unreadable: true, reason: parsed.reason };
  }
  return { unresolved: unresolvedInterventions(parsed), unreadable: false };
}

/**
 * Host, device and learning status IPC.
 *
 * Six channels that answer "what is this device and this installation actually
 * doing right now": the login scan, the device self-inspection, the per-node
 * network probe, and the Owner's provider-intelligence panel with its controls.
 * They used to be closures over the composition root, which meant the probe
 * orchestration — which subsystems are consulted, what a missing registry looks
 * like, what a failed GitHub check degrades to — could only be exercised by
 * booting Electron.
 *
 * Two properties are deliberate and are what the tests pin:
 *
 *   - **A missing subsystem is an answer, not an error.** The node registry and
 *     the GitHub machine identity are optional; when they are absent the channel
 *     reports an uninitialised/`AUTH_MISSING` shape rather than throwing, because
 *     the renderer polls these on a timer.
 *   - **The environment is read at the composition root.** The module asks whether
 *     a proxy is configured; it does not read `process.env` itself, so its answer
 *     is testable without mutating the test process's environment.
 */

/** The learning facade's surface, as these channels use it. */
interface LearningSurface {
  panel(): unknown;
  drilldown(episodeId: string): unknown;
  rebuildDerived(): void;
  resetDerived(): void;
  setAdaptiveRouting(enabled: boolean): void;
  setLearning(enabled: boolean): void;
  controlState(): unknown;
}

/** The device capability registry. Absent when it could not be opened. */
interface NodeRegistrySurface {
  refresh(nodeId: string, probe: unknown): { state: string; reason: string } | undefined;
  status(nodeId: string): { verdicts: unknown[] } | undefined;
}

/** The GitHub machine identity. Absent when no credential provider is configured. */
interface GithubMachineSurface {
  configured: boolean;
  /**
   * Present only on the configured variant: the unconfigured machine has nothing to
   * check, and modelling that honestly is what keeps the degraded shape reachable.
   */
  selfCheck?(): Promise<unknown>;
}

export interface HostStatusService {
  /** Every known account and its mode, for the login scan. */
  accounts(): Array<{ providerId: string; mode?: ProviderAccountMode }>;
  /** The session-lifecycle ledger's records; empty when the ledger is not attached. */
  sessionLifecycles(): Array<{ providerId: string; state: SessionLifecycle }>;
  /**
   * Read on each call rather than captured at boot: the registry is created during
   * startup, after the modules are built.
   */
  nodeRegistry(): NodeRegistrySurface | undefined;
  /** Read on each call, for the same reason. */
  githubMachine(): GithubMachineSurface | undefined;
  learning(): LearningSurface;
  /** Whether the operator's environment configures a proxy. */
  proxyConfigured(): boolean;
}

interface HostStatusIpcDeps {
  handle: IpcRegistrar["handle"];
  host: HostStatusService;
  /**
   * The Boss data root, for the intervention read model (PF-DEBT-005; ledger CC-075).
   *
   * A string rather than anything from Electron, so this module keeps its no-Electron contract, and
   * supplied BY the composition root so production and the regression test read through one path.
   */
  dataRoot: string;
}

export const HOST_STATUS_IPC_CHANNELS = [
  "boss:login-scan",
  "boss:node-status",
  "boss:provider-intelligence",
  "boss:learning-episode",
  "boss:learning-control",
  "boss:network-status",
  "boss:interventions"
] as const;

/** The capability set reported when GitHub cannot be reached or is not configured. */
function githubCapabilities(all: boolean): Record<string, boolean> {
  return { git: all, "github.read": all, "github.write": all, "credential.github": all, filesystem: all, test: all, network: all };
}

export function createHostStatusIpcModule(deps: HostStatusIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:login-scan", () => {
    // R-205 fast-login scan: Boss-side status scan + guidance. MFA/CAPTCHA and
    // account authorization remain genuine operator steps (externalOnly).
    const lifecycles: Record<string, SessionLifecycle> = {};
    for (const record of deps.host.sessionLifecycles()) lifecycles[record.providerId] = record.state;
    return loginScan(deps.host.accounts(), lifecycles);
  });

  on("boss:node-status", async () => {
    // R-302 device self-inspection: probe this device (observed facts only) and
    // refresh the local node capability registry.
    const loggedIn = deps.host.accounts().filter((account) => account.mode === "READY").map((account) => account.providerId);
    const probe = inspectDevice({ loggedInProviderIds: loggedIn });
    const registry = deps.host.nodeRegistry();
    const result = registry?.refresh("desktop", probe);
    const status = registry?.status("desktop");
    const machine = deps.host.githubMachine();
    const github = machine?.configured && machine.selfCheck
      ? await machine.selfCheck().catch(() => ({
          configured: true, credentialProviderAvailable: false, authenticationHealthy: false,
          installationReachable: false,
          capabilities: githubCapabilities(false),
          error: "UNKNOWN_GITHUB_ERROR"
        }))
      : { configured: false, credentialProviderAvailable: false, authenticationHealthy: false, installationReachable: false,
          capabilities: githubCapabilities(false),
          error: "AUTH_MISSING" };
    return { state: result?.state ?? "UNINITIALIZED", reason: result?.reason ?? "not inspected yet", verdicts: status?.verdicts ?? [], sampledAt: probe.sampledAt, loggedIn, github };
  });

  on("boss:provider-intelligence", () => {
    // Owner-facing provider intelligence panel. Learning is a
    // read-only projection here — a failure inside it can never affect tasks.
    return deps.host.learning().panel();
  });

  on("boss:learning-episode", (_event, episodeId: string) => {
    return deps.host.learning().drilldown(String(episodeId ?? ""));
  });

  on("boss:learning-control", (_event, action: string, enabled?: boolean) => {
    // Owner controls: rebuild/reset derived data, disable adaptive
    // routing while keeping learning, or disable learning entirely. An unknown
    // action is a no-op that still reports the state, so a newer renderer cannot
    // break an older host.
    const learning = deps.host.learning();
    switch (action) {
      case "rebuild":
        learning.rebuildDerived();
        break;
      case "reset":
        learning.resetDerived();
        break;
      case "set-adaptive-routing":
        learning.setAdaptiveRouting(enabled === true);
        break;
      case "set-learning":
        learning.setLearning(enabled === true);
        break;
      default:
        break;
    }
    return learning.controlState();
  });

  on("boss:network-status", () => {
    // R-501/R-502: per-node network capability probe + route surface. Direct
    // reachability comes from observed logged-in providers; proxies from the
    // operator's environment configuration (system/user). Pure decision logic
    // lives in shared/network-policy.ts.
    const direct = deps.host.accounts().filter((account) => account.mode === "READY").map((account) => account.providerId);
    return probeNetwork({ nodeId: "desktop", directReachableProviders: direct, userProxyConfigured: deps.host.proxyConfigured() });
  });

  on("boss:interventions", () => {
    // PF-DEBT-005 (ledger CC-075): the live read side for human interventions.
    //
    // The store is written by the `tasks` capability's guidance gate and read here by `status`, which
    // is the read-side capability PF-DEBT-005's own record names. It reads through the shared contract
    // and NEVER writes. `unreadable` is returned as a distinct fact rather than folded into an empty
    // list, because reporting "I could not read the pauses" as "there are no pauses" is the entire
    // defect this read side exists to prevent.
    return readInterventions(deps.dataRoot);
  });

  return {
    service: { channels: HOST_STATUS_IPC_CHANNELS },
    health: () => ({
      module: "host-status-ipc",
      status: registered.length === HOST_STATUS_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${HOST_STATUS_IPC_CHANNELS.length} host/learning channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
