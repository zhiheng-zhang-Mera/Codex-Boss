/**
 * Phase 10G evidence test: shared knowledge space vNext.
 * One user-level space shared by all nodes; provenance-rich records; versioned
 * supersede (no silent overwrite); scope filter; durable restart; node A and
 * node B contribute into the SAME space (no per-node personality silo).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TenxKnowledgeSpace } from "../../electron/tenx/knowledge-space";

describe("10G shared knowledge space", () => {
  it("node A and node B contribute into ONE user space (no per-node silos)", () => {
    const space = new TenxKnowledgeSpace(undefined, () => "2026-09-10T00:00:00.000Z");
    space.contribute({ content: "provider p1 uses region east", source: "probe", createdByNode: "node-a", artifactRef: "art-1", confidence: 0.9 });
    space.contribute({ content: "provider p2 login expired", source: "login-scan", createdByNode: "node-b", artifactRef: "art-2", confidence: 0.7 });
    expect(space.count()).toBe(2);
    const all = space.list();
    expect(all.map((record) => record.createdByNode).sort()).toEqual(["node-a", "node-b"]);
    expect(all.every((record) => record.scope === "global")).toBe(true);
  });

  it("stores full provenance (createdByNode, artifactRef, source, confidence, validity, scope)", () => {
    const space = new TenxKnowledgeSpace(undefined, () => "2026-09-10T00:00:00.000Z");
    const record = space.contribute({
      content: "task t9 succeeded at step 3",
      source: "run-artifact",
      createdByNode: "node-a",
      artifactRef: "run-9/cp.json",
      confidence: 1,
      scope: "task:t9",
      validity: { validFrom: "2026-09-10T00:00:00.000Z", validUntil: "2026-12-31T00:00:00.000Z" },
      provenanceChain: ["event:run-9-step-3"]
    });
    expect(record.createdByNode).toBe("node-a");
    expect(record.artifactRef).toBe("run-9/cp.json");
    expect(record.provenance.chain).toEqual(["event:run-9-step-3", "artifact:run-9/cp.json"]);
    expect(record.validity.validUntil).toBe("2026-12-31T00:00:00.000Z");
    expect(record.version).toBe(1);
    expect(record.state).toBe("ACTIVE");
  });

  it("supersede never silently overwrites: old version becomes SUPERSEDED and history keeps both", () => {
    const space = new TenxKnowledgeSpace(undefined, () => "2026-09-10T00:00:00.000Z");
    const first = space.contribute({ content: "p1 latency 50ms", source: "probe", createdByNode: "node-a" });
    const second = space.supersede(first.knowledgeId, { content: "p1 latency 30ms", source: "probe", createdByNode: "node-b" })!;
    expect(second.version).toBe(2);
    expect(second.state).toBe("ACTIVE");
    const history = space.history(first.knowledgeId);
    expect(history.length).toBe(2);
    expect(history[0].state).toBe("SUPERSEDED");
    expect(history[0].version).toBe(1);
    expect(history[1].version).toBe(2);
    // get returns only latest ACTIVE
    expect(space.get(first.knowledgeId)?.content).toBe("p1 latency 30ms");
    expect(space.count()).toBe(1); // one knowledge identity, latest active
  });

  it("scopes keep task/project/user knowledge separate but within one space", () => {
    const space = new TenxKnowledgeSpace(undefined, () => "2026-09-10T00:00:00.000Z");
    space.contribute({ content: "global fact", source: "s", createdByNode: "n1" });
    space.contribute({ content: "task fact", source: "s", createdByNode: "n1", scope: "task:t1" });
    expect(space.list("task:t1").length).toBe(1);
    expect(space.list("task:t1")[0].content).toBe("task fact");
    expect(space.list("global").length).toBe(1);
    expect(space.count()).toBe(2);
  });

  it("durable restart restores records and history", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10g-"));
    const file = path.join(dir, "kb.json");
    try {
      const first = new TenxKnowledgeSpace(file, () => "2026-09-10T00:00:00.000Z");
      const record = first.contribute({ content: "persisted fact", source: "probe", createdByNode: "node-a", artifactRef: "a1" });
      first.supersede(record.knowledgeId, { content: "persisted fact v2", source: "probe", createdByNode: "node-b" });
      const second = new TenxKnowledgeSpace(file, () => "2026-09-10T00:00:01.000Z");
      expect(second.history(record.knowledgeId).length).toBe(2);
      expect(second.get(record.knowledgeId)?.content).toBe("persisted fact v2");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
