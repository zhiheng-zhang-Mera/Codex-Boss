import fs from "node:fs";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { restrictedNodeArguments, sanitizedPluginEnvironment, type PluginHealth, type PluginHost, type PluginHostOptions, type PluginInvocationRecord, type PluginManifest } from "./plugin-contract";

/**
 * Plugin host (platform foundation, Phase 03 Task C).
 *
 * Owns the child process a plugin runs in, and is the only thing that talks to it. The three
 * isolation mechanisms are described in `plugin-contract.ts`; this file is where they are applied
 * and where the supervision rules live.
 *
 * ## A plugin failure degrades its own capability and nothing else
 *
 * The book requires that a crash, a timeout or malicious behaviour degrade only the capability in
 * question. Concretely, in this host:
 *
 *  - a crashed plugin is restarted up to `maxRestarts`, and past that it stays `STOPPED`;
 *  - an invocation that does not answer within `timeoutMs` resolves as a denial instead of
 *    hanging the caller;
 *  - `dispose` never throws, so the reverse-order shutdown of the composition root is safe.
 *
 * None of those paths touch anything outside this plugin's own record, which is what makes
 * "Boss's other capabilities stay READY" true rather than aspirational — the host holds no shared
 * mutable state to corrupt.
 */

/** How long a plugin has to answer by default. */
const DEFAULT_PLUGIN_TIMEOUT_MS = 5_000;

/** How many automatic restarts a crashing plugin gets before the host gives up. */
const DEFAULT_PLUGIN_MAX_RESTARTS = 2;

interface PendingCall {
  at: string;
  timer: NodeJS.Timeout;
  resolve: (value: { allowed: boolean; result?: unknown; reason?: string }) => void;
}

