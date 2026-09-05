import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeStore } from "../electron/knowledge/knowledge-store";
import { routeKnowledgeQuery, relevanceScore, retrieveReranked, type KnowledgeEntry } from "../src/shared/knowledge";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-knowledge-")); dirs.push(dir); return dir; }

const base: Omit<KnowledgeEntry, "id" | "title" | "domain" | "tags" | "content"> = { shelf: "default", source: "test", trust: "MEDIUM", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
function entry(id: string, overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return { ...base, id, title: id, domain: "engineering", tags: [], content: "content of " + id, ...overrides };
}

describe("knowledge core local backend", () => {
  it("stores entries in a workspace shelf and returns the taxonomy", () => {
    const file = path.join(root(), "knowledge.json");
    const store = new KnowledgeStore(file);
    store.put(entry("a", { shelf: "ws1", domain: "engineering", tags: ["ts", "electron"] }));
    store.put(entry("b", { shelf: "ws2", domain: "research", tags: ["web"] }));
    expect(store.list("ws1")).toHaveLength(1);
    expect(store.taxonomy()).toEqual({ domains: ["engineering", "research"], shelves: ["ws1", "ws2"], tags: ["electron", "ts", "web"] });
    expect(new KnowledgeStore(file).list()).toHaveLength(2); // persisted
  });

  it("applies supersede so the latest entry wins", () => {
    const store = new KnowledgeStore(path.join(root(), "knowledge.json"));
    store.put(entry("v1", { content: "old guidance" }));
    store.put(entry("v2", { supersedes: "v1", content: "new guidance" }));
    expect(store.list().map((item) => item.id)).toEqual(["v2"]);
  });

  it("respects domain/tags/trust/validity filters and the retrieval budget", () => {
    const store = new KnowledgeStore(path.join(root(), "knowledge.json"));
    store.put(entry("eng", { domain: "engineering", tags: ["ts"], content: "x".repeat(200) }));
    store.put(entry("high", { domain: "engineering", tags: ["ts"], trust: "HIGH", content: "y".repeat(200) }));
    store.put(entry("other", { domain: "research", tags: ["ts"], content: "z".repeat(200) }));
    store.put(entry("expired", { domain: "engineering", tags: ["ts"], validUntil: "2000-01-01T00:00:00.000Z", content: "old" }));
    // Trust-filtered: expired and low-trust entries excluded; budget fits only the highest.
    const result = store.retrieve({ domain: "engineering", shelf: "default", tags: ["ts"], trustAtLeast: "HIGH", maxChars: 250 });
    expect(result.map((item) => item.id)).toEqual(["high"]);
    const budgeted = store.retrieve({ domain: "engineering", shelf: "default", maxChars: 210 });
    const chars = budgeted.reduce((sum, item) => sum + item.content.length, 0);
    expect(chars).toBeLessThanOrEqual(400); // at most first + next-eligible partial-free bound
    expect(budgeted.length).toBeGreaterThan(0);
  });

  it("fails closed on a corrupt knowledge file", () => {
    const file = path.join(root(), "knowledge.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 9 }));
    expect(() => new KnowledgeStore(file).list()).toThrow(/Invalid/);
  });
});

describe("domain router + rerank (AP10 seam)", () => {
  it("routes a goal to the matching domain and shelves out irrelevant domains", () => {
    const entries = [
      entry("e1", { domain: "blender", shelf: "3d", tags: ["render", "mesh"] }),
      entry("e2", { domain: "research", shelf: "science", tags: ["statistics"] })
    ];
    const routed = routeKnowledgeQuery("render a mesh with blender", entries);
    expect(routed.domain).toBe("blender");
    expect(routed.tags).toEqual(expect.arrayContaining(["render", "mesh"]));
  });

  it("scores title/tags/domain/content relevance deterministically", () => {
    const relevant = entry("hit", { domain: "blender", tags: ["render"], title: "blender render settings", content: "mesh render output quality" });
    const irrelevant = entry("miss", { domain: "research", tags: ["papers"], title: "citation formats", content: "bibliography style guides" });
    expect(relevanceScore(relevant, "render a blender mesh")).toBeGreaterThan(relevanceScore(irrelevant, "render a blender mesh"));
  });

  it("retrieves reranked within the budget and store.retrieveForGoal routes automatically", () => {
    const store = new KnowledgeStore(path.join(root(), "knowledge.json"));
    const relevant = entry("hit", { domain: "blender", tags: ["render"], title: "render guide", content: "x".repeat(300), trust: "LOW" });
    const irrelevant = entry("miss", { domain: "research", tags: ["papers"], title: "citation formats", content: "y".repeat(300), trust: "HIGH" });
    store.put(relevant); store.put(irrelevant);
    const reranked = store.retrieveForGoal("how do I render a mesh", { maxChars: 400 });
    expect(reranked[0].id).toBe("hit");
    expect(reranked.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(600);
    const pure = retrieveReranked([relevant, irrelevant], { maxChars: 400 }, "how do I render a mesh");
    expect(pure[0].id).toBe("hit");
  });
});
