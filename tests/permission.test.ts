import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_MANIFEST, desktopMutationGate, manifestAllows, manifestNarrow, type PermissionManifest } from "../src/shared/permission";
import { PermissionManifestStore } from "../electron/security/permission-manifest";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-permission-")); dirs.push(dir); return dir; }

function manifest(overrides: Partial<PermissionManifest> = {}): PermissionManifest {
  const merged = structuredClone(EMPTY_MANIFEST);
  for (const [kind, scope] of Object.entries(overrides) as [keyof PermissionManifest, Partial<PermissionManifest[keyof PermissionManifest]>][]) {
    merged[kind] = { allow: [], deny: [], ...scope };
  }
  return merged;
}

describe("permission manifest algebra", () => {
  it("denies everything by default and honors deny over allow", () => {
    expect(manifestAllows(EMPTY_MANIFEST, "filesystem", "src/a.ts")).toBe(false);
    const m = manifest({ filesystem: { allow: ["src"], deny: ["src/secret.ts"] } });
    expect(manifestAllows(m, "filesystem", "src/a.ts")).toBe(true);
    expect(manifestAllows(m, "filesystem", "src/secret.ts")).toBe(false);
    expect(manifestAllows(m, "filesystem", "lib/a.ts")).toBe(false);
  });

  it("task permissions must never exceed workspace permissions", () => {
    const workspace = manifest({ filesystem: { allow: ["src"] }, repo: { allow: ["repoA"] }, network: { allow: [] } });
    const ok = manifest({ filesystem: { allow: ["src/util.ts"] }, repo: { allow: ["repoA"] } });
    const tooWide = manifest({ filesystem: { allow: ["src", "lib"] }, repo: { allow: ["repoB"] }, network: { allow: ["https://evil.test"] } });
    expect(manifestNarrow(workspace, ok)).toEqual([]);
    const violations = manifestNarrow(workspace, tooWide);
    expect(violations).toContain("filesystem:allow:lib");
    expect(violations).toContain("repo:allow:repoB");
    expect(violations).toContain("network:allow:https://evil.test");
  });
});

describe("permission manifest store", () => {
  it("defaults to deny-all for unknown workspaces and persists grants", () => {
    const file = path.join(root(), "permissions.json");
    const store = new PermissionManifestStore(file);
    expect(store.load("ws1")).toEqual(EMPTY_MANIFEST);
    store.grant("ws1", "filesystem", "src");
    const loaded = store.load("ws1");
    expect(loaded.filesystem.allow).toEqual(["src"]);
    expect(store.load("ws2")).toEqual(EMPTY_MANIFEST); // workspace isolation
    expect(new PermissionManifestStore(file).load("ws1").filesystem.allow).toEqual(["src"]); // persisted
  });

  it("fails closed on a corrupt manifest", () => {
    const file = path.join(root(), "permissions.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 9, workspaceId: "ws1" }));
    expect(() => new PermissionManifestStore(file).load("ws1")).toThrow(/Invalid/);
  });
});

describe("desktop side-effect gate (computer permission wiring)", () => {
  it("denies every desktop mutation with no manifest or an empty manifest", () => {
    expect(desktopMutationGate(undefined, "click_control").allowed).toBe(false);
    expect(desktopMutationGate(undefined, "enter_text").allowed).toBe(false);
    expect(desktopMutationGate(EMPTY_MANIFEST, "click_control").allowed).toBe(false);
    expect(desktopMutationGate(EMPTY_MANIFEST, "open_app").allowed).toBe(false);
  });

  it("always lets read-only desktop actions through", () => {
    for (const name of ["read_page", "find_control", "verify_state", "wait_for_state"]) {
      expect(desktopMutationGate(undefined, name)).toEqual({ allowed: true });
    }
  });

  it("allows a mutation only when `computer:<action>` is in the side-effect allow list", () => {
    const allowed = manifest({ "side-effect": { allow: ["computer:enter_text"] } });
    expect(desktopMutationGate(allowed, "enter_text").allowed).toBe(true);
    expect(desktopMutationGate(allowed, "click_control").allowed).toBe(false);
    // deny beats allow
    const denied = manifest({ "side-effect": { allow: ["computer:click_control"], deny: ["computer:click_control"] } });
    expect(desktopMutationGate(denied, "click_control").allowed).toBe(false);
  });
});
