/**
 * Phase 10M evidence test: provider reachability matrix.
 * Per-node matrix rows (reachable/authenticated/latency/regionBlocked/
 * rateLimited/proxyRequired/lastSuccess/lastFailure); observations-only (a
 * failure never fabricates success); readyProviders feeds scheduler; nodes
 * isolated; durable restart.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TenxProviderMatrixStore } from "../../electron/tenx/provider-matrix";

const at = "2026-09-10T00:00:00.000Z";

describe("10M provider reachability matrix", () => {
  it("records full matrix row fields per provider", () => {
    const store = new TenxProviderMatrixStore(undefined, () => at);
    store.observe("node-a", { provider: "p1", reachable: true, authenticated: true, latencyMs: 120 });
    const matrix = store.matrix("node-a")!;
    expect(matrix.rows.length).toBe(1);
    expect(matrix.rows[0]).toMatchObject({ provider: "p1", reachable: true, authenticated: true, latencyMs: 120, regionBlocked: false, rateLimited: false });
    expect(matrix.rows[0].lastSuccessAt).toBe(at);
    expect(matrix.rows[0].lastFailureAt).toBeUndefined();
  });

  it("a failed probe records lastFailure without fabricating success", () => {
    const store = new TenxProviderMatrixStore(undefined, () => at);
    store.observe("node-a", { provider: "p1", reachable: true, authenticated: true });
    store.observe("node-a", { provider: "p1", error: "connection timeout" });
    const row = store.matrix("node-a")!.rows[0];
    expect(row.lastFailureAt).toBe(at);
    expect(row.lastFailureReason).toBe("connection timeout");
    expect(row.lastSuccessAt).toBe(at); // history of last success retained
  });

  it("readyProviders only returns reachable + authenticated + not blocked/limited", () => {
    const store = new TenxProviderMatrixStore(undefined, () => at);
    store.observe("node-a", { provider: "p-ok", reachable: true, authenticated: true });
    store.observe("node-a", { provider: "p-blocked", reachable: true, authenticated: true, regionBlocked: true });
    store.observe("node-a", { provider: "p-limited", reachable: true, authenticated: true, rateLimited: true });
    store.observe("node-a", { provider: "p-unreachable", reachable: false, authenticated: false });
    expect(store.readyProviders("node-a")).toEqual(["p-ok"]);
  });

  it("nodes are isolated: node-a's blocked provider never touches node-b", () => {
    const store = new TenxProviderMatrixStore(undefined, () => at);
    store.observe("node-a", { provider: "p1", reachable: true, authenticated: true });
    store.observe("node-b", { provider: "p1", reachable: true, authenticated: true, regionBlocked: true });
    expect(store.readyProviders("node-a")).toEqual(["p1"]);
    expect(store.readyProviders("node-b")).toEqual([]);
  });

  it("forgetProvider removes a row for one node only", () => {
    const store = new TenxProviderMatrixStore(undefined, () => at);
    store.observe("node-a", { provider: "p1", reachable: true, authenticated: true });
    store.observe("node-b", { provider: "p1", reachable: true, authenticated: true });
    store.forgetProvider("node-a", "p1");
    expect(store.readyProviders("node-a")).toEqual([]);
    expect(store.readyProviders("node-b")).toEqual(["p1"]);
  });

  it("durable restart restores matrices", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10m-"));
    const file = path.join(dir, "matrix.json");
    try {
      const first = new TenxProviderMatrixStore(file, () => at);
      first.observe("node-a", { provider: "p1", reachable: true, authenticated: true });
      const second = new TenxProviderMatrixStore(file, () => at);
      expect(second.readyProviders("node-a")).toEqual(["p1"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
