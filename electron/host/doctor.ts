import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFileSync } from "node:child_process";
import {
  buildDoctorReport,
  runProbe,
  skippedCheck,
  type DoctorArea,
  type DoctorCheck,
  type DoctorReport
} from "../../src/shared/doctor";
import { inspectDevice } from "../node/node-inspector";

/**
 * Host-M P7 — Boss Doctor.
 *
 * Every probe runs through `runProbe`, so a probe that throws becomes one check's
 * FAIL instead of an exception escaping the doctor. The doctor writes nothing to
 * Boss persistent state: the filesystem probe writes into the OS temp directory
 * and removes what it wrote, and every other probe only reads.
 *
 * A probe that genuinely cannot be evaluated on this machine is `SKIPPED` with the
 * reason — never a silent READY, and never a blocking FAIL. That is what keeps
 * "we could not check" from being reported as "this machine cannot run Boss".
 */

export interface DoctorOptions {
  repoRoot: string;
  dataRoot: string;
  now?: () => string;
  /** Milliseconds allowed for the network probe. */
  networkTimeoutMs?: number;
  /** Skip the network probe entirely (offline/CI runs). */
  skipNetwork?: boolean;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function fileExists(file: string): boolean {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function modifiedAt(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** Newest modification time under a directory, bounded so a big tree is cheap. */
function newestUnder(directory: string, extensions: readonly string[], limit = 5_000): number {
  let newest = 0;
  let seen = 0;
  const visit = (current: string): void => {
    if (seen > limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen > limit) return;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!extensions.includes(path.extname(entry.name))) continue;
      seen += 1;
      newest = Math.max(newest, modifiedAt(absolute));
    }
  };
  visit(directory);
  return newest;
}

/** A bounded TCP reachability probe that resolves a value rather than throwing. */
function probeTcp(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect({ host, port });
    const finish = (ok: boolean, detail: string): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ok, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, `${host}:${port} reachable`));
    socket.once("timeout", () => finish(false, `${host}:${port} timed out after ${timeoutMs}ms`));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(false, `${host}:${port} failed: ${error.code ?? error.message}`));
  });
}

const REQUIRED_NODE_MAJOR = 18;

function runtimeChecks(repoRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push(
    runProbe(() => process.version, {
      id: "runtime.node",
      area: "runtime",
      label: "node runtime",
      expected: `>= v${REQUIRED_NODE_MAJOR}`,
      remedy: `install node >= ${REQUIRED_NODE_MAJOR} and re-run`,
      classify: (version) => {
        const major = Number(String(version).replace(/^v/, "").split(".")[0]);
        return {
          status: major >= REQUIRED_NODE_MAJOR ? "READY" : "FAIL",
          observed: `${version} on ${process.platform}/${process.arch}`,
          reason: major >= REQUIRED_NODE_MAJOR ? undefined : `node ${version} is older than v${REQUIRED_NODE_MAJOR}`
        };
      }
    })
  );
  checks.push(
    runProbe(() => inspectDevice({}), {
      id: "runtime.device",
      area: "runtime",
      label: "device self-inspection",
      expected: "a node probe with cpu and memory reported",
      remedy: "device inspection is read-only; a failure here means the OS APIs changed",
      classify: (probe) => ({
        status: probe.cpu.cores > 0 && probe.memory.totalMb > 0 ? "READY" : "DEGRADED",
        observed: `${probe.cpu.cores} core(s), ${Math.round(probe.memory.totalMb / 1024)} GiB RAM, ${probe.os.platform}`,
        reason: probe.cpu.cores > 0 ? undefined : "the node probe reported no cores"
      })
    })
  );
  checks.push(
    runProbe(() => path.join(repoRoot, "package.json"), {
      id: "runtime.checkout",
      area: "runtime",
      label: "checkout layout",
      expected: "package.json, tsconfig.json and src/ are present",
      remedy: "run the doctor from a complete checkout of the repository",
      classify: (pkg) => {
        void pkg;
        const missing = ["package.json", "tsconfig.json", "src", "electron"].filter((name) => !fileExists(path.join(repoRoot, name)));
        return {
          status: missing.length === 0 ? "READY" : "FAIL",
          observed: missing.length ? `missing ${missing.join(", ")}` : "package.json, tsconfig.json, src/, electron/ present",
          reason: missing.length ? `the checkout is incomplete: ${missing.join(", ")}` : undefined
        };
      }
    })
  );
  return checks;
}

