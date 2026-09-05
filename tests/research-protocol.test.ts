import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scientificCore, diffProtocol, validateAmendment, type ResearchProtocol, type ProtocolAmendment } from "../src/shared/research-protocol";
import { ProtocolManager } from "../electron/research/protocol-manager";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-protocol-")); dirs.push(dir); return dir; }

function protocol(overrides: Partial<ResearchProtocol> = {}): ResearchProtocol {
  return {
    schemaVersion: 1, hypothesis: "H1", primaryMetric: "pass-rate", baseline: "0.8",
    sampleDefinition: "tasks 1-50", evaluationCriterion: ">= baseline", createdAt: new Date(0).toISOString(), ...overrides
  };
}

describe("protocol freeze + amendment rules (Phase 7)", () => {
  it("freezes a protocol to a stable hash and rejects double freeze", () => {
    const dir = root();
    const manager = new ProtocolManager(dir);
    const first = manager.freeze("r1", protocol());
    const again = manager.freeze("r2", protocol());
    expect(first.hash).toBe(again.hash); // same scientific content → same hash
    expect(() => manager.freeze("r1", protocol())).toThrow(/already frozen/);
    expect(manager.load("r1")?.protocolHash).toBe(first.hash);
  });

  it("guards scientific fields from silent mutation and allows amendment with the frozen hash", () => {
    const dir = root();
    const manager = new ProtocolManager(dir);
    const original = protocol();
    const { hash } = manager.freeze("r1", original);

    // Mechanical changes (path/env) are not silent scientific changes.
    const mechanical = diffProtocol(scientificCore(original), protocol({ environment: { PYTHONPATH: "x" } }));
    expect(mechanical.silentChange).toBe(false);

    // Changing the hypothesis is a silent scientific change unless amended.
    const core = scientificCore(original);
    const changed = diffProtocol(core, protocol({ hypothesis: "H2" }));
    expect(changed.silentChange).toBe(true);
    expect(changed.changedFrozen).toEqual(["hypothesis"]);

    // Explicit amendment bound to the frozen hash is valid.
    const amendment = manager.amend("r1", { id: "amendment-1", changes: [{ field: "hypothesis", before: "H1", after: "H2", reason: "new evidence" }] });
    expect(amendment.protocolHash).toBe(hash);
    expect(manager.amendments("r1")).toHaveLength(1);
    expect(manager.load("r1")!.protocolHash).toBe(hash); // frozen hash unchanged
  });

  it("validates amendments fail closed", () => {
    const good: ProtocolAmendment = { id: "a1", protocolHash: "abc", approved: true, createdAt: "x", changes: [{ field: "baseline", before: "0.8", after: "0.7", reason: "typo" }] };
    expect(() => validateAmendment(good)).not.toThrow();
    expect(() => validateAmendment({ ...good, changes: [{ field: "syntax", before: "", after: "", reason: "x" }] })).toThrow(); // syntax is not frozen
    expect(() => validateAmendment({ ...good, changes: [] })).toThrow();
  });
});
