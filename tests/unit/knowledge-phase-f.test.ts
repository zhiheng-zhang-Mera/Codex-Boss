import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { contentHash } from "../../electron/knowledge/knowledge-space-store";
import { dedupeContributions, retrieveRelevant } from "../../src/shared/knowledge-space";
import { KnowledgeSpaceStore, DeferredSyncQueue, type SyncGateway } from "../../electron/knowledge/knowledge-space-store";
import { markRunFailed, recordStageArtifact, sha256 } from "../../electron/workspace/artifact-backbone";

/**
 * Phase F (R-601…R-604): user knowledge space + KB local fallback/deferred sync
 * + artifact backbone. KB backend offline ⇒ local store keeps serving and
 * writes queue for deferred sync; artifact manifests are append-only so a
 * partial failure never wipes earlier stages.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-ff-")); dirs.push(dir); return dir; }

const gateway = (online: boolean): SyncGateway => ({ isOnline: () => online, push: async () => true });

it("R-601: contributions dedupe by content hash; retrieval pulls only what a task needs", () => {
  const store = new KnowledgeSpaceStore(path.join(root(), "kb.json"));
  store.put({ ownerNode: "node-a", content: "qwen send fix: dom enter then verify prompt", tags: ["qwen", "send"], source: "local" });
  store.put({ ownerNode: "node-b", content: "qwen send fix: dom enter then verify prompt", tags: ["qwen", "send"], source: "local" }); // duplicate
  expect(store.count()).toBe(1);
  const hits = store.search({ tags: ["send"] });
  expect(hits.length).toBe(1);
  expect(store.search({ text: "unrelated topic" })).toHaveLength(0);
  expect(contentHash("a")).toHaveLength(64);
  expect(dedupeContributions(store.list()).length).toBe(1);
});

it("R-602/R-603: KB gateway offline ⇒ local store keeps serving; writes queue for deferred sync and drain on recovery", async () => {
  const dir = root();
  const store = new KnowledgeSpaceStore(path.join(dir, "kb.json"));
  const queue = new DeferredSyncQueue(path.join(dir, "queue.json"));
  const online = { value: false };
  const gatewayRef: SyncGateway = { isOnline: () => online.value, push: async () => true };

  const entry = store.put({ ownerNode: "desktop", content: "finding: widget selector drift", tags: ["ui"], source: "local" });
  // Backend offline: contribution is queued, not lost, and unrelated retrieval still works.
  queue.enqueue({ id: `kb-${contentHash(entry.content).slice(0, 12)}`, kind: "knowledge", payload: entry });
  expect(store.search({ text: "widget" })).toHaveLength(1);

  // Recovery: gateway returns → drain completes the deferred synchronization.
  online.value = true;
  const drained = await queue.drain(gatewayRef);
  expect(drained.pushed).toBe(1);
  expect(drained.remaining).toBe(0);
});

it("R-604: artifact backbone manifests are append-only; a later failed stage never wipes earlier records", () => {
  const dir = path.join(root(), "run-r1");
  let manifest = recordStageArtifact(dir, "r1", "proposal", "proposal.md", "# RP", "human-architect");
  manifest = recordStageArtifact(dir, "r1", "literature", "lit.md", "sources", "retriever");
  markRunFailed(dir, "r1", "experiment compile failed");
  manifest = recordStageArtifact(dir, "r1", "analysis", "analysis.md", "stats", "analyzer");

  const final = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as { records: Array<{ stage: string; sha256: string; file: string }>; failedRuns: string[] };
  expect(final.records.map((record) => record.stage)).toEqual(["proposal", "literature", "analysis"]);
  expect(final.failedRuns).toContain("experiment compile failed");
  expect(fs.readFileSync(path.join(dir, "proposal.md"), "utf8")).toBe("# RP"); // preserved
  expect(sha256("# RP")).toBe(final.records[0].sha256);
});
