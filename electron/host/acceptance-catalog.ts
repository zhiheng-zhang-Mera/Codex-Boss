import type { AcceptanceCheck, AcceptanceCheckResult, AcceptanceRequirement } from "../../src/shared/acceptance-hub";
import { blockedReason } from "../../src/shared/acceptance-hub";

/**
 * Host-M P1 — the acceptance catalog.
 *
 * Every entry names an *existing* entry point (a repo script, a compiler
 * invocation, or the unit suite). The hub runs them as black boxes and records
 * their real outcome; it never bends a script to fit the report.
 *
 * Two flags drive scope, and they mean different things:
 *
 * - `enabledByDefault: false` marks a row as expensive, live-only, or writing
 *   outside its own artifact directory. It is only selected when explicitly
 *   requested; when not requested the hub reports SKIPPED_WITH_REASON (a
 *   deliberate choice) rather than BLOCKED_EXTERNAL (a missing prerequisite).
 *   The distinction is preserved in the evidence instead of being flattened.
 * - `entryPoint` names the file the check needs before it can even start. A
 *   missing entry point is BLOCKED_EXTERNAL with that path in the reason, so
 *   the failure reads as "this input does not exist here" rather than as a
 *   cryptic stack trace from the check's own process.
 *
 * A few rows were corrected by the hub's own first run rather than assumed up
 * front: `acceptance-browser-crash.cjs` and `acceptance-vision.cjs` require the
 * **electron** binary (they `require("electron")`), and the UIA/structured
 * checks need a real desktop. Getting that wrong produced four FAILs that were
 * really missing prerequisites — exactly the confusion this catalog exists to
 * prevent.
 */

export interface HostProbes {
  /** `node_modules/electron/dist/electron.exe` exists. */
  electronBinary: boolean;
  /** A Codex CLI (`codex`) is reachable on PATH or via a known install. */
  codexCli: boolean;
  /** Outbound HTTPS to a public endpoint succeeded within the probe budget. */
  network: boolean;
  /** The compiled output the acceptance scripts load (`dist-electron/electron/store.js`). */
  buildOutput: boolean;
  /** A repo path exists — used for the declared entry points. */
  pathExists: (relative: string) => boolean;
}

const MIN = 60_000;

export function electronBinaryRelative(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "node_modules/electron/dist/electron.exe" : "node_modules/electron/dist/electron";
}

