import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { capabilityVerdicts, nodeStateFor, type NodeProbeData } from "../../src/shared/node-capabilities";
import { NodeCapabilityRegistry } from "../../electron/node/node-capability-registry";
import { inspectDevice } from "../../electron/node/node-inspector";

/**
 * R-302: device self-inspection + capability registry. Verdicts derive from
 * OBSERVED facts only (a logged-in web AI is never assumed); compute failure ⇒
 * FAILED, partial observability ⇒ DEGRADED; records are durable and isolated.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function file(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "node-caps-")); dirs.push(dir); return path.join(dir, "nodes.json"); }

function probe(overrides: Partial<NodeProbeData> = {}): NodeProbeData {
  return {
    nodeId: "desktop",
    os: { platform: "win32", arch: "x64", version: "10.0" },
    cpu: { cores: 8, model: "x", loadPercent: 10 },
    gpu: [{ name: "gpu" }],
    memory: { totalMb: 8192, freeMb: 4096 },
    runtimes: { node: "v24.0.0", browser: "chrome" },
    webLoggedInProviders: ["chatgpt"],
    nativeToolsAvailable: true,
    network: { directReachableProviders: ["chatgpt"], proxyCapable: true },
    currentTaskCount: 0,
    sampledAt: "2026-09-09T00:00:00.000Z",
    ...overrides
  };
}

it("web-ai READY only from observed logged-in providers — never assumed", () => {
  const ready = capabilityVerdicts(probe());
  expect(ready.find((item) => item.id === "web-ai")?.status).toBe("READY");
  expect(ready.find((item) => item.id === "web-ai")?.detail).toContain("chatgpt");
  const none = capabilityVerdicts(probe({ webLoggedInProviders: [] }));
  expect(none.find((item) => item.id === "web-ai")?.status).toBe("DEGRADED");
  expect(none.find((item) => item.id === "web-ai")?.detail).toContain("no logged-in");
});

it("compute failure ⇒ node FAILED; partial observability ⇒ DEGRADED; complete ⇒ READY", () => {
  expect(nodeStateFor(probe({ cpu: { cores: 0, model: undefined } }), capabilityVerdicts(probe({ cpu: { cores: 0, model: undefined } }))).state).toBe("FAILED");
  const degraded = nodeStateFor(probe({ webLoggedInProviders: [], runtimes: { node: "v24" } }), capabilityVerdicts(probe({ webLoggedInProviders: [], runtimes: { node: "v24" } })));
  expect(degraded.state).toBe("DEGRADED");
  expect(nodeStateFor(probe(), capabilityVerdicts(probe())).state).toBe("READY");
});

it("registry is durable, per-node isolated and fails closed on corruption", () => {
  const target = file();
  const registry = new NodeCapabilityRegistry(target);
  const refreshed = registry.refresh("desktop", probe({ webLoggedInProviders: ["chatgpt"] }));
  expect(refreshed.state).toBe("READY");
  const phone = registry.refresh("phone", probe({ nodeId: "phone", cpu: { cores: 0, model: undefined } }));
  expect(phone.state).toBe("FAILED");
  expect(registry.status("desktop")?.state).toBe("READY"); // isolation: phone failure never touches desktop
  expect(registry.status("phone")?.state).toBe("FAILED");

  const reopened = new NodeCapabilityRegistry(target);
  expect(reopened.status("desktop")?.state).toBe("READY");
  expect(reopened.status("desktop")?.verdicts.find((item) => item.id === "web-ai")?.status).toBe("READY");

  fs.writeFileSync(target, "{bad", "utf8");
  expect(() => new NodeCapabilityRegistry(target)).toThrow();
});

it("inspector builds a real probe (observed facts; overrides for determinism)", () => {
  const data = inspectDevice({ nodeId: "desktop", loggedInProviderIds: ["chatgpt", "deepseek"], browserVersion: "chrome" });
  expect(data.nodeId).toBe("desktop");
  expect(data.webLoggedInProviders).toEqual(["chatgpt", "deepseek"]);
  expect(data.runtimes.node).toBe(process.version);
  expect(data.memory.totalMb).toBeGreaterThan(0);
  expect(typeof data.sampledAt).toBe("string");
  void os;
});
