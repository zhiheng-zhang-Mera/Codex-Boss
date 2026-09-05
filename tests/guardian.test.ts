import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GUARDIAN_MUTABLE,
  GUARDIAN_PROTECTED,
  GUARDIAN_ROOT,
  changeAllowed,
  classifyArea,
  type GuardianGuard,
} from "../src/shared/guardian";
import { EMPTY_MANIFEST } from "../src/shared/permission";
import { PermissionManifestStore } from "../electron/security/permission-manifest";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-guardian-")); dirs.push(dir); return dir; }

describe("guardian classification", () => {
  it("maps the plan §28 vocabularies to their tiers", () => {
    expect(classifyArea("ui")).toBe<GuardianGuard>("mutable");
    expect(classifyArea("worker.prompts")).toBe("mutable");
    expect(classifyArea("routing.heuristics")).toBe("mutable");
    expect(classifyArea("scheduler.heuristics")).toBe("mutable");
    expect(classifyArea("knowledge.retrieval")).toBe("mutable");

    expect(classifyArea("verification.rules")).toBe("protected");
    expect(classifyArea("rollback")).toBe("protected");
    expect(classifyArea("permission.system")).toBe("protected");
    expect(classifyArea("security.classifier")).toBe("protected");
    expect(classifyArea("migration.rules")).toBe("protected");
    expect(classifyArea("promotion.gate")).toBe("protected");
    expect(classifyArea("approval.policy")).toBe("protected");

    expect(classifyArea("root.policy")).toBe("guardian");
    expect(classifyArea("production.signing")).toBe("guardian");
    expect(classifyArea("backup.deletion")).toBe("guardian");
    expect(classifyArea("classification.downgrade")).toBe("guardian");
    expect(classifyArea("core.security.boundary")).toBe("guardian");
  });

  it("defaults unknown areas to mutable (the mutable tier is an open list)", () => {
    expect(classifyArea("ui.theme.toggle")).toBe("mutable");
    expect(classifyArea("worker.prompt.new-template")).toBe("mutable");
    expect(classifyArea("something.entirely.new")).toBe("mutable");
  });

  it("keeps the three vocabularies disjoint and exactly per §28", () => {
    expect(GUARDIAN_MUTABLE.size).toBe(5);
    expect(GUARDIAN_PROTECTED.size).toBe(7);
    expect(GUARDIAN_ROOT.size).toBe(5);
    for (const g of [GUARDIAN_MUTABLE, GUARDIAN_PROTECTED, GUARDIAN_ROOT]) {
      for (const other of [GUARDIAN_MUTABLE, GUARDIAN_PROTECTED, GUARDIAN_ROOT]) {
        if (g !== other) {
          for (const area of g) expect(other.has(area)).toBe(false);
        }
      }
    }
  });
});

describe("changeAllowed verdicts", () => {
  it("allows mutable areas without a token", () => {
    const v = changeAllowed("routing.heuristics", false, "ws1");
    expect(v.allowed).toBe(true);
    expect(v.reason).toMatch(/mutable area/);
  });

  it("denies protected areas without a token and explains", () => {
    const v = changeAllowed("permission.system", false, "ws1");
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/Guardian denial/);
    expect(v.reason).toContain("permission.system");
  });

  it("denies guardian-root areas without a token", () => {
    const v = changeAllowed("backup.deletion", false, "ws1");
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("guardian");
  });

  it("allows protected and guardian areas with a Guardian token, surfacing scope", () => {
    const p = changeAllowed("rollback", true, "ws-42");
    expect(p.allowed).toBe(true);
    expect(p.reason).toContain("ws-42");
    const g = changeAllowed("production.signing", true, "ws-42");
    expect(g.allowed).toBe(true);
  });
});

describe("guardian + permission manifest integration", () => {
  it("guardedGrant refuses without a token and leaves the manifest unchanged", () => {
    const file = path.join(root(), "permissions.json");
    const store = new PermissionManifestStore(file);
    const verdict = store.guardedGrant("ws1", "filesystem", "src", false);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/Guardian denial/);
    expect(store.load("ws1")).toEqual(EMPTY_MANIFEST); // fails closed
  });

  it("guardedGrant widens the manifest when a Guardian token is present", () => {
    const file = path.join(root(), "permissions.json");
    const store = new PermissionManifestStore(file);
    const verdict = store.guardedGrant("ws1", "filesystem", "src", true);
    expect(verdict.allowed).toBe(true);
    expect(store.load("ws1").filesystem.allow).toEqual(["src"]);
  });

  it("unguarded grant() stays available for internal bootstrapping", () => {
    const file = path.join(root(), "permissions.json");
    const store = new PermissionManifestStore(file);
    store.grant("ws1", "repo", "codex-boss");
    expect(store.load("ws1").repo.allow).toEqual(["codex-boss"]);
  });
});