export function acceptanceCatalog(): AcceptanceCheck[] {
  return [
    // ---- build gates -------------------------------------------------------
    {
      id: "gate:typecheck",
      label: "typecheck (renderer/shared)",
      device: "command",
      argv: ["npx", "tsc", "--noEmit", "-p", "tsconfig.json"],
      entryPoint: "tsconfig.json",
      requires: "offline",
      expectation: "The renderer/shared TypeScript project compiles with no diagnostics.",
      timeoutMs: 10 * MIN,
      program: "build"
    },
    {
      id: "gate:typecheck-electron",
      label: "typecheck (electron)",
      device: "command",
      argv: ["npx", "tsc", "--noEmit", "-p", "tsconfig.electron.json"],
      entryPoint: "tsconfig.electron.json",
      requires: "offline",
      expectation: "The electron TypeScript project compiles with no diagnostics.",
      timeoutMs: 10 * MIN,
      program: "build"
    },
    {
      id: "gate:test-suite",
      label: "unit/acceptance suite (vitest)",
      device: "command",
      argv: ["npx", "vitest", "run", "--reporter=dot"],
      entryPoint: "vitest.config.mjs",
      requires: "offline",
      expectation: "Every test file passes; a non-zero exit or a reported failure fails this check.",
      timeoutMs: 20 * MIN,
      program: "build"
    },
    {
      id: "gate:build",
      label: "renderer build (vite)",
      device: "command",
      argv: ["npx", "vite", "build"],
      entryPoint: "vite.config.mjs",
      requires: "offline",
      expectation: "The renderer bundle builds, so the shipped Web entry is not stale.",
      timeoutMs: 20 * MIN,
      program: "build"
    },
    {
      id: "gate:build-electron",
      label: "electron emit (tsc)",
      device: "command",
      argv: ["npx", "tsc", "-p", "tsconfig.electron.json"],
      entryPoint: "tsconfig.electron.json",
      requires: "offline",
      expectation: "Every script-driven check loads fresh dist-electron output rather than stale JS.",
      timeoutMs: 10 * MIN,
      program: "build"
    },

    // ---- legacy acceptance entry points ------------------------------------
    {
      id: "legacy:v1-audit",
      label: "v1 acceptance manifest audit",
      device: "script",
      argv: ["node", "scripts/acceptance-v1-audit.cjs"],
      entryPoint: "artifacts/v1-acceptance-manifest.json",
      requires: "offline",
      expectation: "The v1 acceptance manifest audit completes.",
      timeoutMs: 5 * MIN,
      program: "legacy",
      enabledByDefault: false,
      optIn: "--extended, and only once artifacts/v1-acceptance-manifest.json exists (it is absent on this branch)"
    },
    {
      id: "legacy:recovery",
      label: "recovery acceptance (api + cli lanes)",
      device: "script",
      argv: ["node", "scripts/acceptance-recovery.cjs"],
      entryPoint: "scripts/acceptance-recovery.cjs",
      requires: "external-cli",
      expectation: "Supervisor/RecoveryScheduler/ledger recovery behaves on both lanes.",
      timeoutMs: 20 * MIN,
      program: "legacy"
    },
    {
      id: "legacy:resource",
      label: "live provider resource comparison",
      device: "script",
      argv: ["node", "scripts/acceptance-resource.cjs"],
      entryPoint: "scripts/acceptance-resource.cjs",
      requires: "external-cli",
      expectation: "The optimized path uses fewer model calls than the naive path on a like-for-like task.",
      timeoutMs: 20 * MIN,
      program: "legacy"
    },
    {
      id: "legacy:engineering",
      label: "live CLI engineering end-to-end",
      device: "script",
      argv: ["node", "scripts/acceptance-engineering.cjs"],
      entryPoint: "scripts/acceptance-engineering.cjs",
      requires: "external-cli",
      expectation: "A real engineering task refactors the fixture and its own test then passes.",
      timeoutMs: 30 * MIN,
      program: "legacy"
    },
    {
      id: "legacy:finalization",
      label: "task finalization acceptance",
      device: "script",
      argv: ["node", "scripts/acceptance-finalization.cjs"],
      entryPoint: "scripts/acceptance-finalization.cjs",
      requires: "external-cli",
      expectation: "Finalization produces a validated final response for the task.",
      timeoutMs: 30 * MIN,
      program: "legacy"
    },
    {
      id: "legacy:structured",
      label: "controlled structured (UIA/VS Code) acceptance",
      device: "script",
      argv: ["node", "scripts/acceptance-structured.cjs"],
      entryPoint: "scripts/acceptance-structured.cjs",
      requires: "external-cli",
      expectation: "The structured desktop path drives a real VS Code window through the UIA backend.",
      timeoutMs: 20 * MIN,
      program: "legacy"
    },
    {
      id: "legacy:uia",
      label: "controlled native UIA fixture",
      device: "script",
      argv: ["node", "scripts/acceptance-uia.cjs"],
      entryPoint: "scripts/acceptance-uia.cjs",
      requires: "windows-desktop",
      expectation: "The Windows UIA backend drives a local PowerShell/WPF fixture end-to-end.",
      timeoutMs: 10 * MIN,
      program: "legacy"
    },
    {
      id: "legacy:restart",
      label: "Boss restart durability (real Electron restart)",
      device: "script",
      argv: ["node", "scripts/acceptance-restart.cjs"],
      entryPoint: "scripts/acceptance-restart.cjs",
      requires: "electron-gui",
      expectation: "State survives a real process restart in both restart phases.",
      timeoutMs: 15 * MIN,
      program: "legacy"
    },
    {
      id: "legacy:browser-crash",
      label: "controlled Electron browser crash recovery",
      device: "script",
      // Runs under the electron binary: the script does `require("electron")`.
      argv: [electronBinaryRelative(), "--session-expiry", "--network-outage", "scripts/acceptance-browser-crash.cjs"],
      entryPoint: "scripts/acceptance-browser-crash.cjs",
      requires: "browser",
      expectation: "A killed provider view is detected and recovered without losing the task, in both injected modes.",
      timeoutMs: 20 * MIN,
      program: "legacy"
    },
    {
      id: "legacy:vision",
      label: "provider vision surface (live Electron)",
      device: "script",
      argv: [electronBinaryRelative(), "scripts/acceptance-vision.cjs"],
      entryPoint: "scripts/acceptance-vision.cjs",
      requires: "browser",
      expectation: "The vision surface observes a real provider page and the OCR fallback path.",
      timeoutMs: 20 * MIN,
      program: "legacy",
      enabledByDefault: false,
      optIn: "--extended (opens real provider pages and captures screenshots)"
    },
    {
      id: "legacy:seeded-engineering",
      label: "seeded engineering acceptance (24 bug classes)",
      device: "script",
      argv: ["node", "scripts/acceptance-seeded-engineering.cjs", "AB"],
      entryPoint: "scripts/acceptance-seeded-engineering.cjs",
      requires: "offline",
      expectation: "Each seeded bug class is found and fixed in a real clone with a real install and test run.",
      timeoutMs: 120 * MIN,
      program: "legacy",
      enabledByDefault: false,
      optIn: "--extended (clones, installs and runs a full suite per bug class; ~3 min each)"
    },

    // ---- closure program ---------------------------------------------------
    {
      id: "closure:acceptance-report",
      label: "manifest-driven closure acceptance report",
      device: "script",
      argv: ["node", "scripts/closure-acceptance-report.mjs"],
      entryPoint: "scripts/closure-acceptance-report.mjs",
      requires: "offline",
      expectation: "The closure manifest still resolves to a legal terminal status, and the report regenerates identically.",
      timeoutMs: 5 * MIN,
      program: "closure"
    },
    {
      id: "closure:soak-2h",
      label: "R-901 continuous 2h autonomous soak",
      device: "script",
      argv: ["node", "scripts/closure-soak-2h.cjs"],
      entryPoint: "scripts/closure-soak-2h.cjs",
      requires: "offline",
      expectation: "Two continuous hours of autonomous flow hold every recorded invariant.",
      timeoutMs: 150 * MIN,
      program: "closure",
      enabledByDefault: false,
      optIn: "--soak (2h of continuous runtime; see the bounded P3 tiers for routine runs)"
    },

    // ---- 10.x / research / engine programs ---------------------------------
    {
      id: "tenx:research-offline",
      label: "offline full-chain research acceptance",
      device: "script",
      argv: ["node", "scripts/acceptance-research-offline.cjs"],
      entryPoint: "scripts/acceptance-research-offline.cjs",
      requires: "offline",
      expectation: "Real experiment processes plus deterministic host stages produce the research artifact tree.",
      timeoutMs: 30 * MIN,
      program: "tenx"
    },
    {
      id: "tenx:benchmark",
      label: "durable ledger recovery benchmark",
      device: "script",
      argv: ["node", "scripts/benchmark.cjs"],
      entryPoint: "scripts/benchmark.cjs",
      requires: "offline",
      expectation: "Ledger recovery reproduces independently-reconstructed state.",
      timeoutMs: 10 * MIN,
      program: "tenx"
    },
    {
      id: "engine:acceptance-battery",
      label: "adaptive engine acceptance battery (A01–A50)",
      device: "command",
      argv: ["npx", "vitest", "run", "tests/unit/engine-acceptance.test.ts", "--reporter=dot"],
      entryPoint: "tests/unit/engine-acceptance.test.ts",
      requires: "offline",
      expectation: "The engine acceptance battery passes with every adaptive flag at its documented default.",
      timeoutMs: 10 * MIN,
      program: "engine"
    },
    {
      id: "engine:flags-all-off",
      label: "adaptive flags default OFF (kill switch)",
      device: "command",
      argv: ["npx", "vitest", "run", "tests/unit/engine-phase-0.test.ts", "--reporter=dot"],
      entryPoint: "tests/unit/engine-phase-0.test.ts",
      requires: "offline",
      expectation: "The deterministic baseline oracle still holds and every flag defaults off.",
      timeoutMs: 10 * MIN,
      program: "engine"
    },

    // ---- host program (this taskbook) --------------------------------------
    // These load the Host-M CLI modules, so they are selected once those exist.
    // A missing module is BLOCKED_EXTERNAL on the declared entry point, which is
    // how the hub reports its own construction progress honestly.
    {
      id: "host:doctor",
      label: "Boss Doctor preflight (fault-isolated)",
      device: "command",
      argv: ["node", "scripts/host-doctor.cjs", "--json"],
      entryPoint: "scripts/host-doctor.cjs",
      requires: "offline",
      expectation: "Every doctor probe reports independently; doctor failure never fails Boss.",
      timeoutMs: 10 * MIN,
      program: "host",
      enabledByDefault: false,
      optIn: "--all (P7 entry point)"
    },
    {
      id: "host:fault-lab",
      label: "failure injection lab (isolated injectors)",
      device: "command",
      argv: ["node", "scripts/host-fault-lab.cjs", "--json"],
      entryPoint: "scripts/host-fault-lab.cjs",
      requires: "offline",
      expectation: "Every declared fault injects deterministically, is detected, and leaves the system usable.",
      timeoutMs: 15 * MIN,
      program: "host",
      enabledByDefault: false,
      optIn: "--all (P2 entry point)"
    },
    {
      id: "host:observability",
      label: "unified observer snapshot (read-only aggregate)",
      device: "command",
      argv: ["node", "scripts/host-observe.cjs", "--json"],
      entryPoint: "scripts/host-observe.cjs",
      requires: "offline",
      expectation: "The observer aggregates every declared domain and never mutates what it reads.",
      timeoutMs: 10 * MIN,
      program: "host",
      enabledByDefault: false,
      optIn: "--all (P4 entry point)"
    },
    {
      id: "host:evidence-inspector",
      label: "evidence/artifact inspector (checksum + provenance)",
      device: "command",
      argv: ["node", "scripts/host-evidence.cjs", "--json"],
      entryPoint: "scripts/host-evidence.cjs",
      requires: "offline",
      expectation: "Declared evidence resolves with valid checksums, or the gaps are reported as orphans without touching the artifacts.",
      timeoutMs: 10 * MIN,
      program: "host",
      enabledByDefault: false,
      optIn: "--all (P5 entry point)"
    },
    {
      id: "host:regression-sentinel",
      label: "regression sentinel (baseline → candidate)",
      device: "command",
      argv: ["node", "scripts/host-regression.cjs", "--json"],
      entryPoint: "scripts/host-regression.cjs",
      requires: "offline",
      expectation: "The sentinel reports drift against the recorded baseline without modifying production code.",
      timeoutMs: 10 * MIN,
      program: "host",
      enabledByDefault: false,
      optIn: "--all (P6 entry point)"
    },
    {
      id: "host:soak-30m",
      label: "bounded 30-minute soak",
      device: "command",
      argv: ["node", "scripts/host-soak.cjs", "--tier", "30m", "--json"],
      entryPoint: "scripts/host-soak.cjs",
      requires: "offline",
      expectation: "A continuous 30-minute run records memory/CPU/handles/queue/restart samples with no invariant breach.",
      timeoutMs: 45 * MIN,
      program: "host",
      enabledByDefault: false,
      optIn: "--soak (P3, continuous 30 minutes of real runtime)"
    }
  ];
}

