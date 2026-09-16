import { fork, type ChildProcess } from "node:child_process";

/**
 * Plugin isolation contract (platform foundation, Phase 03 Task C).
 *
 * The smallest plugin shape the book asks for — manifest, entrypoint, requested capabilities,
 * `health()`, `dispose()` — plus the boundary that makes it safe to run one at all.
 *
 * ## How the isolation is actually enforced
 *
 * Three independent mechanisms, because no single one is sufficient and the book is specific
 * about what a plugin must not reach:
 *
 *  1. **A separate process.** The plugin runs under `child_process.fork`, never in the trusted
 *     main process, so it cannot import a main-process module, reach a closure, or corrupt the
 *     host's memory. `utilityProcess` would also satisfy this; `fork` is used because it is
 *     available identically under Node and Electron, which is what lets the escape tests run in
 *     the ordinary test tier.
 *  2. **Node's permission model.** The child is spawned with `--permission`, which MEASURABLY
 *     denies filesystem reads and writes, `child_process` and worker threads with
 *     `ERR_ACCESS_DENIED` at the engine level rather than by convention. Measured on this
 *     runtime: `fs.readFileSync` → denied, `fs.writeFileSync` → denied, `child_process` →
 *     denied, `worker_threads` → denied. So "a plugin may not read the project's files" is
 *     enforced by Node, not by the plugin's good behaviour.
 *  3. **A sanitized environment.** `--permission` does NOT restrict `process.env` (measured: a
 *     probe variable was still readable), so the child is given an explicitly built environment
 *     instead of inheriting the host's. That is why "a plugin may not read a secret out of the
 *     environment" is a real boundary here and not a claim.
 *
 * ## What Node's permission model does NOT do
 *
 * It does not restrict the network: a probe `net.connect` succeeded under `--permission`. So
 * network reach is NOT claimed as physically denied. It is enforced by the capability layer
 * instead — a plugin is never handed a network-capable adapter, because every such provider
 * declares `pluginSafe: false` and the broker refuses it before any grant is consulted. The
 * escape tests assert exactly that, and the report says which mechanism covers which axis rather
 * than implying the sandbox does more than it does.
 *
 * ## Capability handles, not ambient authority
 *
 * The child has no capability of its own. It can only send `invoke` messages, and every one is
 * answered by the broker on the host side after a decision. A plugin therefore cannot perform an
 * action the broker did not allow, because it has no other way to perform an action at all.
 */

/** What a plugin declares about itself. Loaded by the host, never by the plugin at runtime. */
export interface PluginManifest {
  id: string;
  version: string;
  /** Path to the plugin entry module, relative to the plugin directory. */
  entrypoint: string;
  /** What the plugin says it wants. The broker decides, not the plugin. */
  capabilities: PluginCapabilityRequest[];
  /** One line describing what the plugin is for; required so a grant is reviewable. */
  describes: string;
}

export interface PluginCapabilityRequest {
  capability: string;
  actions: string[];
  resources: string[];
}

export interface PluginHealth {
  status: "READY" | "DEGRADED" | "STOPPED";
  detail: string;
  /** How many capability invocations the plugin has completed. */
  invocations: number;
  /** Capability requests the host refused. Non-zero means the plugin tried something it lacks. */
  denials: number;
  restarts: number;
}

/** A request the plugin makes over the boundary. */
export interface PluginInvokeMessage {
  kind: "invoke";
  /** Correlation id, echoed on the reply. */
  callId: string;
  capability: string;
  action: string;
  resource: string;
  input?: unknown;
}

export interface PluginReadyMessage {
  kind: "ready";
  /** What the plugin's entry module exported, reduced to what the host reports. */
  exports: string[];
}

export interface PluginLogMessage {
  kind: "log";
  level: "info" | "warn" | "error";
  message: string;
}

export type PluginToHostMessage = PluginInvokeMessage | PluginReadyMessage | PluginLogMessage;

/** What the host answers with. */
export type HostToPluginMessage =
  | { kind: "invoke-result"; callId: string; allowed: true; result: unknown }
  | { kind: "invoke-result"; callId: string; allowed: false; reason: string }
  | { kind: "shutdown" };

/** One capability invocation, as the host observed it. */
export interface PluginInvocationRecord {
  at: string;
  pluginId: string;
  capability: string;
  action: string;
  resource: string;
  outcome: "ALLOW" | "DENY";
  detail: string;
}

/** How the host is told to run a plugin. */
export interface PluginHostOptions {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory. */
  directory: string;
  /** The runner module that hosts plugins. Owned by this package, not by the plugin. */
  runnerPath: string;
  /** The subject the plugin runs as. Must be in the `plugin.` namespace. */
  subject: string;
  /**
   * Decides one invocation. Returning `undefined` for `result` is allowed; throwing is not
   * expected and becomes a denial.
   */
  authorize(request: { capability: string; action: string; resource: string; input?: unknown }): { allowed: boolean; result?: unknown; reason?: string };
  /** How long a plugin has to answer an invocation or a health probe. */
  timeoutMs?: number;
  /** How many times the host may restart a crashed plugin before giving up. */
  maxRestarts?: number;
  /** Injected clock, so a test can assert timings without waiting. */
  now?(): string;
}

export interface PluginHost {
  manifest: PluginManifest;
  subject: string;
  /** Start the plugin. Idempotent. Returns false when it could not start. */
  start(): Promise<boolean>;
  /** Ask the running plugin for its state, bounded by the timeout. */
  health(): PluginHealth;
  /** Stop the plugin. Idempotent, and never throws. */
  dispose(): Promise<void>;
  /** Invoke a capability FROM the plugin side, as the plugin itself would. Used by tests. */
  requestFromPlugin(request: { capability: string; action: string; resource: string; input?: unknown }): Promise<{ allowed: boolean; result?: unknown; reason?: string }>;
  /** Every invocation the host observed, allowed or not. */
  invocations(): PluginInvocationRecord[];
  /** Kill the plugin process abruptly, to prove a crash only degrades this capability. */
  kill(signal?: NodeJS.Signals): boolean;
  /** True while a child process is alive. */
  running(): boolean;
}

/**
 * The environment a plugin child is given.
 *
 * Deliberately tiny and explicit. `--permission` does not restrict `process.env`, so this is the
 * only thing standing between a plugin and every secret the host happens to have exported, and it
 * is therefore built by construction rather than filtered by deletion — a deny-list would leak
 * whatever nobody remembered to list.
 */
export function sanitizedPluginEnvironment(): NodeJS.ProcessEnv {
  return {
    // Enough for Node itself to run, and nothing else.
    PATH: "",
    NODE_ENV: process.env.NODE_ENV ?? "production",
    // Windows needs these for the process to start at all; neither carries a secret.
    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "", TEMP: process.env.TEMP ?? "", TMP: process.env.TMP ?? "" } : {}),
    // An explicit marker, so a plugin that inspects its environment can tell it is sandboxed
    // rather than inferring it from an absence.
    BOSS_PLUGIN_SANDBOX: "1"
  };
}

/** The arguments that put a child under Node's permission model with everything denied. */
export function restrictedNodeArguments(): string[] {
  // `--permission` with no `--allow-*` flags denies filesystem, child processes, workers and
  // addons. Each axis is asserted by the escape suite rather than assumed.
  return ["--permission"];
}
