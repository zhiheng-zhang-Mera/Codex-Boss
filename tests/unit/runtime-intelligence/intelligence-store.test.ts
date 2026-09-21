import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NODE_SNAPSHOT_HISTORY_LIMIT,
  OBSERVATION_READ_LIMIT,
  RuntimeIntelligenceStore,
  type RuntimeIntelligenceStoreOptions,
  type RuntimeIntelligenceStoreStatus
} from "../../../electron/runtime-intelligence/intelligence-store";
import {
  ATTRIBUTABLE_FAILURE_DOMAINS,
  FAILURE_DOMAINS,
  OUTCOME_KINDS,
  PARTIAL_SUCCESS_QUALITY,
  type FailureDomain,
  type OutcomeDomain,
  type OutcomeKind
} from "../../../src/shared/runtime-intelligence/contracts";

/**
 * The core layer's durable store, and the failure and outcome vocabulary it is the home of.
 *
 * The store is the one thing in this layer that writes: a bounded JSON ledger, an append-only
 * observation log and a bounded snapshot series. The vocabulary below is asserted here because this
 * is the layer that owns it — the outcome-ingestion layer consumes it, it does not define it.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-ri-store-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("the core store keeps the plane's durable state", () => {
  it("reports its own limits and status without inventing a measurement", () => {
    const options: RuntimeIntelligenceStoreOptions = { rootDir: makeRoot() };
    const store = new RuntimeIntelligenceStore(options);
    const status: RuntimeIntelligenceStoreStatus = store.status();
    expect(status.rootDir).toBe(options.rootDir);
    expect(status.counts).toEqual({ observations: 0, models: 0, nodes: 0, skillTelemetry: 0, contextRecords: 0, recommendations: 0 });
    expect(status.schemaVersion).toBeGreaterThan(0);
    // The two bounds are published so a caller can see what a read will cost.
    expect(NODE_SNAPSHOT_HISTORY_LIMIT).toBeGreaterThan(0);
    expect(OBSERVATION_READ_LIMIT).toBeGreaterThan(0);
  });

  it("round-trips a model record and counts what it wrote", () => {
    const store = new RuntimeIntelligenceStore({ rootDir: makeRoot() });
    store.saveModels([{ modelKey: "web:chatgpt" } as unknown as Parameters<typeof store.saveModels>[0][number]]);
    expect(store.loadModels()).toHaveLength(1);
    expect(store.model("web:chatgpt")?.modelKey).toBe("web:chatgpt");
    expect(store.status().counts.models).toBe(1);
    // A fresh instance over the same root reads the same ledger: the store is file-backed, not memory.
    expect(new RuntimeIntelligenceStore({ rootDir: store.status().rootDir }).loadModels()).toHaveLength(1);
  });
});

describe("the failure and outcome vocabulary belongs to this layer", () => {
  it("names every domain, the attributable subset and the outcome kinds", () => {
    const domains: readonly FailureDomain[] = FAILURE_DOMAINS;
    expect(domains.length).toBeGreaterThan(0);
    // The attributable subset is a real subset: a domain that cannot be attributed is not in it.
    for (const domain of ATTRIBUTABLE_FAILURE_DOMAINS) expect(domains).toContain(domain);
    expect(ATTRIBUTABLE_FAILURE_DOMAINS.length).toBeLessThanOrEqual(domains.length);
    const kinds: readonly OutcomeKind[] = OUTCOME_KINDS;
    expect(kinds).toContain("SUCCESS");
    expect(kinds).toContain("FAILURE");
    expect(kinds).toContain("PARTIAL_SUCCESS");
    // A partial success has a quality word, because "some of it worked" is not a boolean.
    expect(PARTIAL_SUCCESS_QUALITY).toBeTruthy();
    const domain: OutcomeDomain = "MODEL";
    expect(typeof domain).toBe("string");
  });
});
