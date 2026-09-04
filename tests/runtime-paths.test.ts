import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { migrateBrowserProfile } from "../electron/runtime-paths";

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
