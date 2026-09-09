import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decidePromotion } from "../src/shared/experience";
import { ExperienceStore } from "../electron/experience/experience-store";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-experience-")); dirs.push(dir); return dir; }

describe("experience promotion rules", () => {
  it("promotes task → workspace after repeated evidence, never on a single observation", () => {
    const single = { id: "c", claim: "c", domain: "eng", level: "task" as const, observations: [{ level: "task" as const, source: "ws1", at: "a" }], createdAt: "a", updatedAt: "a" };
    expect(decidePromotion(single).nextLevel).toBeNull();
    const repeated = { ...single, observations: [{ level: "task", source: "ws1", at: "a" }, { level: "task", source: "ws1", at: "b" }] };
    expect(decidePromotion(repeated).nextLevel).toBe("workspace");
  });

  it("workspace → domain needs two distinct workspaces; domain → global needs three", () => {
    const oneWorkspace = { id: "c", claim: "c", domain: "eng", level: "workspace" as const, observations: [{ level: "workspace", source: "ws1", at: "a" }, { level: "workspace", source: "ws1", at: "b" }], createdAt: "a", updatedAt: "a" };
    expect(decidePromotion(oneWorkspace).nextLevel).toBeNull();
    const two = { ...oneWorkspace, observations: [{ level: "workspace", source: "ws1", at: "a" }, { level: "workspace", source: "ws2", at: "b" }] };
    expect(decidePromotion(two).nextLevel).toBe("domain");
    const domainGlobal = { ...two, level: "domain" as const, observations: [{ level: "domain", source: "ws1", at: "a" }, { level: "domain", source: "ws2", at: "b" }, { level: "domain", source: "ws3", at: "c" }] };
    expect(decidePromotion(domainGlobal).nextLevel).toBe("global");
    expect(decidePromotion({ ...domainGlobal, observations: domainGlobal.observations.slice(0, 2) }).nextLevel).toBeNull();
  });
});

describe("experience store", () => {
  it("observes and promotes with persistence", () => {
    const file = path.join(root(), "experience.json");
    const store = new ExperienceStore(file);
    const first = store.observe("prefer worktree", "engineering", { source: "ws1" }, () => 0);
    expect(first.entry.level).toBe("task");
    expect(first.promotion).toBeNull();
    const second = store.observe("prefer worktree", "engineering", { source: "ws1" }, () => 1000);
    expect(second.entry.level).toBe("workspace");
    expect(second.promotion).toBe("workspace");
    expect(new ExperienceStore(file).list()).toHaveLength(1); // persisted
    expect(new ExperienceStore(file).list()[0].level).toBe("workspace");
  });

  it("fails closed on a corrupt file", () => {
    const file = path.join(root(), "experience.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 9 }));
    expect(() => new ExperienceStore(file).list()).toThrow(/Invalid/);
  });
});
