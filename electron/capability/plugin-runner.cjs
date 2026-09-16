/**
 * Plugin runner (platform foundation, Phase 03 Task C).
 *
 * The process a plugin actually executes in. `plugin-host.ts` spawns it with Node's permission
 * model on and no `--allow-*` flag, so this file — and everything the plugin does — runs without
 * filesystem, child-process, worker or addon access. The escape suite measures each of those
 * denials from inside this process.
 *
 * ## Why the plugin SOURCE arrives in the environment
 *
 * That restriction has a consequence worth stating plainly: the runner cannot read the plugin's
 * file. It cannot `readFileSync`, and it cannot `require` an absolute path. So the host reads the
 * plugin once in the trusted process and passes the source text through the child's environment
 * (which `--permission` does not restrict — measured, and the reason the host builds a sanitized
 * environment rather than inheriting one).
 *
 * The runner compiles that text with `vm.compileFunction` and calls the factory it exports. The
 * plugin never receives a path, a loader, a `require`, or a filesystem handle — it receives one
 * object, `boss`, whose members are the capability calls the host is willing to answer.
 *
 * ## The plugin's whole world
 *
 *     boss.pluginId            a string
 *     boss.manifest            what the host decided the plugin is
 *     boss.invoke(...)         resolves only if the BROKER allows the call
 *     boss.log(...)            a line in the host's log
 *     boss.selfTest()          what this sandbox can and cannot do, measured from inside
 *
 * There is no `require`, no `process` argument, no `fs`, and no `import()`. A plugin that wants to
 * read a file has exactly one route — `boss.invoke` — and the broker refuses it, for a plugin,
 * always: no adapter provider that reaches the filesystem declares itself `pluginSafe`.
 *
 * This file is CommonJS on purpose. Under `--permission` the runner must not need to resolve a
 * plugin path, and keeping the runner itself untyped means it can be spawned by a Node or an
 * Electron runtime with no build step in between.
 */

const vm = require("node:vm");

const pluginSource = process.env.BOSS_PLUGIN_SOURCE ?? "";
const manifestJson = process.env.BOSS_PLUGIN_MANIFEST ?? "{}";

/** Waiting callers, keyed by correlation id. */
const pending = new Map();
let callCounter = 0;
let disposed = false;
let plugin;
let pluginError;
let invocationCount = 0;
const logs = [];

function send(message) {
  if (typeof process.send === "function") process.send(message);
}

/**
 * What this sandbox denies, measured FROM INSIDE the child.
 *
 * The evidence for "a plugin cannot read the project's files" should come from the process that
 * would be doing the reading, not from the host's description of it.
 */
function selfTest() {
  const probe = (name, run) => {
    try {
      run();
      return `${name}:ALLOWED`;
    } catch (error) {
      const code = (error && error.code) || "ERROR";
      return `${name}:DENIED(${code})`;
    }
  };
  return {
    "fs.readFileSync": probe("fs.readFileSync", () => require("node:fs").readFileSync(__filename)),
    "fs.writeFileSync": probe("fs.writeFileSync", () => require("node:fs").writeFileSync("boss-plugin-probe.txt", "x")),
    "child_process.execSync": probe("child_process.execSync", () => require("node:child_process").execSync("echo probe")),
    "worker_threads.Worker": probe("worker_threads.Worker", () => new (require("node:worker_threads").Worker)("", { eval: true })),
    credentialEnv: process.env.BOSS_HOST_SECRET ? "ENV:READABLE" : "ENV:ABSENT",
    pathEnv: process.env.PATH === "" ? "ENV:SANITIZED" : process.env.PATH ? "ENV:PRESENT" : "ENV:ABSENT",
    sandboxMarker: process.env.BOSS_PLUGIN_SANDBOX === "1" ? "MARKED" : "UNMARKED"
  };
}

const boss = {
  pluginId: (JSON.parse(manifestJson).id) || "unknown",
  manifest: JSON.parse(manifestJson),
  invoke(request) {
    const callId = `call-${++callCounter}`;
    return new Promise((resolve) => {
      pending.set(callId, resolve);
      send({
        kind: "invoke",
        callId,
        capability: request.capability,
        action: request.action,
        resource: request.resource,
        input: request.input
      });
    });
  },
  log(level, message) {
    logs.push(`${level}:${message}`);
    if (logs.length > 50) logs.splice(0, logs.length - 50);
    send({ kind: "log", level, message });
  },
  selfTest
};

function onInvokeResult(message) {
  const resolve = pending.get(message.callId);
  if (!resolve) return;
  pending.delete(message.callId);
  resolve({ allowed: message.allowed === true, result: message.result, reason: message.reason });
}

async function shutdown() {
  if (disposed) return;
  disposed = true;
  try {
    if (plugin && typeof plugin.dispose === "function") await plugin.dispose();
  } catch {
    // A dispose that throws must not keep the child alive; the host has already stopped waiting.
  }
  process.exit(0);
}

/** Compile and start the plugin. Errors are reported, never thrown into the void. */
async function loadPlugin() {
  try {
    const factory = vm.compileFunction(pluginSource, ["module", "exports", "boss"], { filename: "plugin.js" });
    const moduleShim = { exports: {} };
    factory(moduleShim, moduleShim.exports, boss);
    const exported = moduleShim.exports;
    plugin = exported && typeof exported.create === "function" ? exported.create() : exported;
    if (plugin && typeof plugin.start === "function") await plugin.start(boss);
    const names = plugin ? Object.keys(plugin).sort() : [];
    send({ kind: "ready", exports: names.length > 0 ? names : ["<no exports>"] });
  } catch (error) {
    pluginError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    send({ kind: "ready", exports: [`LOAD_FAILED:${pluginError}`] });
  }
}

/** Service an invocation the HOST already authorized. */
async function onHostInvoke(message) {
  invocationCount++;
  if (!plugin || typeof plugin.onInvoke !== "function") {
    send({ kind: "invoke-result", callId: message.callId, allowed: false, reason: "the plugin does not implement onInvoke" });
    return;
  }
  try {
    const result = await plugin.onInvoke({ capability: message.capability, action: message.action, resource: message.resource, input: message.input });
    send({ kind: "invoke-result", callId: message.callId, allowed: true, result });
  } catch (error) {
    send({ kind: "invoke-result", callId: message.callId, allowed: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

function onHostHealth() {
  let reported = {};
  try {
    if (plugin && typeof plugin.health === "function") reported = plugin.health() || {};
  } catch (error) {
    reported = { status: "DEGRADED", detail: `health() threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  send({
    kind: "health",
    status: pluginError ? "DEGRADED" : reported.status || "READY",
    detail: pluginError ? `the plugin failed to load: ${pluginError}` : reported.detail || "the plugin reports no detail",
    invocations: invocationCount,
    logs: logs.slice(-10),
    sandbox: selfTest()
  });
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.kind === "invoke-result") return onInvokeResult(message);
  if (message.kind === "host-invoke") return void onHostInvoke(message);
  if (message.kind === "host-health") return onHostHealth();
  if (message.kind === "shutdown") return void shutdown();
});

void loadPlugin();