export function createPluginHost(options: PluginHostOptions): PluginHost {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PLUGIN_TIMEOUT_MS;
  const maxRestarts = options.maxRestarts ?? DEFAULT_PLUGIN_MAX_RESTARTS;
  const now = options.now ?? (() => new Date().toISOString());

  if (!options.subject.startsWith("plugin.")) {
    // The subject namespace is load-bearing: the broker keys the plugin-safe check on it, so a
    // plugin hosted under a non-plugin subject would be able to hold capabilities it must not.
    throw new Error(`a plugin subject must be in the 'plugin.' namespace, got ${JSON.stringify(options.subject)}`);
  }

  const entryFile = path.resolve(options.directory, options.manifest.entrypoint);
  let child: ChildProcess | undefined;
  let ready = false;
  let disposed = false;
  let restarts = 0;
  let denials = 0;
  let lastDetail = "not started";
  let exports: string[] = [];
  let sandboxEvidence: Record<string, string> = {};
  const pending = new Map<string, PendingCall>();
  const trail: PluginInvocationRecord[] = [];
  let callCounter = 0;

  function record(entry: PluginInvocationRecord): void {
    trail.push(entry);
    if (trail.length > 500) trail.splice(0, trail.length - 500);
  }

  /** Reject every in-flight call, so a crash never leaves a caller waiting forever. */
  function failPending(reason: string): void {
    for (const [callId, call] of pending) {
      clearTimeout(call.timer);
      pending.delete(callId);
      call.resolve({ allowed: false, reason });
    }
  }

  function onMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const typed = message as { kind?: string; callId?: string; allowed?: boolean; result?: unknown; reason?: string; exports?: string[]; status?: string; detail?: string; sandbox?: Record<string, string>; capability?: string; action?: string; resource?: string; input?: unknown };

    if (typed.kind === "ready") {
      ready = true;
      exports = typed.exports ?? [];
      lastDetail = exports.some((name) => name.startsWith("LOAD_FAILED"))
        ? `the plugin failed to load: ${exports.find((name) => name.startsWith("LOAD_FAILED"))?.slice("LOAD_FAILED:".length) ?? "unknown"}`
        : `ready; exports: ${exports.join(", ")}`;
      return;
    }

    /**
     * The plugin asking the HOST for a capability.
     *
     * This is the direction that matters: the plugin has no authority of its own, so its only route
     * to an action is `boss.invoke`, which arrives here and is answered by `options.authorize` —
     * which in production is the broker. Without this branch the plugin's own requests were dropped
     * on the floor and every real invocation came back denied, which is how the first version of
     * this host failed its own sandbox test.
     *
     * The reply is always sent, including the denial, because a silent refusal would leave the
     * plugin waiting and turn an authorization decision into a timeout.
     */
    if (typed.kind === "invoke" && typed.callId) {
      const callId = typed.callId;
      let allowed = false;
      let result: unknown;
      let reason: string | undefined;
      try {
        const decision = options.authorize({
          capability: typed.capability ?? "",
          action: typed.action ?? "",
          resource: typed.resource ?? "",
          ...(typed.input === undefined ? {} : { input: typed.input })
        });
        allowed = decision.allowed === true;
        result = decision.result;
        reason = decision.reason;
      } catch (error) {
        allowed = false;
        reason = `the host could not decide the request: ${error instanceof Error ? error.message : String(error)}`;
      }
      if (!allowed) denials++;
      try {
        child?.send({ kind: "invoke-result", callId, allowed, ...(allowed ? { result } : { reason: reason ?? "denied" }) });
      } catch {
        /* the channel closed while deciding; the exit handler has already failed the callers */
      }
      return;
    }

    if (typed.kind === "invoke-result" && typed.callId) {
      const call = pending.get(typed.callId);
      if (!call) return;
      clearTimeout(call.timer);
      pending.delete(typed.callId);
      if (typed.allowed !== true) denials++;
      call.resolve({ allowed: typed.allowed === true, result: typed.result, ...(typed.reason ? { reason: typed.reason } : {}) });
      return;
    }
    if (typed.kind === "health") {
      if (typed.sandbox) sandboxEvidence = typed.sandbox;
      if (typed.detail) lastDetail = typed.detail;
      return;
    }
    if (typed.kind === "log") return;
  }

  function spawn(): boolean {
    if (disposed) return false;
    if (!fs.existsSync(entryFile)) {
      lastDetail = `the plugin entrypoint does not exist: ${entryFile}`;
      return false;
    }
    // Read the source HERE, in the trusted process: the child runs under Node's permission model
    // and could not read its own entry file.
    const source = fs.readFileSync(entryFile, "utf8");

    child = fork(options.runnerPath, [], {
      // The three isolation mechanisms, applied together.
      execArgv: restrictedNodeArguments(),
      env: {
        ...sanitizedPluginEnvironment(),
        BOSS_PLUGIN_SOURCE: source,
        BOSS_PLUGIN_MANIFEST: JSON.stringify(options.manifest)
      },
      // No stdio inheritance: the plugin must not be able to write to the host's console, and a
      // stray write would corrupt the message channel's framing if it shared one.
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      cwd: options.directory
    });

    child.on("message", onMessage);
    /**
     * Keep the child's stderr as the failure detail.
     *
     * A plugin that dies during load reports nothing on the channel, so without this the health
     * line says only "exited unexpectedly" and the actual reason — a syntax error, a denied require
     * — is lost. stdout is deliberately NOT forwarded to the host's console: a plugin must not be
     * able to write into the application's log.
     */
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim().split("\n").slice(-3).join(" | ");
      if (text) lastDetail = `the plugin wrote to stderr: ${text.slice(0, 300)}`;
    });
    child.on("error", (error) => {
      lastDetail = `the plugin process errored: ${error.message}`;
      ready = false;
    });
    child.on("exit", (code, signal) => {
      ready = false;
      failPending(`the plugin exited (code ${code ?? "null"}${signal ? `, signal ${signal}` : ""})`);
      if (disposed) return;
      // A stderr line is more specific than "exited", so it is not overwritten by the exit notice.
      const exited = `the plugin exited unexpectedly (code ${code ?? "null"}${signal ? `, signal ${signal}` : ""})`;
      lastDetail = lastDetail.startsWith("the plugin wrote to stderr") ? `${lastDetail}; ${exited}` : exited;
      if (restarts < maxRestarts) {
        restarts++;
        lastDetail += `; restart ${restarts}/${maxRestarts}`;
        spawn();
      } else {
        lastDetail += `; giving up after ${maxRestarts} restart(s)`;
      }
    });
    return true;
  }

  const host: PluginHost = {
    manifest: options.manifest,
    subject: options.subject,

    async start() {
      if (disposed) return false;
      const started = spawn();
      if (!started) return false;
      // Wait for the plugin's own `ready`, bounded, so a plugin that never loads does not hang the
      // boot path.
      const deadline = Date.now() + timeoutMs;
      while (!ready && Date.now() < deadline && child && child.exitCode === null) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return ready;
    },

    health(): PluginHealth {
      if (disposed) return { status: "STOPPED", detail: "the plugin was disposed", invocations: trail.filter((entry) => entry.outcome === "ALLOW").length, denials, restarts };
      if (!child || child.exitCode !== null || !ready) {
        return { status: "DEGRADED", detail: lastDetail || "the plugin is not running", invocations: trail.filter((entry) => entry.outcome === "ALLOW").length, denials, restarts };
      }
      return { status: "READY", detail: lastDetail, invocations: trail.filter((entry) => entry.outcome === "ALLOW").length, denials, restarts };
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      const running = child;
      if (running && running.exitCode === null) {
        try { running.send({ kind: "shutdown" }); } catch { /* the channel may already be gone */ }
        // Bounded grace, then force: a plugin that ignores a shutdown must not hold the app open.
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (running.exitCode === null) { try { running.kill(); } catch { /* best effort */ } }
      }
      failPending("the plugin was disposed");
      child = undefined;
      ready = false;
    },

    async requestFromPlugin(request) {
      if (disposed) return { allowed: false, reason: "the plugin was disposed" };
      if (!child || child.exitCode !== null || !ready) return { allowed: false, reason: lastDetail || "the plugin is not running" };
      const callId = `host-${++callCounter}`;
      const at = now();
      const value = await new Promise<{ allowed: boolean; result?: unknown; reason?: string }>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(callId);
          // A timeout is a DENIAL, not a rejection: the caller asked whether the plugin could do
          // something, and "it did not answer in time" is a no.
          resolve({ allowed: false, reason: `the plugin did not answer within ${timeoutMs}ms` });
        }, timeoutMs);
        pending.set(callId, { at, timer, resolve });
        try {
          child?.send({ kind: "host-invoke", callId, capability: request.capability, action: request.action, resource: request.resource, input: request.input });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(callId);
          resolve({ allowed: false, reason: `the plugin channel is closed: ${error instanceof Error ? error.message : String(error)}` });
        }
      });
      record({
        at,
        pluginId: options.manifest.id,
        capability: request.capability,
        action: request.action,
        resource: request.resource,
        outcome: value.allowed ? "ALLOW" : "DENY",
        detail: value.allowed ? "the plugin completed the invocation" : value.reason ?? "denied"
      });
      return value;
    },

    invocations: () => [...trail],

    kill(signal: NodeJS.Signals = "SIGKILL") {
      if (!child || child.exitCode !== null) return false;
      try { return child.kill(signal); } catch { return false; }
    },

    running() {
      return !disposed && Boolean(child) && child?.exitCode === null && ready;
    }
  };

  return host;
}