function dependencyChecks(repoRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push(
    runProbe(() => path.join(repoRoot, "node_modules"), {
      id: "dependency.installed",
      area: "dependency",
      label: "dependencies installed",
      expected: "node_modules/ contains the declared runtime packages",
      remedy: "install dependencies (the repository uses a pinned pnpm store)",
      classify: (modules) => {
        const missing = ["electron", "react", "react-dom", "typescript", "vitest"].filter((name) => !fileExists(path.join(modules, name)));
        return {
          status: missing.length === 0 ? "READY" : "FAIL",
          observed: missing.length ? `missing ${missing.join(", ")}` : "electron, react, react-dom, typescript, vitest present",
          reason: missing.length ? `node_modules is incomplete: ${missing.join(", ")}` : undefined
        };
      }
    })
  );
  checks.push(
    runProbe(() => ["dist-electron/electron/main.js", "dist-electron/electron/store.js"], {
      id: "dependency.build-artifacts",
      area: "dependency",
      label: "compiled main-process artifacts",
      expected: "the electron emit produced main.js and store.js",
      remedy: "run: npx tsc -p tsconfig.electron.json",
      classify: (files) => {
        const missing = files.filter((file) => !fileExists(path.join(repoRoot, file)));
        return {
          status: missing.length === 0 ? "READY" : "DEGRADED",
          observed: missing.length ? `missing ${missing.join(", ")}` : `${files.length} artifact(s) present`,
          reason: missing.length ? "the main process has not been compiled; scripts that load dist-electron will not run" : undefined
        };
      }
    })
  );
  checks.push(
    runProbe(() => path.join(repoRoot, "package.json"), {
      id: "dependency.manifest",
      area: "dependency",
      label: "package manifest parses",
      expected: "package.json is valid JSON with a main entry",
      remedy: "restore package.json from version control",
      classify: (file) => {
        const parsed = readJson(file) as { main?: string; dependencies?: Record<string, string> };
        const declared = Object.keys(parsed.dependencies ?? {}).length;
        return {
          status: parsed.main ? "READY" : "DEGRADED",
          observed: `main=${parsed.main ?? "absent"}, ${declared} runtime dependency(ies)`,
          reason: parsed.main ? undefined : "package.json declares no main entry"
        };
      }
    })
  );
  return checks;
}

/** A corrupt store is DEGRADED, not FAIL: Boss ships fail-closed readers for these. */
function readJsonOrUndefined(file: string): unknown | undefined {
  try {
    return readJson(file);
  } catch {
    return undefined;
  }
}

