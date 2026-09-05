import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HARDENING_SCENARIOS, inProcessScenarioIds, summarizeHardening } from "../src/shared/hardening-matrix";
import { runHardeningMatrix, loadHardeningReport } from "../electron/hardening/hardening-runner";
import { changeAllowed } from "../src/shared/guardian";
import { redactSecrets } from "../src/shared/secret-scan";
import { compatibilityIssue } from "../src/shared/compatibility";
import { SoftwareLeaseRegistry } from "../electron/computer/software-lease";
import { CircuitBreaker } from "../electron/commander/circuit-breaker";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-hardening-")); dirs.push(dir); return dir; }

describe("hardening matrix vocabulary (AP30)", () => {
  it("registers the full §30 scenario list with explicit coverage", () => {
    expect(HARDENING_SCENARIOS.length).toBeGreaterThanOrEqual(24);
    expect(HARDENING_SCENARIOS.some((item) => item.id === "provider-outage")).toBe(true);
    expect(HARDENING_SCENARIOS.some((item) => item.id === "secret-tainted-log")).toBe(true);
    expect(HARDENING_SCENARIOS.some((item) => item.id === "guardian-denial")).toBe(true);
    // Live-only scenarios declare why they are not run in CI.
    for (const live of HARDENING_SCENARIOS.filter((item) => item.coverage === "live")) expect(live.reason?.length).toBeGreaterThan(0);
  });

  it("summarizes results and reports unexercised rows as NOT_RUN", () => {
    const report = summarizeHardening({ results: { "provider-outage": "PASS", "guardian-denial": "PASS" }, generatedAt: "2026-09-06T00:00:00.000Z" });
    expect(report.schemaVersion).toBe(1);
    expect(report.summary.pass).toBe(2);
    expect(report.summary.notRun).toBe(report.rows.length - 2);
    expect(report.rows.find((row) => row.scenario.id === "blender-crash")?.result).toBe("NOT_RUN");
  });
});

describe("hardening runner (AP30 in-process probes)", () => {
  it("passes concrete fail-closed probes and persists an evidence report", async () => {
    const file = path.join(root(), "hardening.json");
    const report = await runHardeningMatrix({
      "guardian-denial": () => !changeAllowed("promotion.gate", false, "test").allowed && changeAllowed("ui", false, "test").allowed,
      "secret-tainted-log": () => !redactSecrets("key=sk-abcdefghijklmnopqrstuvwxyz123456").includes("sk-abcdefghijklmnopqrstuvwxyz123456"),
      "adapter-version-mismatch": () => compatibilityIssue({ id: "web:x", kind: "web", windows: { core_api: { min: "9", max: "9" } } }) !== null,
      "lease-conflict": async () => {
        const leases = new SoftwareLeaseRegistry();
        leases.acquire({ owner_task: "a", target: "blender", mode: "exclusive" });
        try { leases.acquire({ owner_task: "b", target: "blender", mode: "exclusive" }); return false; }
        catch { return true; }
      },
      "provider-outage": async () => {
        const breaker = new CircuitBreaker();
        for (let index = 0; index < 6; index++) breaker.observeFailure("api:x");
        return breaker.state("api:x") === "OPEN";
      }
    }, file);
    expect(report.summary.pass).toBe(5);
    expect(report.summary.fail).toBe(0);
    const loaded = loadHardeningReport(file);
    expect(loaded.summary.pass).toBe(5);
    expect(loaded.rows.filter((row) => row.result === "PASS").length).toBe(5);
    // Live-only rows remain NOT_RUN with a documented reason.
    expect(loaded.rows.find((row) => row.scenario.id === "long-running-soak")?.result).toBe("NOT_RUN");
  });

  it("keeps in-process ids to the deterministic subset", () => {
    const ids = inProcessScenarioIds();
    expect(ids.length).toBe(HARDENING_SCENARIOS.length - HARDENING_SCENARIOS.filter((item) => item.coverage === "live").length);
    expect(ids).not.toContain("blender-crash");
  });
});