/** Default scope: the bounded, safe `one command` set. */
export function defaultChecks(checks: readonly AcceptanceCheck[], extended: boolean): AcceptanceCheck[] {
  return checks.filter((check) => extended || check.enabledByDefault !== false);
}

/** Checks whose declared input does not exist on this host. */
export function missingEntryPoints(checks: readonly AcceptanceCheck[], probes: HostProbes): Map<string, string> {
  const missing = new Map<string, string>();
  for (const check of checks) {
    if (!check.entryPoint) continue;
    // The electron binary is a generated dependency, not a repo file.
    if (check.entryPoint.startsWith("node_modules/")) continue;
    if (!probes.pathExists(check.entryPoint)) missing.set(check.id, check.entryPoint);
  }
  return missing;
}

/**
 * A check that cannot run here is reported as BLOCKED_EXTERNAL with the missing
 * prerequisite named — never as a pass, and never silently dropped.
 *
 * Order matters: the declared entry point and the emitted build are checked
 * before the external requirement, because "the script is not here" and "the
 * tool is not here" are different problems and a caller should see the one that
 * actually stops the check first.
 */
export function preflightBlock(
  check: AcceptanceCheck,
  probes: HostProbes,
  at?: string
): AcceptanceCheckResult | undefined {
  if (check.entryPoint && !check.entryPoint.startsWith("node_modules/") && !probes.pathExists(check.entryPoint)) {
    return blockedAt(check, `declared entry point ${check.entryPoint} does not exist`, at);
  }
  if (check.device === "script" && !probes.buildOutput) {
    return blockedAt(check, "dist-electron is missing; run the build gate first", at);
  }
  if (check.argv[0].includes("electron")) {
    if (!probes.electronBinary) return blockedAt(check, "node_modules/electron is not installed", at);
    if (check.requires === "browser" && !probes.network) {
      return blockedAt(check, "no outbound network for provider pages", at);
    }
    return undefined;
  }
  if (check.requires === "offline") return undefined;
  if (check.requires === "external-cli" && !probes.codexCli) {
    return blockedAt(check, "no codex CLI on PATH", at);
  }
  if (check.requires === "electron-gui" && !probes.electronBinary) {
    return blockedAt(check, "node_modules/electron is not installed", at);
  }
  if (check.requires === "browser") {
    if (!probes.electronBinary) return blockedAt(check, "node_modules/electron is not installed", at);
    if (!probes.network) return blockedAt(check, "no outbound network for provider pages", at);
  }
  if (check.requires === "network" && !probes.network) {
    return blockedAt(check, "no outbound network", at);
  }
  return undefined;
}

function blockedAt(check: AcceptanceCheck, detail: string, at?: string): AcceptanceCheckResult {
  const stamp = at ?? new Date(0).toISOString();
  return {
    id: check.id,
    label: check.label,
    program: check.program,
    device: check.device,
    requires: check.requires,
    status: "BLOCKED_EXTERNAL",
    reason: blockedReason(check.requires, detail),
    durationMs: 0,
    startedAt: stamp,
    finishedAt: stamp
  };
}