function filesystemChecks(repoRoot: string, dataRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  let probeFile = "";
  checks.push(
    runProbe(() => {
      // Write only into the OS temp directory, and remove what was written.
      probeFile = path.join(os.tmpdir(), `boss-doctor-${process.pid}-${Date.now()}.tmp`);
      fs.mkdirSync(path.dirname(probeFile), { recursive: true });
      fs.writeFileSync(probeFile, "boss-doctor", "utf8");
      const read = fs.readFileSync(probeFile, "utf8");
      fs.rmSync(probeFile, { force: true });
      return { written: read === "boss-doctor", removed: !fs.existsSync(probeFile) };
    }, {
      id: "filesystem.temp-writable",
      area: "filesystem",
      label: "temporary directory is writable",
      expected: "a probe file can be written, read back and removed",
      remedy: "check TEMP/TMP permissions and available disk space",
      classify: (result) => ({
        status: result.written && result.removed ? "READY" : "FAIL",
        observed: `write=${result.written}, cleanup=${result.removed}`,
        reason: result.written ? undefined : "the temp directory did not return the bytes that were written"
      })
    })
  );
  checks.push(
    runProbe(() => dataRoot, {
      id: "filesystem.data-root",
      area: "filesystem",
      label: "Boss data root is readable",
      expected: "the data root exists and its contents can be listed",
      remedy: "create the data root or pass --boss-data-dir to point at an existing directory",
      classify: (root) => {
        if (!fileExists(root)) {
          return { status: "DEGRADED", observed: `${root} does not exist yet`, reason: "Boss will create the data root on first start" };
        }
        const entries = fs.readdirSync(root);
        return { status: "READY", observed: `${root} (${entries.length} entry/entries)` };
      }
    })
  );
  checks.push(
    runProbe(() => path.join(repoRoot, ".git"), {
      id: "filesystem.repo-writable",
      area: "filesystem",
      label: "checkout is a git work tree",
      expected: ".git is present so evidence can name its revision",
      remedy: "run from a git clone; revision provenance requires it",
      classify: (git) => ({
        status: fileExists(git) ? "READY" : "DEGRADED",
        observed: fileExists(git) ? ".git present" : ".git absent",
        reason: fileExists(git) ? undefined : "the checkout is not a git work tree, so evidence cannot record a revision"
      })
    })
  );
  checks.push(
    runProbe(() => "unknown", {
      id: "filesystem.free-space",
      area: "filesystem",
      label: "free disk space",
      expected: "at least 1 GiB free",
      remedy: "free space, or point --boss-data-dir at a volume with room",
      classify: () => {
        try {
          const stat = fs.statfsSync(os.tmpdir());
          const free = stat.bsize * stat.bavail;
          const gib = free / 1024 ** 3;
          return {
            status: gib >= 1 ? "READY" : "DEGRADED",
            observed: `${gib.toFixed(1)} GiB free on the temp volume`,
            reason: gib >= 1 ? undefined : `only ${gib.toFixed(1)} GiB free`
          };
        } catch (error) {
          // statfs is not implemented on every platform; that is a skip, not a fail.
          return { status: "SKIPPED", observed: "free space is not reported on this platform", reason: `statfs unavailable: ${String(error)}` };
        }
      }
    })
  );
  return checks;
}

