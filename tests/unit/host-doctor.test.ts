import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DOCTOR_AREAS,
  DOCTOR_STATUSES,
  buildDoctorReport,
  doctorVerdict,
  emptyDoctorSummary,
  isBlockingArea,
  renderDoctorReport,
  runProbe,
  skippedCheck,
  summarizeDoctor,
  type DoctorCheck
} from "../../src/shared/doctor";
import { doctorConcernCount, doctorRevision, runDoctor } from "../../electron/host/doctor";

const AT = "2026-09-10T00:00:00.000Z";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-doctor-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function check(overrides: Partial<DoctorCheck> = {}): DoctorCheck {
  return {
    id: "runtime.node",
    area: "runtime",
    label: "node runtime",
    observed: "v24",
    expected: ">= v18",
    status: "READY",
    durationMs: 1,
    ...overrides
  };
}

/** A minimal but complete checkout, so real probes have something to inspect. */
function fakeCheckout(): string {
  const root = path.join(dir, "checkout");
  fs.mkdirSync(path.join(root, "src", "shared"), { recursive: true });
  fs.mkdirSync(path.join(root, "electron"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  for (const name of ["electron", "react", "react-dom", "typescript", "vitest"]) {
    fs.mkdirSync(path.join(root, "node_modules", name), { recursive: true });
  }
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ main: "dist-electron/electron/main.js", dependencies: { electron: "latest" } }), "utf8");
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}", "utf8");
  fs.writeFileSync(path.join(root, "tsconfig.electron.json"), JSON.stringify({ compilerOptions: { outDir: "dist-electron" } }), "utf8");
  fs.writeFileSync(path.join(root, "src", "shared", "thing.ts"), "export const x = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "electron", "main.ts"), "ipcMain.handle('boss:snapshot', () => {});\n", "utf8");
  fs.writeFileSync(path.join(root, "electron", "preload.ts"), "const bridge: BossBridge = {} as BossBridge;\ncontextBridge.exposeInMainWorld('boss', bridge);\n", "utf8");
  fs.mkdirSync(path.join(root, "dist-electron", "electron"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist-electron", "electron", "main.js"), "// compiled\n", "utf8");
  fs.writeFileSync(path.join(root, "dist-electron", "electron", "store.js"), "// compiled\n", "utf8");
  return root;
}

describe("doctor contract (P7)", () => {
  it("declares the areas the plan names", () => {
    expect([...DOCTOR_AREAS]).toEqual([
      "runtime",
      "dependency",
      "filesystem",
      "browser",
      "network",
      "account",
      "ipc",
      "fleet",
      "knowledge",
      "learning",
      "compatibility"
    ]);
    expect([...DOCTOR_STATUSES]).toEqual(["READY", "DEGRADED", "FAIL", "SKIPPED"]);
  });

  it("has no stop verdict, because the doctor must never gate startup", () => {
    const verdict = doctorVerdict([check({ status: "FAIL", reason: "boom" })]);
    expect(["READY", "DEGRADED", "BLOCKED"]).toContain(verdict.overall);
    expect(verdict.overall).not.toBe("STOP");
  });

  it("summarizes every status exactly once", () => {
    const summary = summarizeDoctor([
      check({ status: "READY" }),
      check({ id: "b", status: "DEGRADED" }),
      check({ id: "c", status: "FAIL" }),
      check({ id: "d", status: "SKIPPED" })
    ]);
    expect(summary).toEqual({ ready: 1, degraded: 1, fail: 1, skipped: 1, total: 4 });
    expect(emptyDoctorSummary().total).toBe(0);
  });

  it("does not block on a skipped check, however many there are", () => {
    const verdict = doctorVerdict([check({ status: "SKIPPED", reason: "no evidence" }), check({ id: "b", status: "SKIPPED", reason: "no evidence" })]);
    expect(verdict.overall).toBe("READY");
    expect(verdict.reason).toContain("2 check(s) skipped");
  });

  it("blocks only on a failure in a dimension Boss cannot run without", () => {
    expect(doctorVerdict([check({ area: "runtime", status: "FAIL", reason: "no node" })]).overall).toBe("BLOCKED");
    expect(doctorVerdict([check({ area: "filesystem", status: "FAIL", reason: "no disk" })]).overall).toBe("BLOCKED");
    expect(doctorVerdict([check({ area: "dependency", status: "FAIL", reason: "no modules" })]).overall).toBe("BLOCKED");
    // A broken optional area degrades but does not block.
    expect(doctorVerdict([check({ area: "learning", status: "FAIL", reason: "corrupt" })]).overall).toBe("DEGRADED");
    expect(doctorVerdict([check({ area: "browser", status: "FAIL", reason: "no electron" })]).overall).toBe("DEGRADED");
  });

  it("reports blocking areas by name", () => {
    expect(isBlockingArea("runtime")).toBe(true);
    expect(isBlockingArea("filesystem")).toBe(true);
    expect(isBlockingArea("dependency")).toBe(true);
    expect(isBlockingArea("ipc")).toBe(false);
    expect(isBlockingArea("fleet")).toBe(false);
  });

  it("names the failing checks in the verdict reason", () => {
    const verdict = doctorVerdict([check({ area: "runtime", status: "FAIL", reason: "node is too old" })]);
    expect(verdict.reason).toContain("runtime.node");
    expect(verdict.reason).toContain("node is too old");
  });

  it("never throws for a failing probe, and reports the probe itself as the failure", () => {
    const result = runProbe(
      () => {
        throw new Error("probe exploded");
      },
      {
        id: "x.probe",
        area: "runtime",
        label: "fake",
        expected: "a value",
        classify: () => ({ status: "READY" })
      }
    );
    expect(result.status).toBe("FAIL");
    expect(result.reason).toContain("probe exploded");
    expect(result.observed).toContain("probe threw");
  });

  it("keeps a probe's own verdict and drops the remedy when it is READY", () => {
    const ready = runProbe(() => 1, {
      id: "x.probe",
      area: "runtime",
      label: "fake",
      expected: "1",
      remedy: "do nothing",
      classify: (value) => ({ status: value === 1 ? "READY" : "FAIL", observed: `${value}` })
    });
    expect(ready.status).toBe("READY");
    expect(ready.remedy).toBeUndefined();
    expect(ready.reason).toBeUndefined();
  });

  it("records a skipped check with its reason and no fake observation", () => {
    const skipped = skippedCheck({ id: "x", area: "network", label: "network", expected: "reachable", reason: "skipped for this run" });
    expect(skipped.status).toBe("SKIPPED");
    expect(skipped.observed).toBe("not evaluated");
    expect(skipped.reason).toBe("skipped for this run");
  });

  it("carries a doctor-level failure in the report without losing the checks", () => {
    const report = buildDoctorReport({
      repoRoot: "/repo",
      dataRoot: "/data",
      checks: [check()],
      generatedAt: AT,
      doctorFailure: "the fleet area threw"
    });
    expect(report.overall).toBe("READY");
    expect(report.doctorFailure).toBe("the fleet area threw");
    expect(report.checks).toHaveLength(1);
  });

  it("renders every non-ready check with its reason and remedy", () => {
    const report = buildDoctorReport({
      repoRoot: "/repo",
      dataRoot: "/data",
      checks: [
        check(),
        check({ id: "learning.flag-store", area: "learning", status: "DEGRADED", reason: "corrupt flag file", remedy: "delete it" })
      ],
      generatedAt: AT
    });
    const text = renderDoctorReport(report);
    expect(text).toContain("DEGRADED");
    expect(text).toContain("corrupt flag file");
    expect(text).toContain("learning.flag-store: delete it");
  });
});

describe("doctor probes against a real checkout (P7)", () => {
  it("reports READY for a complete checkout with a real data root", async () => {
    const repoRoot = fakeCheckout();
    const dataRoot = path.join(dir, "data");
    fs.mkdirSync(dataRoot, { recursive: true });
    const report = await runDoctor({ repoRoot, dataRoot, skipNetwork: true, now: () => AT });

    expect(report.kind).toBe("HOST_DOCTOR");
    expect(report.checks.length).toBeGreaterThanOrEqual(20);
    expect(report.summary.fail).toBe(0);
    // The areas that must be ready on any working checkout.
    for (const id of ["runtime.node", "runtime.checkout", "dependency.installed", "dependency.manifest", "filesystem.temp-writable", "ipc.surface", "compatibility.tsconfig"]) {
      const found = report.checks.find((entry) => entry.id === id)!;
      expect(found, `${id} should have run`).toBeDefined();
      expect(found.status, `${id}: ${found.reason ?? ""}`).toBe("READY");
    }
  }, 60_000);

  it("skips the network probe when asked, instead of reporting it as healthy", async () => {
    const repoRoot = fakeCheckout();
    const report = await runDoctor({ repoRoot, dataRoot: path.join(dir, "data"), skipNetwork: true, now: () => AT });
    const network = report.checks.find((entry) => entry.id === "network.egress")!;
    expect(network.status).toBe("SKIPPED");
    expect(network.reason).toContain("skipped");
  }, 60_000);

  it("reports a missing dependency as a blocking failure", async () => {
    const repoRoot = fakeCheckout();
    fs.rmSync(path.join(repoRoot, "node_modules", "electron"), { recursive: true, force: true });
    const report = await runDoctor({ repoRoot, dataRoot: path.join(dir, "data"), skipNetwork: true, now: () => AT });
    const installed = report.checks.find((entry) => entry.id === "dependency.installed")!;
    expect(installed.status).toBe("FAIL");
    expect(report.overall).toBe("BLOCKED");
    expect(installed.remedy).toBeTruthy();
  }, 60_000);

  it("isolates a corrupt store to its own check", async () => {
    const repoRoot = fakeCheckout();
    const dataRoot = path.join(dir, "data");
    fs.mkdirSync(path.join(dataRoot, ".boss", "learning"), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, ".boss", "learning", "adaptive-flags.json"), "{ not json", "utf8");
    fs.writeFileSync(path.join(dataRoot, ".boss", "learning", "episodes.jsonl"), '{"ok":1}\nnot-json\n', "utf8");

    const report = await runDoctor({ repoRoot, dataRoot, skipNetwork: true, now: () => AT });
    const flags = report.checks.find((entry) => entry.id === "learning.flag-store")!;
    expect(flags.status).toBe("DEGRADED");
    expect(flags.reason).toContain("fail");
    // The episode store is still reported on its own merits.
    const episodes = report.checks.find((entry) => entry.id === "learning.episode-store")!;
    expect(episodes.status).toBe("DEGRADED");
    expect(episodes.observed).toContain("1 unreadable");
    // And the healthy checks are untouched.
    expect(report.checks.find((entry) => entry.id === "runtime.node")!.status).toBe("READY");
    expect(report.overall).toBe("DEGRADED");
  }, 60_000);

  it("reports a corrupt node registry as a failure without touching it", async () => {
    const repoRoot = fakeCheckout();
    const dataRoot = path.join(dir, "data");
    fs.mkdirSync(path.join(dataRoot, ".boss"), { recursive: true });
    const registry = path.join(dataRoot, ".boss", "node-registry.json");
    fs.writeFileSync(registry, JSON.stringify({ schemaVersion: 2, records: [] }), "utf8");
    const before = fs.readFileSync(registry, "utf8");

    const report = await runDoctor({ repoRoot, dataRoot, skipNetwork: true, now: () => AT });
    const node = report.checks.find((entry) => entry.id === "fleet.node-registry")!;
    expect(node.status).toBe("FAIL");
    expect(node.reason).toContain("schema");
    expect(fs.readFileSync(registry, "utf8")).toBe(before);
  }, 60_000);

  it("flags stale compiled output as degraded so scripts are not testing stale code", async () => {
    const repoRoot = fakeCheckout();
    // Age every compiled artifact so the newest output predates the sources.
    const compiledDir = path.join(repoRoot, "dist-electron", "electron");
    const old = new Date(Date.now() - 600_000);
    for (const name of fs.readdirSync(compiledDir)) fs.utimesSync(path.join(compiledDir, name), old, old);
    fs.writeFileSync(path.join(repoRoot, "electron", "main.ts"), "ipcMain.handle('x', () => {});\n", "utf8");

    const report = await runDoctor({ repoRoot, dataRoot: path.join(dir, "data"), skipNetwork: true, now: () => AT });
    const freshness = report.checks.find((entry) => entry.id === "compatibility.build-freshness")!;
    expect(freshness.status).toBe("DEGRADED");
    expect(freshness.remedy).toContain("tsc");
  }, 60_000);

  it("reports fresh compiled output as ready", async () => {
    const repoRoot = fakeCheckout();
    const fresh = new Date(Date.now() + 60_000);
    for (const name of fs.readdirSync(path.join(repoRoot, "dist-electron", "electron"))) {
      fs.utimesSync(path.join(repoRoot, "dist-electron", "electron", name), fresh, fresh);
    }
    const report = await runDoctor({ repoRoot, dataRoot: path.join(dir, "data"), skipNetwork: true, now: () => AT });
    expect(report.checks.find((entry) => entry.id === "compatibility.build-freshness")!.status).toBe("READY");
  }, 60_000);

  it("cleans up the write probe and never writes into the data root", async () => {
    const repoRoot = fakeCheckout();
    const dataRoot = path.join(dir, "data");
    fs.mkdirSync(dataRoot, { recursive: true });
    const before = fs.readdirSync(dataRoot).sort();
    await runDoctor({ repoRoot, dataRoot, skipNetwork: true, now: () => AT });
    expect(fs.readdirSync(dataRoot).sort()).toEqual(before);
    // Nothing named after the doctor's probe survives in the temp directory.
    const leftovers = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(`boss-doctor-${process.pid}-`));
    expect(leftovers).toEqual([]);
  }, 60_000);

  it("never throws even when the checkout is nonsense", async () => {
    const empty = path.join(dir, "empty");
    fs.mkdirSync(empty, { recursive: true });
    const report = await runDoctor({ repoRoot: empty, dataRoot: path.join(dir, "no-data"), skipNetwork: true, now: () => AT });
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.overall).toBe("BLOCKED");
    // Every check still reports, so the operator can see what failed.
    for (const entry of report.checks) expect(entry.observed.length).toBeGreaterThan(0);
  }, 60_000);

  it("counts concerns for the CLI summary and resolves a revision", async () => {
    const repoRoot = fakeCheckout();
    const report = await runDoctor({ repoRoot, dataRoot: path.join(dir, "data"), skipNetwork: true, now: () => AT });
    expect(doctorConcernCount(report)).toBe(report.summary.degraded + report.summary.fail);
    // A non-git directory is reported as unknown rather than throwing.
    expect(doctorRevision(repoRoot)).toMatch(/unknown|[0-9a-f]{7,}/);
  }, 60_000);
});
