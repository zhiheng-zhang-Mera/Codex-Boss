/**
 * Phase 10A evidence test: architecture contract skeleton is coherent,
 * JSON-round-trippable, and platform-neutral (no host/OS imports leak into
 * the shared 10.x contract layer). Pure module checks only.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  TENX_CONTRACT_VERSION,
  TENX_CONTRACTS,
  TENX_SCHEMA_MARKERS,
  isTenxEnvelope,
  roundTrip,
  type TenxEnvelope
} from "../../src/shared/tenx/contracts";

describe("10A contract vocabulary", () => {
  it("has one immutable version marker and covers every taskbook contract", () => {
    expect(TENX_CONTRACT_VERSION).toBe("10.0.0");
    // Node/fleet/knowledge/artifact/network/session + supporting contracts are covered.
    for (const required of ["node", "fleet", "knowledge", "artifact", "network", "session"] as const) {
      expect(TENX_CONTRACTS).toContain(required);
    }
    expect(TENX_SCHEMA_MARKERS[TENX_CONTRACTS[0]]).toBeGreaterThanOrEqual(1);
  });

  it("validates the universal envelope deterministically", () => {
    const envelope: TenxEnvelope<"node.join"> = {
      schema: "fleet",
      contractVersion: TENX_CONTRACT_VERSION,
      kind: "node.join",
      nodeId: "node-a",
      sentAt: "2026-09-10T00:00:00.000Z",
      payload: {}
    };
    expect(isTenxEnvelope(envelope)).toBe(true);
    expect(isTenxEnvelope(null)).toBe(false);
    expect(isTenxEnvelope({ ...envelope, sentAt: "not-a-date" })).toBe(false);
    expect(isTenxEnvelope({ ...envelope, schema: "unknown-schema" })).toBe(false);
  });

  it("round-trips every documented contract record through JSON", () => {
    const samples: unknown[] = [
      { nodeId: "n1", hostId: "h1", deviceType: "desktop", os: "windows", arch: "x64", runtimeVersion: "24", bossVersion: "10.0.0" },
      { taskId: "t1", ownerNode: "n1", leaseId: "l1", leaseExpiresAt: 1, takeoverAllowed: true, replaySafety: "replaySafe", state: "LEASED" },
      { knowledgeId: "k1", content: "fact", confidence: 0.5, scope: "global", version: 1, state: "ACTIVE" },
      { artifactId: "a1", type: "checkpoint", sha256: "abc", version: 1, stage: "RAW", status: "ACTIVE" },
      { provider: "p1", reachable: true, authenticated: false, regionBlocked: false, rateLimited: false, proxyRequired: false }
    ];
    for (const sample of samples) {
      expect(roundTrip(sample)).toEqual(sample);
    }
  });
});

describe("10A platform neutrality guard", () => {
  const tenxDir = path.resolve(__dirname, "../../src/shared/tenx");
  const forbidden = ["from \"node:", "require(\"node:", "from \"electron", "process.platform", "os.cpus()"];

  it("src/shared/tenx/** contains no host-OS or Electron import", () => {
    const files = fs.readdirSync(tenxDir).filter((file) => file.endsWith(".ts") && file !== "index.ts");
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) {
      const content = fs.readFileSync(path.join(tenxDir, file), "utf8");
      for (const needle of forbidden) {
        expect(content.includes(needle), `${file} must not contain ${needle}`).toBe(false);
      }
    }
  });
});