function browserChecks(repoRoot: string, dataRoot: string): DoctorCheck[] {
  const electronBinary = path.join(repoRoot, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
  const checks: DoctorCheck[] = [];
  checks.push(
    runProbe(() => electronBinary, {
      id: "browser.electron-binary",
      area: "browser",
      label: "electron binary is installed",
      expected: "node_modules/electron/dist holds the runtime",
      remedy: "run: npx node node_modules/electron/install.js",
      classify: (binary) => ({
        status: fileExists(binary) ? "READY" : "DEGRADED",
        observed: fileExists(binary) ? path.relative(repoRoot, binary) : "electron binary absent",
        reason: fileExists(binary) ? undefined : "the web-AI surfaces cannot open without the electron runtime"
      })
    })
  );
  checks.push(
    runProbe(() => path.join(dataRoot, ".cache", "browser-profile"), {
      id: "browser.profile",
      area: "browser",
      label: "provider browser profile",
      expected: "a prepared profile directory exists",
      remedy: "Boss creates the profile on first start; nothing to do unless it is unreadable",
      classify: (profile) => {
        if (!fileExists(profile)) return { status: "SKIPPED", observed: `${profile} does not exist yet`, reason: "no provider session has been opened on this data root" };
        const entries = fs.readdirSync(profile);
        return { status: entries.length ? "READY" : "DEGRADED", observed: `${entries.length} profile entr(ies)`, reason: entries.length ? undefined : "the profile directory is empty" };
      }
    })
  );
  checks.push(
    runProbe(() => process.platform, {
      id: "browser.gui-session",
      area: "browser",
      label: "interactive GUI session",
      expected: "a desktop session exists for visible provider windows",
      remedy: "live provider acceptance needs an interactive desktop; headless runs should expect BLOCKED_EXTERNAL there",
      classify: (platformName) => {
        // A session type is only knowable on Linux; elsewhere report what is known.
        if (platformName === "linux") {
          const display = process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY;
          return { status: display ? "READY" : "SKIPPED", observed: display ? `display ${display}` : "no DISPLAY set", reason: display ? undefined : "no X11/Wayland display is available" };
        }
        return { status: "SKIPPED", observed: `GUI presence is not probeable from node on ${platformName}`, reason: `the ${platformName} desktop session cannot be detected without a window-system API` };
      }
    })
  );
  return checks;
}

async function networkChecks(options: DoctorOptions): Promise<DoctorCheck[]> {
  if (options.skipNetwork) {
    return [skippedCheck({ id: "network.egress", area: "network", label: "outbound network", expected: "a TCP connection to a public endpoint", reason: "the network probe was skipped for this run" })];
  }
  const timeout = options.networkTimeoutMs ?? 6_000;
  const result = await probeTcp("registry.npmjs.org", 443, timeout).catch((error) => ({ ok: false, detail: String(error) }));
  return [
    {
      id: "network.egress",
      area: "network",
      label: "outbound network",
      observed: result.detail,
      expected: "at least one public endpoint is reachable",
      status: result.ok ? "READY" : "DEGRADED",
      reason: result.ok ? undefined : "no outbound route was observed; web-AI providers and the package registry will be unreachable",
      remedy: "check the proxy/VPN configuration, or accept that offline-only work is all that is possible",
      durationMs: 0
    }
  ];
}

function providerChecks(dataRoot: string): DoctorCheck[] {
  const boss = path.join(dataRoot, ".boss");
  const checks: DoctorCheck[] = [];

  checks.push(
    runProbe(() => path.join(boss, "provider-capabilities.json"), {
      id: "account.capabilities",
      area: "account",
      label: "provider capability overrides",
      expected: "the override file parses, or does not exist yet",
      remedy: "delete a corrupt provider-capabilities.json; Boss rebuilds it from the baseline profiles",
      classify: (file) => {
        if (!fileExists(file)) return { status: "SKIPPED", observed: "no overrides recorded", reason: "no provider capability override has been written yet" };
        readJson(file);
        return { status: "READY", observed: "override file parses" };
      }
    })
  );

  checks.push(
    runProbe(() => path.join(boss, "session-lifecycle.json"), {
      id: "account.session-ledger",
      area: "account",
      label: "session lifecycle ledger",
      expected: "the ledger parses and reports each provider's last state",
      remedy: "delete a corrupt session-lifecycle.json; Boss rebuilds it from live probes",
      classify: (file) => {
        if (!fileExists(file)) return { status: "SKIPPED", observed: "no session has been recorded", reason: "no provider session has been opened on this data root" };
        const parsed = readJson(file) as { records?: Array<{ providerId?: string; state?: string }> };
        const records = parsed.records ?? [];
        const expired = records.filter((record) => record.state === "EXPIRED" || record.state === "REAUTH_REQUIRED" || record.state === "FAILED").length;
        const healthy = records.length - expired;
        return {
          status: expired === 0 ? "READY" : healthy > 0 ? "DEGRADED" : "FAIL",
          observed: records.length ? `${records.length} provider(s): ${healthy} logged in, ${expired} needing attention` : "ledger present but empty",
          reason: expired === 0 ? undefined : `${expired} provider session(s) are expired or failed`
        };
      }
    })
  );
  return checks;
}

function ipcChecks(repoRoot: string): DoctorCheck[] {
  // The doctor does not own the channel list — electron/main.ts does. Re-declaring
  // it here would create a second source of truth that could silently disagree
  // with the real registration, so the doctor verifies the real surface instead:
  // that the main process registers handlers and the preload bridge exposes them.
  return [
    runProbe(() => ({
      main: path.join(repoRoot, "electron", "main.ts"),
      preload: path.join(repoRoot, "electron", "preload.ts")
    }), {
      id: "ipc.surface",
      area: "ipc",
      label: "IPC registration surface",
      expected: "main.ts registers ipcMain handlers and preload.ts exposes the bridge",
      remedy: "restore electron/main.ts and electron/preload.ts from version control",
      classify: (files) => {
        const missing = Object.entries(files).filter(([, file]) => !fileExists(file)).map(([name]) => name);
        if (missing.length) {
          return { status: "FAIL", observed: `missing ${missing.join(", ")}`, reason: "the IPC surface files are absent" };
        }
        const main = fs.readFileSync(files.main, "utf8");
        const preload = fs.readFileSync(files.preload, "utf8");
        const handlers = (main.match(/ipcMain\.handle\(/g) ?? []).length;
        const exposed = /contextBridge\.exposeInMainWorld\(/.test(preload);
        const bridge = /BossBridge/.test(preload);
        return {
          status: handlers > 0 && exposed && bridge ? "READY" : "DEGRADED",
          observed: `${handlers} ipcMain.handle call(s); preload exposes the bridge=${exposed}, typed=${bridge}`,
          reason:
            handlers > 0 && exposed && bridge
              ? undefined
              : "the registration surface looks incomplete; the renderer bridge may not match the handlers"
        };
      }
    })
  ];
}

function fleetChecks(dataRoot: string): DoctorCheck[] {
  const boss = path.join(dataRoot, ".boss");
  return [
    runProbe(() => path.join(boss, "node-registry.json"), {
      id: "fleet.node-registry",
      area: "fleet",
      label: "node registry",
      expected: "the registry parses, or no node has registered yet",
      remedy: "delete a corrupt node-registry.json; Boss re-registers this desktop on start",
      classify: (file) => {
        if (!fileExists(file)) return { status: "SKIPPED", observed: "no node has registered", reason: "this data root has no node registry yet" };
        const parsed = readJson(file) as { schemaVersion?: number; records?: unknown[] };
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) {
          return { status: "FAIL", observed: `schemaVersion=${parsed.schemaVersion ?? "absent"}`, reason: "the node registry does not match its schema" };
        }
        return { status: "READY", observed: `${parsed.records.length} registered node(s)` };
      }
    }),
    runProbe(() => path.join(boss, "fleet.json"), {
      id: "fleet.coordinator",
      area: "fleet",
      label: "fleet coordinator state",
      expected: "the coordinator file parses, or no fleet has formed",
      remedy: "delete a corrupt fleet.json; the coordinator rebuilds from heartbeats",
      classify: (file) => {
        if (!fileExists(file)) return { status: "SKIPPED", observed: "no fleet has formed", reason: "single-node operation needs no coordinator file" };
        const parsed = readJson(file) as { schemaVersion?: number; nodes?: unknown[]; assignments?: unknown[] };
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.nodes)) {
          return { status: "FAIL", observed: `schemaVersion=${parsed.schemaVersion ?? "absent"}`, reason: "the fleet coordinator file does not match its schema" };
        }
        return { status: "READY", observed: `${parsed.nodes.length} node(s), ${(parsed.assignments ?? []).length} assignment(s)` };
      }
    })
  ];
}

