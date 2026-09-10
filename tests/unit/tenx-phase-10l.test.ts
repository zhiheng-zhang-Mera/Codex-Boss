/**
 * Phase 10L evidence test: network routing vNext.
 * Per-node states DIRECT/SYSTEM_PROXY/USER_PROXY/REGIONAL_PROXY/PROVIDER_PROXY/
 * OFFLINE; direct-first selection with fallback only when needed; different
 * nodes choose different paths concurrently; one node's failure never changes
 * another's route; durable restart.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { effectiveNetworkState, type RouteId } from "../../src/shared/tenx/network";
import { TenxNetworkRegistry, selectRoute } from "../../electron/tenx/network-registry";

const at = "2026-09-10T00:00:00.000Z";

describe("10L pure route selection", () => {
  it("picks DIRECT first when available", () => {
    expect(selectRoute({ direct: true, "user-proxy": true }, "n1").selected).toBe("DIRECT");
    expect(effectiveNetworkState({ direct: true })).toBe("DIRECT");
  });

  it("falls back through proxies only when direct is unavailable", () => {
    expect(selectRoute({ "user-proxy": true, "regional-proxy": true }, "n1").selected).toBe("USER_PROXY");
    expect(effectiveNetworkState({ "regional-proxy": true })).toBe("REGIONAL_PROXY");
    expect(selectRoute({ "provider-proxy": true }, "n1").selected).toBe("PROVIDER_PROXY");
  });

  it("OFFLINE only when no route works", () => {
    expect(selectRoute({}, "n1").selected).toBe("OFFLINE");
    expect(effectiveNetworkState({ direct: false, "user-proxy": false })).toBe("OFFLINE");
  });
});

describe("10L durable per-node registry", () => {
  it("keeps per-node states independent (Node A DIRECT, Node B PROXY, Node C OFFLINE)", () => {
    const registry = new TenxNetworkRegistry(undefined, () => at);
    registry.update("A", { direct: true });
    registry.update("B", { "user-proxy": true, "regional-proxy": true });
    registry.update("C", {});
    expect(registry.route("A").selected).toBe("DIRECT");
    expect(registry.route("B").selected).toBe("USER_PROXY");
    expect(registry.route("C").selected).toBe("OFFLINE");
    expect(registry.list().length).toBe(3);
  });

  it("a failing proxy on one node never changes another node's route", () => {
    const registry = new TenxNetworkRegistry(undefined, () => at);
    registry.update("A", { direct: true });
    registry.update("B", { "user-proxy": true });
    registry.update("B", { direct: false, "user-proxy": false }); // B's proxy dies
    expect(registry.route("A").selected).toBe("DIRECT");
    expect(registry.route("B").selected).toBe("OFFLINE");
  });

  it("route selection returns an explainable reason and available routes", () => {
    const selection = selectRoute({ direct: true }, "n1");
    expect(selection.availableRoutes).toContain("direct" satisfies RouteId);
    expect(selection.reason).toContain("DIRECT");
  });

  it("durable restart restores reports", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10l-"));
    const file = path.join(dir, "network.json");
    try {
      const first = new TenxNetworkRegistry(file, () => at);
      first.update("A", { direct: true, "provider-proxy": true });
      const second = new TenxNetworkRegistry(file, () => at);
      expect(second.route("A").selected).toBe("DIRECT");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
