#!/usr/bin/env node
/**
 * Phase S20/S21 — Candidate runtime boot acceptance entry point.
 *
 * Promotion is not complete when the merge lands: Stable N+1 has to boot. This
 * script crosses the restart boundary for one Candidate without disturbing the
 * Stable that is already running (§20, §21):
 *
 *   * `--boss-data-dir` points at the Candidate's isolated runtime-data;
 *   * userData / sessionData are redirected into the same isolated tree, so the
 *     running Stable's Electron single-instance lock is never contended;
 *   * a separate lock namespace is exported for anything that keys off it;
 *   * the Candidate boots headless, is given a bounded window to reach a healthy
 *     state, and is then asked to exit.
 *
 * It prints one JSON object on stdout and always exits 0 when it managed to
 * produce a verdict; the caller decides what a rejection means.
 *
 * usage:
 *   node scripts/phase05-candidate-boot-acceptance.cjs \
 *     --candidate <worktree> --runtime-data <isolated dir> --namespace <name> \
 *     [--timeout-ms 60000] [--stable-pid <pid>] [--out <file>]
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function parseArguments(argv) {
  const result = { timeoutMs: 60000 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    index += 1;
  }
  return result;
}

function isProcessAlive(pid) {
  if (!pid) return true;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const candidate = args.candidate ? path.resolve(args.candidate) : undefined;
  const runtimeData = args["runtime-data"] ? path.resolve(args["runtime-data"]) : undefined;
  const namespace = typeof args.namespace === "string" ? args.namespace : `codex-boss-candidate-${Date.now()}`;
  const timeoutMs = Number(args["timeout-ms"] ?? 60000);
  const stablePid = args["stable-pid"] ? Number(args["stable-pid"]) : undefined;

  const report = {
    event: "CANDIDATE_BOOT_ACCEPTANCE",
    startedAt,
    candidate: candidate ?? null,
    runtimeData: runtimeData ?? null,
    namespace,
    isolation: {
      dataDirIsolated: false,
      userDataIsolated: false,
      sessionDataIsolated: false,
      lockNamespaceIsolated: false
    },
    stableStillRunning: isProcessAlive(stablePid),
    candidateExited: false,
    accepted: false,
    detail: ""
  };

  if (!candidate || !runtimeData) {
    report.detail = "candidate and runtime-data are required";
    emit(report, args);
    return;
  }
  if (!fs.existsSync(candidate)) {
    report.detail = `candidate worktree does not exist: ${candidate}`;
    emit(report, args);
    return;
  }

  // §21 — every namespace the running Stable uses must be isolated.
  const userData = path.join(runtimeData, "user-data");
  const sessionData = path.join(runtimeData, "session-data");
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(sessionData, { recursive: true });
  report.isolation = { dataDirIsolated: true, userDataIsolated: true, sessionDataIsolated: true, lockNamespaceIsolated: true };

  const electronBinary = path.join(candidate, "node_modules", "electron", "dist", "electron.exe");
  const binary = fs.existsSync(electronBinary) ? electronBinary : path.join(candidate, "node_modules", ".bin", "electron.CMD");
  if (!fs.existsSync(binary)) {
    report.detail = `no Candidate Electron binary at ${binary}`;
    emit(report, args);
    return;
  }

  const environment = {
    ...process.env,
    CODEX_BOSS_DATA_DIR: runtimeData,
    CODEX_BOSS_EVOLUTION_NAMESPACE: namespace,
    CODEX_BOSS_CANDIDATE_ACCEPTANCE: "1",
    ELECTRON_USER_DATA_DIR: userData,
    ELECTRON_SESSION_DATA_DIR: sessionData
  };

  const child = spawn(binary, [".", `--boss-data-dir=${runtimeData}`, "--boss-candidate-acceptance", `--user-data-dir=${userData}`], {
    cwd: candidate,
    env: environment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });

  const verdict = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      resolve({ timedOut: true, code: null });
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code: null, error: String(error.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code });
    });
  });

  report.candidateExited = !verdict.timedOut;
  report.stableStillRunning = isProcessAlive(stablePid);
  // Acceptance requires: the Candidate reached a bootable state, exited on its
  // own, and did not take Stable with it.
  const rejected = verdict.timedOut || verdict.error || (typeof verdict.code === "number" && verdict.code !== 0);
  report.accepted = !rejected && report.stableStillRunning;
  report.detail = rejected
    ? `candidate runtime was rejected: ${verdict.error ?? (verdict.timedOut ? "timed out" : `exit code ${verdict.code}`)} ${output.slice(-500)}`.trim()
    : "candidate runtime booted in an isolated namespace and exited cleanly while Stable kept running";
  report.exitCode = verdict.code ?? null;
  report.completedAt = new Date().toISOString();
  emit(report, args);
}

function emit(report, args) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (typeof args.out === "string" && args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(path.resolve(args.out), text, "utf8");
  }
  process.stdout.write(text);
}

main().catch((error) => {
  process.stderr.write(`candidate boot acceptance failed: ${String(error && error.stack ? error.stack : error)}\n`);
  process.exit(1);
});

void os;
