import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { migrateBrowserProfile, migrateLegacyPersistentData } from "../electron/runtime-paths";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it("verifies a byte-copy fallback when Windows rejects cross-volume CopyFile", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-profile-")); roots.push(root);
  const source = path.join(root, "old"); const dest = path.join(root, "new");
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, "Local State"), "encrypted-cookie-key");
  vi.spyOn(fs, "copyFileSync").mockImplementation(() => { throw Object.assign(new Error("EFS"), { code: "UNKNOWN" }); });
  migrateBrowserProfile(source, dest);
  expect(fs.readFileSync(path.join(dest, "Local State"), "utf8")).toBe("encrypted-cookie-key");
  expect(JSON.parse(fs.readFileSync(path.join(dest, ".codex-boss-profile-ready"), "utf8")).verifiedFiles).toBe(1);
});
it("copies and verifies login storage but excludes only rebuildable caches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-profile-")); roots.push(root);
  const source = path.join(root, "old"); const dest = path.join(root, "new");
  for (const name of ["Local State", "Partitions/grok/Network/Cookies", "Partitions/grok/IndexedDB/data", "Partitions/grok/Cache/data", "GPUCache/data"]) {
    const file = path.join(source, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, name);
  }
  migrateBrowserProfile(source, dest);
  expect(fs.readFileSync(path.join(dest, "Partitions/grok/Network/Cookies"), "utf8")).toBe("Partitions/grok/Network/Cookies");
  expect(fs.existsSync(path.join(dest, "Partitions/grok/IndexedDB/data"))).toBe(true);
  expect(fs.existsSync(path.join(dest, "Partitions/grok/Cache"))).toBe(false);
  expect(fs.existsSync(path.join(dest, "GPUCache"))).toBe(false);
  expect(fs.existsSync(path.join(source, "GPUCache/data"))).toBe(true);
  fs.writeFileSync(path.join(dest, "Local State"), "new-session");
  migrateBrowserProfile(source, dest);
  expect(fs.readFileSync(path.join(dest, "Local State"), "utf8")).toBe("new-session");
});
it("refuses an existing unverified destination", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-profile-")); roots.push(root);
  expect(() => migrateBrowserProfile(path.join(root, "missing"), root)).toThrow("Unverified");
});

it("copies and verifies every persistent legacy data family without deleting its source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-data-migration-")); roots.push(root);
  const source = path.join(root, "legacy"); const destination = path.join(root, "project", "runtime-data"); const history = path.join(root, "project", "history");
  const fixtures = new Map([
    ["state.json", "state-v1"],
    ["api-settings.json", "encrypted-settings"],
    ["task-contexts.json", "task-context"],
    [".boss/tasks/task-1/checkpoint.json", "ledger-evidence"],
    [".boss/runtime-budget.json", "budget"],
    [".boss/recovery.json", "recovery"],
    [".boss/runtime-resources.json", "resources"],
    [".codex-boss/runtimes/codex-cli/context.json", "codex-runtime"],
    ["history/.codex-boss-history-index.json", "history-index"],
    ["history/General/Conversation/messages.md", "accepted answer"]
  ]);
  for (const [relative, content] of fixtures) { const file = path.join(source, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  const report = migrateLegacyPersistentData(source, destination, history)!;
  expect(report.status).toBe("COMPLETE");
  expect(report.copiedFiles).toBe(fixtures.size);
  expect(report.verifiedFiles).toBe(fixtures.size);
  expect(report.migratedEntries).toEqual(["state.json", "api-settings.json", "task-contexts.json", ".boss", ".codex-boss", "history"]);
  for (const [relative, content] of fixtures) {
    const migrated = relative.startsWith("history/") ? path.join(history, relative.slice("history/".length)) : path.join(destination, relative);
    expect(fs.readFileSync(migrated, "utf8")).toBe(content);
    expect(fs.readFileSync(path.join(source, relative), "utf8")).toBe(content);
  }
  const marker = JSON.parse(fs.readFileSync(path.join(destination, ".codex-boss-data-migration-v1.json"), "utf8"));
  expect(marker.status).toBe("COMPLETE");
  expect(migrateLegacyPersistentData(source, destination, history)).toEqual(report);
});

it("preserves a differing legacy file in the D-drive migration backup and never overwrites current data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-data-conflict-")); roots.push(root);
  const source = path.join(root, "legacy"); const destination = path.join(root, "project", "runtime-data");
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(source, "state.json"), "legacy-state");
  fs.writeFileSync(path.join(destination, "state.json"), "current-state");
  const report = migrateLegacyPersistentData(source, destination)!;
  expect(report.status).toBe("COMPLETE_WITH_PRESERVED_CONFLICTS");
  expect(report.preservedConflicts).toEqual(["state.json"]);
  expect(fs.readFileSync(path.join(destination, "state.json"), "utf8")).toBe("current-state");
  expect(fs.readFileSync(path.join(destination, ".migration-backups", "legacy-localappdata-v1", "state.json"), "utf8")).toBe("legacy-state");
  expect(fs.readFileSync(path.join(source, "state.json"), "utf8")).toBe("legacy-state");
});
