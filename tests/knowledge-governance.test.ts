import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agingState, associateAcrossDomains, decideIngestion, placementFor, resolveConflictGroup, scoreTrust, trustFromScore } from "../src/shared/knowledge-governance";
import { KnowledgeGovernanceStore } from "../electron/knowledge/knowledge-governance-store";
import type { KnowledgeEntry } from "../src/shared/knowledge";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-governance-")); dirs.push(dir); return dir; }

const base: Omit<KnowledgeEntry, "id" | "title" | "domain" | "tags" | "content"> = { shelf: "default", source: "test", trust: "MEDIUM", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
function entry(id: string, overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return { ...base, id, title: id, domain: "engineering", tags: [], content: "content " + id, ...overrides };
}
const NOW = Date.parse("2026-09-06T00:00:00.000Z");

describe("knowledge governance (AP20 pure)", () => {
  it("decides auto-ingestion: reject, supersede, dedupe, add", () => {
    const a = entry("a", { content: "same" });
    expect(decideIngestion(entry("b", { content: "same" }), [a]).decision).toBe("DUPLICATE");
    expect(decideIngestion(entry("c", { supersedes: "a" }), [a]).decision).toBe("SUPERSEDE");
    expect(decideIngestion(entry("d", { supersedes: "ghost" }), [a]).decision).toBe("REJECT");
    expect(decideIngestion(entry("e"), [a]).decision).toBe("ADD");
    expect(decideIngestion(entry("f", { content: "  " }), [a]).decision).toBe("REJECT");
  });

  it("resolves conflict groups by explicit supersede or trust+recency, ties unresolved", () => {
    const group = "g1";
    const low = entry("low", { conflictGroup: group, trust: "LOW", updatedAt: "2026-02-01T00:00:00.000Z" });
    const high = entry("high", { conflictGroup: group, trust: "HIGH", updatedAt: "2026-02-02T00:00:00.000Z" });
    expect(resolveConflictGroup(group, [low, high]).winnerId).toBe("high");
    const explicit = entry("newer", { conflictGroup: group, supersedes: "high", trust: "UNVERIFIED", updatedAt: "2026-03-01T00:00:00.000Z" });
    expect(resolveConflictGroup(group, [low, high, explicit]).winnerId).toBe("newer");
    const tie = resolveConflictGroup("tie", [entry("x", { conflictGroup: "tie", trust: "MEDIUM", updatedAt: "2026-01-01T00:00:00.000Z" }), entry("y", { conflictGroup: "tie", trust: "MEDIUM", updatedAt: "2026-01-01T00:00:00.000Z" })]);
    expect(tie.unresolved).toBe(true);
  });

  it("scores trust with observations and maps back to a tier", () => {
    expect(trustFromScore(scoreTrust({ entry: entry("a", { trust: "LOW" }), successes: 10, failures: 0 }))).toBe("HIGH");
    expect(trustFromScore(scoreTrust({ entry: entry("a", { trust: "LOW" }), successes: 0, failures: 5 }))).toBe("UNVERIFIED");
  });

  it("ages knowledge and associates entries across domains", () => {
    const fresh = entry("a", { validUntil: "2099-01-01T00:00:00.000Z" });
    const stale = entry("b", { validUntil: "2020-01-01T00:00:00.000Z" });
    const future = entry("c", { validFrom: "2099-01-01T00:00:00.000Z" });
    expect(agingState(fresh, NOW)).toBe("VALID");
    expect(agingState(stale, NOW)).toBe("EXPIRED");
    expect(agingState(future, NOW)).toBe("NEVER_VALID");
    const edges = associateAcrossDomains([entry("web", { domain: "web", tags: ["search", "research"] }), entry("science", { domain: "science", tags: ["research"] })]);
    expect(edges.some((edge) => edge.kind === "cross-domain")).toBe(true);
  });

  it("places entries across LocalHot/LocalWarm/EncryptedCold", () => {
    const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86400000).toISOString();
    expect(placementFor(entry("hot", { updatedAt: iso(1) }), { now: NOW })).toBe("LocalHot");
    expect(placementFor(entry("warm", { updatedAt: iso(20) }), { now: NOW })).toBe("LocalWarm");
    expect(placementFor(entry("cold", { updatedAt: iso(60) }), { now: NOW })).toBe("EncryptedCold");
    expect(placementFor(entry("sensitive", { updatedAt: iso(1) }), { now: NOW, sensitive: true })).toBe("EncryptedCold");
  });
});

describe("hybrid storage governance store (AP20 electron)", () => {
  it("ingests with dedupe/supersede and persists tiers", () => {
    const dir = root();
    const store = new KnowledgeGovernanceStore(dir);
    const recent = new Date(Date.now() - 86400000).toISOString();
    expect(store.ingest(entry("a", { content: "payload", updatedAt: recent })).decision).toBe("ADD");
    expect(store.ingest(entry("b", { content: "payload", updatedAt: recent })).decision).toBe("DUPLICATE"); // b is NOT added
    expect(store.ingest(entry("c", { supersedes: "a", content: "new payload", updatedAt: recent })).decision).toBe("SUPERSEDE");
    const ids = store.list().map((item) => item.id).sort();
    expect(ids).toEqual(["c"]);
    // A warm-tier entry lands in warm.json; a fresh reload sees both tiers.
    store.put(entry("aged", { updatedAt: new Date(Date.now() - 20 * 86400000).toISOString() }));
    const restored = new KnowledgeGovernanceStore(dir);
    expect(restored.list().map((item) => item.id).sort()).toEqual(["aged", "c"]);
    expect(fs.existsSync(path.join(dir, "hot.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "warm.json"))).toBe(true);
  });

  it("resolves conflicts by archiving losers to the cold tier", () => {
    const dir = root();
    const store = new KnowledgeGovernanceStore(dir);
    const recent = new Date(Date.now() - 86400000).toISOString();
    store.ingest(entry("lo", { conflictGroup: "g", trust: "LOW", updatedAt: recent }));
    store.ingest(entry("hi", { conflictGroup: "g", trust: "HIGH", updatedAt: recent }));
    const resolution = store.resolveConflict("g");
    expect(resolution.winnerId).toBe("hi");
    expect(store.list().map((item) => item.id)).toEqual(["hi"]);
    expect(store.list("EncryptedCold").map((item) => item.id)).toEqual(["lo"]);
  });

  it("fails closed on corrupt tier files", () => {
    const dir = root();
    fs.writeFileSync(path.join(dir, "hot.json"), JSON.stringify({ schemaVersion: 9 }));
    expect(() => new KnowledgeGovernanceStore(dir)).toThrow();
  });
});
