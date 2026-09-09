/**
 * Phase 10J evidence test: local fallback + deferred sync.
 * KB reachable → normal mode; unreachable → local fallback (task never blocked,
 * contribution queued with provenance); network restored → sync dedups and
 * never overwrites newer knowledge.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TenxKnowledgeSpace } from "../../electron/tenx/knowledge-space";
import { TenxKnowledgeSync, type KnowledgeGateway } from "../../electron/tenx/knowledge-sync";
import type { KnowledgeRecordVNext } from "../../src/shared/tenx/knowledge";

const at = "2026-09-10T00:00:00.000Z";

class FakeGateway implements KnowledgeGateway {
  online = true;
  readonly remote = new TenxKnowledgeSpace(undefined, () => at);
  pushed: KnowledgeRecordVNext[] = [];
  pushRejectOnce = false;

  isOnline(): boolean {
    return this.online;
  }
  async snapshot(): Promise<KnowledgeRecordVNext[]> {
    return this.remote.list();
  }
  async push(record: KnowledgeRecordVNext): Promise<"pushed" | "newer-exists" | "error"> {
    if (this.pushRejectOnce) {
      this.pushRejectOnce = false;
      return "error";
    }
    this.remote.contribute({
      content: record.content,
      source: record.source,
      createdByNode: record.createdByNode,
      artifactRef: record.artifactRef,
      scope: record.scope,
      confidence: record.confidence,
      createdAt: record.createdAt
    });
    this.pushed.push(record);
    return "pushed";
  }
}

describe("10J local fallback + deferred sync", () => {
  it("normal mode pushes through when the gateway is online", async () => {
    const gateway = new FakeGateway();
    const sync = new TenxKnowledgeSync(new TenxKnowledgeSpace(undefined, () => at), gateway, undefined, () => at);
    const { mode } = await sync.contribute({ content: "online fact", source: "probe", createdByNode: "node-a" });
    expect(mode).toBe("normal");
    expect(gateway.remote.count()).toBe(1);
    expect(sync.pendingCount()).toBe(0);
  });

  it("local fallback queues the contribution and never blocks the task", async () => {
    const gateway = new FakeGateway();
    gateway.online = false;
    const local = new TenxKnowledgeSpace(undefined, () => at);
    const sync = new TenxKnowledgeSync(local, gateway, undefined, () => at);
    const { mode, record } = await sync.contribute({ content: "offline fact", source: "probe", createdByNode: "node-a" });
    expect(mode).toBe("local-fallback");
    expect(sync.pendingCount()).toBe(1);
    expect(local.count()).toBe(1); // locally usable immediately
    expect(record.provenance.chain.length).toBeGreaterThan(0); // provenance preserved
    expect(gateway.remote.count()).toBe(0);
  });

  it("deferred sync pushes queued work once the network is restored", async () => {
    const gateway = new FakeGateway();
    gateway.online = false;
    const local = new TenxKnowledgeSpace(undefined, () => at);
    const sync = new TenxKnowledgeSync(local, gateway, undefined, () => at);
    await sync.contribute({ content: "offline fact", source: "probe", createdByNode: "node-a" });
    gateway.online = true;
    const result = await sync.sync();
    expect(result.pushed).toBe(1);
    expect(result.remaining).toBe(0);
    expect(gateway.remote.count()).toBe(1);
    expect(sync.pendingCount()).toBe(0);
  });

  it("sync dedups: a fact already on the target contributes once", async () => {
    const gateway = new FakeGateway();
    gateway.online = false;
    const local = new TenxKnowledgeSpace(undefined, () => at);
    const sync = new TenxKnowledgeSync(local, gateway, undefined, () => at);
    await sync.contribute({ content: "dedupe fact alpha beta", source: "probe", createdByNode: "node-a" });
    // target already has the same content
    gateway.remote.contribute({ content: "dedupe fact alpha beta", source: "probe", createdByNode: "node-z" });
    gateway.online = true;
    const result = await sync.sync();
    expect(result.pushed).toBe(0); // not re-pushed
    expect(gateway.remote.count()).toBe(1);
  });

  it("never overwrites newer knowledge on the target", async () => {
    const gateway = new FakeGateway();
    gateway.online = false;
    const local = new TenxKnowledgeSpace(undefined, () => at);
    const sync = new TenxKnowledgeSync(local, gateway, undefined, () => at);
    await sync.contribute({ content: "version fact", source: "node-a", createdByNode: "node-a" });
    // target already has a NEWER version of the same knowledge identity
    const newer = gateway.remote.contribute({ content: "version fact", source: "node-z", createdByNode: "node-z" });
    gateway.remote.supersede(newer.knowledgeId, { content: "version fact v2", source: "node-z", createdByNode: "node-z" });
    gateway.online = true;
    const result = await sync.sync();
    // local version (v1, older) must NOT overwrite the target's v2
    expect(result.skippedNewer).toBe(1);
    expect(result.pushed).toBe(0);
    expect(gateway.remote.get(newer.knowledgeId)?.version).toBe(2);
  });

  it("durable sync queue survives restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10j-"));
    const file = path.join(dir, "sync.json");
    try {
      const gateway = new FakeGateway();
      gateway.online = false;
      const local = new TenxKnowledgeSpace(undefined, () => at);
      const first = new TenxKnowledgeSync(local, gateway, file, () => at);
      await first.contribute({ content: "queued fact", source: "probe", createdByNode: "node-a" });
      const second = new TenxKnowledgeSync(local, gateway, file, () => at);
      expect(second.pendingCount()).toBe(1);
      gateway.online = true;
      const result = await second.sync();
      expect(result.pushed).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