function knowledgeChecks(dataRoot: string): DoctorCheck[] {
  const boss = path.join(dataRoot, ".boss");
  return [
    runProbe(() => path.join(boss, "workspaces.json"), {
      id: "knowledge.workspaces",
      area: "knowledge",
      label: "workspace registry",
      expected: "the workspace registry parses, or no workspace is recorded yet",
      remedy: "delete a corrupt workspaces.json; Boss recreates the default workspace",
      classify: (file) => {
        if (!fileExists(file)) return { status: "SKIPPED", observed: "no workspace recorded", reason: "this data root has no workspace registry yet" };
        const parsed = readJson(file) as { schemaVersion?: number; workspaces?: unknown[] };
        if (!Array.isArray(parsed.workspaces)) return { status: "FAIL", observed: "no workspaces array", reason: "the workspace registry does not match its schema" };
        return { status: "READY", observed: `${parsed.workspaces.length} workspace(s)` };
      }
    }),
    runProbe(() => path.join(boss, "knowledge"), {
      id: "knowledge.store",
      area: "knowledge",
      label: "knowledge store",
      expected: "the shared knowledge space is readable, or nothing has been stored yet",
      remedy: "a corrupt knowledge record is quarantined by the store; run the evidence inspector to identify it",
      classify: (directory) => {
        if (!fileExists(directory)) return { status: "SKIPPED", observed: "no knowledge stored", reason: "this data root has no knowledge store yet" };
        const files = fs.readdirSync(directory, { recursive: true } as never) as string[];
        const jsonl = files.filter((name) => String(name).endsWith(".jsonl"));
        let badRows = 0;
        for (const name of jsonl) {
          const file = path.join(directory, String(name));
          try {
            for (const line of fs.readFileSync(file, "utf8").split("\n")) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                JSON.parse(trimmed);
              } catch {
                badRows += 1;
              }
            }
          } catch {
            badRows += 1;
          }
        }
        return {
          status: badRows === 0 ? "READY" : "DEGRADED",
          observed: `${jsonl.length} record file(s), ${badRows} unreadable row(s)`,
          reason: badRows === 0 ? undefined : `${badRows} knowledge row(s) do not parse`
        };
      }
    })
  ];
}

