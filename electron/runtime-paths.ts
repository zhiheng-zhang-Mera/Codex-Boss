import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Only rebuildable Chromium caches. Cookies, Local State, IndexedDB and storage
// are deliberately NOT in this list.
export const REBUILDABLE_CACHE_NAMES = new Set([
  "Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache",
  "DawnWebGPUCache", "GrShaderCache", "GraphiteDawnCache", "ShaderCache",
  "CacheStorage", "ScriptCache"
]);

export function migrateBrowserProfile(source: string, destination: string): void {
  const marker = path.join(destination, ".codex-boss-profile-ready");
  if (fs.existsSync(marker)) return;
  if (fs.existsSync(destination)) throw new Error(`Unverified browser profile exists: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), ".profile-migration-"));
  const copied: Array<[string, string]> = [];
  const copy = (from: string, to: string) => {
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error(`Refusing linked profile path: ${from}`);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) {
        if (!REBUILDABLE_CACHE_NAMES.has(name)) copy(path.join(from, name), path.join(to, name));
      }
    } else if (stat.isFile()) {
      try { fs.copyFileSync(from, to); }
      catch (error) {
        // Windows EFS / redirected profiles can reject CopyFile across volumes.
        // Read through the current user's filesystem access, then verify below.
        const code = (error as NodeJS.ErrnoException).code;
        if (!["UNKNOWN", "EXDEV", "ENOTSUP"].includes(code ?? "")) throw error;
        fs.writeFileSync(to, fs.readFileSync(from));
      }
      copied.push([from, to]);
    }
  };
  if (fs.existsSync(source)) copy(source, staging);
  const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  for (const [from, to] of copied) {
    if (hash(from) !== hash(to)) throw new Error(`Profile verification failed: ${from}`);
  }
  fs.writeFileSync(path.join(staging, ".codex-boss-profile-ready"), JSON.stringify({ version: 1, verifiedFiles: copied.length }));
  fs.renameSync(staging, destination);
}
