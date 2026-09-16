import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROCESS_MAX_BUFFER_BYTES,
  PROCESS_TIMEOUT_MS,
  killProcessTree,
  processTranscript,
  runProcess,
  runProcessSync,
  superviseProcess
} from "../../electron/process/process-gateway";

/**
 * Convergence book, Phase M — the process half.
 *
 * Phase M's git half is asserted in `git-gateway.test.ts`. This file asserts the
 * other half, and it is exercised against real processes rather than a double,
 * because the whole point is what the runtime actually reports: the assertions
 * below were written from measured `child_process` behaviour (a timeout kill
 * arrives as `killed: true` with a null code; a missing binary arrives as
 * `ENOENT` with two empty strings; a buffer overflow arrives as
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` with the transcript cut exactly at the
 * bound).
 *
 * The defect being closed is evidence loss: `${stdout}${stderr}` is the empty
 * string both when a command ran and said nothing and when the command never
 * existed, so a recorded `passed: false, exitCode: null, output: ""` cannot be
 * told apart from a real finding.
 */

const NODE = process.execPath;
/** A child that starts, does nothing, and outlives any assertion below. */
const hang = (ms: number) => ["-e", `setTimeout(() => {}, ${ms})`];
const BANDS = { timeoutMs: PROCESS_TIMEOUT_MS.check, maxBufferBytes: PROCESS_MAX_BUFFER_BYTES.small };

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-process-gateway-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe("Phase M — the process gateway", () => {
  it("reports a clean run as ok with both streams captured", async () => {
    const result = await runProcess(NODE, ["-e", "process.stdout.write('answer\\n'); process.stderr.write('note\\n')"], BANDS);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("answer\n");
    expect(result.stderr).toBe("note\n");
    expect(result.timedOut).toBe(false);
    expect(result.spawnError).toBeUndefined();
  });

  it("reports a failing command as the command's own answer, not as a launch failure", async () => {
    // A check that found problems exited. That is an answer, and the caller needs
    // the exit code and the transcript — not a launch error.
    const result = await runProcess(NODE, ["-e", "process.stderr.write('two problems\\n'); process.exit(3)"], BANDS);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("two problems");
    expect(result.spawnError).toBeUndefined();
    expect(result.timedOut).toBe(false);
  });

  it("names a missing executable instead of recording an empty answer", async () => {
    const result = await runProcess("codex-boss-no-such-binary", [], BANDS);
    expect(result.ok).toBe(false);
    expect(result.code).toBeNull();
    expect(result.spawnError).toContain("could not be started");
    // Both streams really are empty here: that is why the reason has to exist.
    expect(`${result.stdout}${result.stderr}`).toBe("");
    expect(processTranscript(result)).toContain("could not be started");
  });

  it("names the timeout, so a check that never finished is not recorded as a failing check", async () => {
    const result = await runProcess(NODE, hang(60_000), { timeoutMs: 800, maxBufferBytes: PROCESS_MAX_BUFFER_BYTES.small });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(result.spawnError).toContain("killed after 800ms");
  });

  it("records the truncation when the buffer bound is hit", async () => {
    const result = await runProcess(NODE, ["-e", "process.stdout.write('x'.repeat(200000))"], { timeoutMs: PROCESS_TIMEOUT_MS.check, maxBufferBytes: 1_000 });
    expect(result.ok).toBe(false);
    expect(result.spawnError).toContain("1000-byte bound");
    // The partial transcript is kept and the reason appended: a truncated
    // transcript that looks complete is the failure mode this guards.
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(processTranscript(result)).toContain("truncated");
  });

  it("reports a cancellation as cancelled, not as a failure of the command", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 250);
    const result = await runProcess(NODE, hang(60_000), { ...BANDS, timeoutMs: PROCESS_TIMEOUT_MS.suite, signal: controller.signal });
    expect(result.ok).toBe(false);
    expect(result.spawnError).toContain("cancelled");
    expect(result.timedOut).toBe(false);
  });

  it("honours the working directory and passes the environment through", async () => {
    const dir = makeTree();
    const result = await runProcess(NODE, ["-e", "process.stdout.write(process.cwd() + '|' + String(process.env.BOSS_GATEWAY))"], {
      ...BANDS,
      cwd: dir,
      env: { ...process.env, BOSS_GATEWAY: "from-the-caller" }
    });
    expect(result.ok).toBe(true);
    // The basename, not the whole path: the OS may hand back a canonicalised
    // prefix for the temp directory, but the child really is in this one.
    expect(result.stdout.toLowerCase()).toContain(path.basename(dir).toLowerCase());
    expect(result.stdout).toContain("|from-the-caller");
  });

  it("agrees with its synchronous form", async () => {
    const args = ["-e", "process.stdout.write('sync\\n')"];
    const sync = runProcessSync(NODE, args, BANDS);
    const async_ = await runProcess(NODE, args, BANDS);
    expect(sync.ok).toBe(true);
    expect(sync.code).toBe(async_.code);
    expect(sync.stdout).toBe(async_.stdout);
  });

  it("reports a synchronous timeout from the runtime's own code", () => {
    const result = runProcessSync(NODE, hang(60_000), { timeoutMs: 800, maxBufferBytes: PROCESS_MAX_BUFFER_BYTES.small });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(result.spawnError).toContain("killed after 800ms");
  });

  it("writes nothing extra when a process ran and was silent", async () => {
    const result = await runProcess(NODE, ["-e", ""], BANDS);
    expect(result.ok).toBe(true);
    expect(processTranscript(result)).toBe("");
  });

  it("states its bands, so a call site chooses the operation's bound", () => {
    expect(PROCESS_TIMEOUT_MS.probe).toBeLessThan(PROCESS_TIMEOUT_MS.short);
    expect(PROCESS_TIMEOUT_MS.short).toBeLessThan(PROCESS_TIMEOUT_MS.check);
    expect(PROCESS_TIMEOUT_MS.check).toBeLessThan(PROCESS_TIMEOUT_MS.build);
    expect(PROCESS_TIMEOUT_MS.build).toBeLessThan(PROCESS_TIMEOUT_MS.suite);
    expect(PROCESS_MAX_BUFFER_BYTES.small).toBeLessThan(PROCESS_MAX_BUFFER_BYTES.standard);
    expect(PROCESS_MAX_BUFFER_BYTES.standard).toBeLessThan(PROCESS_MAX_BUFFER_BYTES.huge);
  });
});