function learningChecks(dataRoot: string): DoctorCheck[] {
  const learningRoot = path.join(dataRoot, ".boss", "learning");
  return [
    runProbe(() => learningRoot, {
      id: "learning.flag-store",
      area: "learning",
      label: "adaptive flag store",
      expected: "the flag file parses and every adaptive capability is OFF by default",
      remedy: "delete a corrupt adaptive-flags.json; every adaptive capability fails closed to OFF",
      classify: (root) => {
        const file = path.join(root, "adaptive-flags.json");
        if (!fileExists(file)) return { status: "SKIPPED", observed: "no flag file", reason: "adaptive flags have never been written; all capabilities default to OFF" };
        const parsed = readJsonOrUndefined(file) as { schemaVersion?: number; flags?: Record<string, unknown> } | undefined;
        if (!parsed || parsed.schemaVersion !== 1 || !parsed.flags) {
          return { status: "DEGRADED", observed: "the flag file is unreadable or does not match its schema", reason: "the flag store fails closed to all-OFF, so no adaptive capability will activate" };
        }
        const on = Object.entries(parsed.flags).filter(([, value]) => value === true).map(([name]) => name);
        return { status: "READY", observed: on.length ? `${on.length} capability(ies) enabled: ${on.join(", ")}` : "every capability is OFF" };
      }
    }),
    runProbe(() => path.join(learningRoot, "episodes.jsonl"), {
      id: "learning.episode-store",
      area: "learning",
      label: "episode store",
      expected: "the append-only episode log is readable",
      remedy: "a corrupt row degrades learning only; Boss keeps running with the remaining episodes",
      classify: (file) => {
        if (!fileExists(file)) return { status: "SKIPPED", observed: "no episodes recorded", reason: "no episode has been appended yet" };
        let rows = 0;
        let bad = 0;
        for (const line of fs.readFileSync(file, "utf8").split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          rows += 1;
          try {
            JSON.parse(trimmed);
          } catch {
            bad += 1;
          }
        }
        return { status: bad === 0 ? "READY" : "DEGRADED", observed: `${rows} row(s), ${bad} unreadable`, reason: bad === 0 ? undefined : `${bad} episode row(s) do not parse; learning degrades, Boss continues` };
      }
    })
  ];
}

