import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectStateStore } from "../../electron/project/project-state";
import { durableFileFor, durableRootFor } from "../../electron/workspace/durable-roots";
import { DEFAULT_WORKSPACE_ID, SCRATCH_WORKSPACE_ID } from "../../src/shared/workspace";

/**
 * Phase I — one authoritative owner per durable state.
 *
 * The audit listed three sites where durable state appeared to have two writers.
 * Each was checked before anything was changed, and each turned out to hold the
 * invariant by a different route than the audit assumed:
 *
 *  - `.boss/project-state.json` really does have two `ProjectStateStore`
 *    constructions (the boot module for the active workspace, and `openProjectState`
 *    per call) — but the store is STATELESS: every operation re-reads the file, so
 *    two instances over one path are equivalent to one. That is a legitimate way to
 *    hold the invariant, and it is the kind that can rot silently, so the first test
 *    below FAILS if the class ever gains an in-memory cache;
 *  - the theme tree is written by two modules, but they own DIFFERENT files:
 *    `theme-storage` owns the per-theme package directory, `theme-service` owns the
 *    registry. `new ThemeService(` appears exactly once under `electron/**`;
 *  - `.boss/research/**` mixes a ledger layout with a service layout ON PURPOSE,
 *    recorded in the research module: the per-store roots keep the pre-migration
 *    locations so runs recorded earlier stay recoverable. That is a compatibility
 *    decision, not a defect.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-durable-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const PROJECT = process.cwd();
const read = (relative: string): string => fs.readFileSync(path.join(PROJECT, ...relative.split("/")), "utf8");

function sourceFilesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) { found.push(...sourceFilesUnder(full)); continue; }
    if (entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

describe("Phase I — durable state ownership", () => {
  it("keeps the project-state store stateless, so two instances are not two owners", () => {
    const file = path.join(makeRoot(), "project-state.json");
    const first = new ProjectStateStore(file);
    const second = new ProjectStateStore(file);
    expect(first.load(DEFAULT_WORKSPACE_ID).decisions).toEqual([]);
    // A write through ONE instance is visible to the other immediately: there is no
    // cache to diverge, which is exactly why the two construction sites are safe.
    second.appendDecision(DEFAULT_WORKSPACE_ID, { decision: "second", outcome: "accepted", reason: "written by the second instance", evidenceRefs: [] });
    expect(first.load(DEFAULT_WORKSPACE_ID).decisions.map((entry) => entry.reason)).toEqual(["written by the second instance"]);
    first.appendDecision(DEFAULT_WORKSPACE_ID, { decision: "first", outcome: "accepted", reason: "written by the first instance", evidenceRefs: [] });
    expect(second.load(DEFAULT_WORKSPACE_ID).decisions.length).toBe(2);
  });

  it("derives one path per (data root, workspace), so two callers cannot diverge", () => {
    const dataRoot = "C:\\data";
    const a = durableFileFor(dataRoot, "workspace-a", path.join(".boss", "project-state.json"));
    const b = durableFileFor(dataRoot, "workspace-a", path.join(".boss", "project-state.json"));
    expect(a).toBe(b);
    // Different workspaces are different files, except the shims, which keep the
    // legacy app-global root so existing single-repo data stays readable.
    expect(durableFileFor(dataRoot, "workspace-b", "x.json")).not.toBe(a);
    expect(durableRootFor(dataRoot, DEFAULT_WORKSPACE_ID)).toBe(dataRoot);
    expect(durableRootFor(dataRoot, SCRATCH_WORKSPACE_ID)).toBe(dataRoot);
    expect(durableRootFor(dataRoot, "workspace-a")).toBe(path.join(dataRoot, "workspaces", "workspace-a"));
  });

  it("has exactly one ThemeService, because it owns the registry cache", () => {
    // Unlike the project-state store, this class DOES cache (`private value`), so a
    // second instance would be a second owner of the registry file.
    const constructions: string[] = [];
    for (const full of sourceFilesUnder(path.join(PROJECT, "electron"))) {
      const relative = path.relative(PROJECT, full).split(path.sep).join("/");
      if (/new ThemeService\(/.test(fs.readFileSync(full, "utf8"))) constructions.push(relative);
    }
    expect(constructions).toEqual(["electron/bootstrap/knowledge.ts"]);
  });

  it("keeps the theme package files and the registry in different hands", () => {
    const storage = read("electron/theme/theme-storage.ts");
    const service = read("electron/theme/theme-service.ts");
    // The storage owns the package directory: it writes the four package files and
    // never touches the registry.
    for (const file of ['"theme.json"', '"tokens.json"', '"overrides.json"', '"metadata.json"']) expect(storage).toContain(file);
    expect(storage).not.toContain("registryFile");
    // The service owns the registry, through the path it was constructed with — the
    // composition root supplies it, which is why this is asserted as an option rather
    // than as a literal in the service.
    expect(service).toContain("registryFile");
    expect(service).toContain("this.options.registryFile");
  });
});