/** How a module reaches for `child_process`: an import, not a mention in a comment. */
const CHILD_PROCESS_IMPORT = /(?:from\s*["']node:child_process["'])|(?:require\(\s*["']node:child_process["']\s*\))/;

/**
 * The two modules allowed to import `child_process` directly, each because it IS
 * a gateway: the git one owns every `git` spawn and states its own bands, this one
 * owns every other process started for its output.
 */
const GATEWAYS: Record<string, string> = {
  "electron/process/process-gateway.ts": "the process gateway itself",
  "electron/git/git-gateway.ts": "Phase M's git half: it owns every git spawn and states git's own bands"
};

/**
 * Every module that still imports `child_process` and why it has not moved.
 *
 * Each entry starts a process it must *supervise* rather than read: a child whose
 * stdout arrives incrementally over the life of the operation, or one that has to
 * be signalled later. Those need a streaming/supervision surface, not a
 * capture-and-return one, so folding them in is a different change from this one.
 * The companion test keeps the list honest in both directions: a new direct
 * import anywhere under `electron/**` fails here, and an entry that no longer
 * imports `child_process` also fails.
 */
const DECLARED_PROCESS_DEBT: Record<string, string> = {
  "electron/remote-relay.ts": "a long-lived relay whose stdio streams carry a channel protocol",
  "electron/host/soak-harness.ts": "spawns the application under soak, then samples and signals it (including taskkill on the tree)",
  "electron/self-evolution/self-evolution-coordinator.ts": "spawns the evolution battery and streams its progress",
  "electron/runtimes/codex/codex-cli-runtime.ts": "the agent process itself is long-lived and cancellable; its capture probe goes through the gateway",
  "electron/computer/backends/windows-uia.ts": "a persistent UIA bridge process, killed on abort and capped while it streams",
  "electron/computer/backends/windows-ocr.ts": "a persistent OCR process with a streaming cap and an abort signal",
  "electron/self-evolution/sandbox/sandbox-drive.ts": "the sandbox owns this boundary: `subst.exe` mapping inside its own confinement",
  "electron/self-evolution/sandbox/windows-appcontainer-backend.ts": "the sandbox IS the process boundary for Candidate work; it may not delegate the child's creation"
};

/**
 * Modules that start a process to ISOLATE it rather than to read it.
 *
 * A third category, distinct from both gateways and debt. The process gateway exists to capture a
 * child's output with bands; a sandbox exists to run untrusted code where it cannot reach the
 * parent. Delegating a plugin's process creation to the gateway would be wrong in the direction
 * that matters — the gateway would hand the untrusted child a capture channel and run it under the
 * parent's own privileges — so these modules must own their `fork` and the child's permissions.
 *
 * The distinction is kept visible rather than folded into the debt list: debt means "not migrated
 * yet", this means "must not migrate".
 */
const ISOLATION_BOUNDARIES: Record<string, string> = {
  "electron/capability/plugin-host.ts": "the plugin boundary: it forks an untrusted plugin under Node's permission model, a shape the gateway's capture-and-return surface cannot express and must not absorb"
};

/** The modules Phase M's process half has already moved onto the gateway. */
const MIGRATED_TO_GATEWAY = [
  "electron/engineering/command-runner.ts",
  "electron/engineering/verification.ts",
  "electron/engineering/verification-engine.ts",
  "electron/software/media-adapters.ts",
  "electron/github/github-machine-runtime.ts",
  "electron/computer/backends/structured-apps.ts",
  "electron/research/manuscript/latex-compiler.ts",
  "electron/runtimes/codex/codex-cli-runtime.ts",
  // Phase M's supervision half: the two runners that watch a child while it runs.
  "electron/research/runtime/process-runner.ts",
  "electron/host/process-runner.ts"
];

function repoFile(relative: string): string {
  return path.join(process.cwd(), ...relative.split("/"));
}

function sourceFilesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFilesUnder(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

describe("Phase M — the supervision surface", () => {
  const BOUNDS = { timeoutMs: PROCESS_TIMEOUT_MS.check, maxStdoutChars: PROCESS_MAX_BUFFER_BYTES.small, maxStderrChars: PROCESS_MAX_BUFFER_BYTES.small };

  it("hands the caller the child and captures both streams", async () => {
    const pids: number[] = [];
    const outcome = await superviseProcess(NODE, ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(4)"], {
      ...BOUNDS,
      onSpawn: (child) => { if (child.pid) pids.push(child.pid); }
    });
    expect(outcome.stdout).toBe("out");
    expect(outcome.stderr).toBe("err");
    expect(outcome.code).toBe(4);
    expect(outcome.timedOut).toBe(false);
    expect(pids.length).toBe(1);
  });

  it("stops the child when the bound expires, and says which bound it was", async () => {
    const stopped: number[] = [];
    const outcome = await superviseProcess(NODE, hang(60_000), {
      ...BOUNDS,
      timeoutMs: 800,
      // The caller's own stop policy, which is the point of the option: the host
      // runner reaches for the whole tree, a compiler does not need to.
      stop: (child) => { if (child.pid) stopped.push(child.pid); killProcessTree(child.pid); }
    });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.code).toBeNull();
    expect(stopped.length).toBe(1);
  });

  it("spawns nothing at all when the signal was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let spawned = 0;
    const outcome = await superviseProcess(NODE, hang(60_000), { ...BOUNDS, signal: controller.signal, onSpawn: () => { spawned += 1; } });
    expect(outcome.cancelled).toBe(true);
    expect(outcome.durationMs).toBe(0);
    expect(spawned).toBe(0);
  });

  it("stops a running child when the caller cancels", async () => {
    const controller = new AbortController();
    const pending = superviseProcess(NODE, hang(60_000), { ...BOUNDS, timeoutMs: PROCESS_TIMEOUT_MS.suite, signal: controller.signal });
    setTimeout(() => controller.abort(), 250);
    const outcome = await pending;
    expect(outcome.cancelled).toBe(true);
    expect(outcome.timedOut).toBe(false);
  });

  it("calls a missing binary a launch failure with empty streams", async () => {
    const outcome = await superviseProcess("codex-boss-no-such-binary", [], BOUNDS);
    expect(outcome.spawnError).toBeTruthy();
    expect(outcome.code).toBeNull();
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toBe("");
  });

  it("kills a process tree, which is what the host runner's bound needs", async () => {
    // A real child, stopped through the gateway's own policy: the acceptance hub
    // relies on this to stop `npm run`'s grandchildren, so it is exercised here
    // rather than assumed.
    let pid: number | undefined;
    const pending = superviseProcess(NODE, hang(60_000), { ...BOUNDS, timeoutMs: PROCESS_TIMEOUT_MS.suite, onSpawn: (child) => { pid = child.pid; } });
    while (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    killProcessTree(pid);
    const outcome = await pending;
    // Stopped from outside: no timeout of ours fired, and the child did not exit 0.
    expect(outcome.timedOut).toBe(false);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.code === null || outcome.code !== 0).toBe(true);
  });
});