/** Read a plugin manifest from a directory, validating the shape a host needs. */
export function readPluginManifest(directory: string): PluginManifest {
  const file = path.join(directory, "plugin.json");
  if (!fs.existsSync(file)) throw new Error(`no plugin.json in ${directory}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PluginManifest>;
  if (!parsed.id || !parsed.id.trim()) throw new Error(`the plugin manifest in ${directory} has no id`);
  if (!parsed.version || !parsed.version.trim()) throw new Error(`plugin ${parsed.id} has no version`);
  if (!parsed.entrypoint || !parsed.entrypoint.trim()) throw new Error(`plugin ${parsed.id} has no entrypoint`);
  if (!parsed.describes || !parsed.describes.trim()) throw new Error(`plugin ${parsed.id} does not say what it is for, which makes its grants unreviewable`);
  if (!Array.isArray(parsed.capabilities)) throw new Error(`plugin ${parsed.id} has no capabilities list; an empty list is written as []`);
  // A plugin may not name the entrypoint outside its own directory: a relative escape would let a
  // manifest point the host at a file the plugin author does not own.
  const resolved = path.resolve(directory, parsed.entrypoint);
  if (!resolved.startsWith(path.resolve(directory) + path.sep)) {
    throw new Error(`plugin ${parsed.id} names an entrypoint outside its own directory: ${parsed.entrypoint}`);
  }
  return parsed as PluginManifest;
}