function compatibilityChecks(repoRoot: string): DoctorCheck[] {
  return [
    runProbe(() => ({
      source: newestUnder(path.join(repoRoot, "electron"), [".ts"]),
      shared: newestUnder(path.join(repoRoot, "src", "shared"), [".ts"]),
      compiled: newestUnder(path.join(repoRoot, "dist-electron"), [".js"])
    }), {
      id: "compatibility.build-freshness",
      area: "compatibility",
      label: "compiled output is newer than the sources",
      expected: "dist-electron is at least as new as electron/ and src/shared/",
      remedy: "run: npx tsc -p tsconfig.electron.json",
      classify: (times) => {
        if (!times.compiled) return { status: "SKIPPED", observed: "no compiled output", reason: "dist-electron is absent, so freshness cannot be judged" };
        if (!times.source && !times.shared) return { status: "SKIPPED", observed: "no sources found", reason: "no TypeScript sources were found to compare against" };
        const newestSource = Math.max(times.source, times.shared);
        const stale = newestSource > times.compiled;
        return {
          status: stale ? "DEGRADED" : "READY",
          observed: `newest source ${new Date(newestSource).toISOString()}, compiled ${new Date(times.compiled).toISOString()}`,
          reason: stale ? "the compiled output is older than the sources; scripts that load dist-electron would test stale code" : undefined
        };
      }
    }),
    runProbe(() => path.join(repoRoot, "tsconfig.electron.json"), {
      id: "compatibility.tsconfig",
      area: "compatibility",
      label: "TypeScript project configuration",
      expected: "both projects declare their include/outDir",
      remedy: "restore the tsconfig files from version control",
      classify: (electronConfig) => {
        const root = path.join(repoRoot, "tsconfig.json");
        if (!fileExists(electronConfig) || !fileExists(root)) {
          return { status: "FAIL", observed: `tsconfig.json=${fileExists(root)}, tsconfig.electron.json=${fileExists(electronConfig)}`, reason: "a TypeScript project file is missing" };
        }
        const parsed = readJson(electronConfig) as { compilerOptions?: { outDir?: string } };
        return { status: parsed.compilerOptions?.outDir ? "READY" : "DEGRADED", observed: `outDir=${parsed.compilerOptions?.outDir ?? "absent"}`, reason: parsed.compilerOptions?.outDir ? undefined : "the electron project declares no outDir" };
      }
    })
  ];
}

/**
 * Runs every probe. Each one is isolated; the doctor never throws, and a probe
 * that fails is reported rather than propagated.
 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const now = options.now ?? (() => new Date().toISOString());
  let doctorFailure: string | undefined;
  const checks: DoctorCheck[] = [];
  const area = (label: string, run: () => DoctorCheck[]): void => {
    try {
      checks.push(...run());
    } catch (error) {
      // An entire area failing is still only that area's problem.
      doctorFailure = `${label}: ${String(error)}`;
      checks.push({
        id: `${label}.area`,
        area: label as DoctorArea,
        label: `${label} area`,
        observed: `the area threw: ${String(error)}`,
        expected: "the area runs its probes",
        status: "FAIL",
        reason: `the ${label} area could not run: ${String(error)}`,
        durationMs: 0
      });
    }
  };

  area("runtime", () => runtimeChecks(options.repoRoot));
  area("dependency", () => dependencyChecks(options.repoRoot));
  area("filesystem", () => filesystemChecks(options.repoRoot, options.dataRoot));
  area("browser", () => browserChecks(options.repoRoot, options.dataRoot));
  try {
    checks.push(...(await networkChecks(options)));
  } catch (error) {
    checks.push({
      id: "network.egress",
      area: "network",
      label: "outbound network",
      observed: `the probe threw: ${String(error)}`,
      expected: "at least one public endpoint is reachable",
      status: "SKIPPED",
      reason: `the network probe could not run: ${String(error)}`,
      durationMs: 0
    });
  }
  area("account", () => providerChecks(options.dataRoot));
  area("ipc", () => ipcChecks(options.repoRoot));
  area("fleet", () => fleetChecks(options.dataRoot));
  area("knowledge", () => knowledgeChecks(options.dataRoot));
  area("learning", () => learningChecks(options.dataRoot));
  area("compatibility", () => compatibilityChecks(options.repoRoot));

  return buildDoctorReport({
    repoRoot: options.repoRoot,
    dataRoot: options.dataRoot,
    checks,
    generatedAt: now(),
    doctorFailure
  });
}

export type { DoctorReport, DoctorCheck };

/** Re-exported so a caller does not need to import the pure module separately. */
export { buildDoctorReport, runProbe, skippedCheck };

/** Kept for the CLI: the git revision the doctor ran against. */
export function doctorRevision(repoRoot: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, windowsHide: true, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** `DEGRADED`/`FAIL` count helper for a one-line CLI summary. */
export function doctorConcernCount(report: DoctorReport): number {
  return report.summary.degraded + report.summary.fail;
}