describe("Phase M — one entry point for a process started for its output", () => {
  it("is the only place the application starts a process, apart from the git gateway", () => {
    const offenders: string[] = [];
    for (const full of sourceFilesUnder(path.join(process.cwd(), "electron"))) {
      const relative = path.relative(process.cwd(), full).split(path.sep).join("/");
      if (relative in GATEWAYS || relative in DECLARED_PROCESS_DEBT || relative in ISOLATION_BOUNDARIES) continue;
      if (!CHILD_PROCESS_IMPORT.test(fs.readFileSync(full, "utf8"))) continue;
      offenders.push(relative);
    }
    expect(offenders.sort()).toEqual([]);
  });

  it("keeps the debt list honest, so a migrated module cannot stay on it", () => {
    const stale = Object.keys(DECLARED_PROCESS_DEBT)
      .filter((relative) => !CHILD_PROCESS_IMPORT.test(fs.readFileSync(repoFile(relative), "utf8")))
      .sort();
    expect(stale).toEqual([]);
  });

  it("keeps both gateways real, so the exemption cannot outlive the module it names", () => {
    const missing = Object.keys(GATEWAYS)
      .filter((relative) => !CHILD_PROCESS_IMPORT.test(fs.readFileSync(repoFile(relative), "utf8")))
      .sort();
    expect(missing).toEqual([]);
  });

  it("keeps the isolation boundaries real, and separate from the gateways and the debt", () => {
    // Same honesty rule the other two lists get: a boundary entry that no longer forks, or that
    // duplicates a gateway, would mean the exemption outlived its reason.
    const names = Object.keys(ISOLATION_BOUNDARIES);
    expect(names.length).toBeGreaterThan(0);
    for (const relative of names) {
      expect(ISOLATION_BOUNDARIES[relative], `${relative} has no stated reason`).toBeTruthy();
      expect(CHILD_PROCESS_IMPORT.test(fs.readFileSync(repoFile(relative), "utf8")), `${relative} is listed as an isolation boundary but does not fork`).toBe(true);
      expect(relative in GATEWAYS, `${relative} is both a gateway and an isolation boundary`).toBe(false);
      expect(relative in DECLARED_PROCESS_DEBT, `${relative} is both debt and an isolation boundary; debt means "not migrated yet"`).toBe(false);
    }
  });

  it("is what the migrated modules actually reach for", () => {
    expect(MIGRATED_TO_GATEWAY.length).toBeGreaterThan(0);
    for (const relative of MIGRATED_TO_GATEWAY) {
      const text = fs.readFileSync(repoFile(relative), "utf8");
      expect(text, `${relative} should route through the gateway`).toContain("process/process-gateway");
    }
  });
});
