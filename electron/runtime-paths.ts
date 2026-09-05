import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export interface PersistentDataMigrationReport {
  version: 1;
  sourceRoot: string;
  destinationRoot: string;
  historyDestination: string;
  status: "COMPLETE" | "COMPLETE_WITH_PRESERVED_CONFLICTS";
  copiedFiles: number;
  verifiedFiles: number;
  identicalFiles: number;
  preservedConflicts: string[];
  migratedEntries: string[];
  completedAt: string;
}

const PERSISTENT_DATA_ENTRIES = ["state.json", "api-settings.json", "task-contexts.json", ".boss", ".codex-boss"] as const;

function fileHash(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function copyFileVerified(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.migration-${process.pid}-${Date.now()}`;
  try {
    try { fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["UNKNOWN", "EXDEV", "ENOTSUP"].includes(code ?? "")) throw error;
      fs.writeFileSync(temporary, fs.readFileSync(source), { flag: "wx" });
    }
    if (fileHash(source) !== fileHash(temporary)) throw new Error(`Persistent data verification failed: ${source}`);
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

/**
 * Copies every persistent pre-v1 data family without deleting the source or
 * overwriting a newer destination. Differing destination files preserve the
 * legacy copy under the D-drive data root for explicit reconciliation.
 */
export function migrateLegacyPersistentData(sourceRoot: string, destinationRoot: string, historyDestination = path.join(destinationRoot, "history")): PersistentDataMigrationReport | undefined {
  if (!fs.existsSync(sourceRoot)) return undefined;
  const marker = path.join(destinationRoot, ".codex-boss-data-migration-v1.json");
  if (fs.existsSync(marker)) {
    const report = JSON.parse(fs.readFileSync(marker, "utf8")) as PersistentDataMigrationReport;
    if (report.version !== 1) throw new Error(`Unsupported persistent data migration marker: ${report.version}`);
    return report;
  }
  fs.mkdirSync(destinationRoot, { recursive: true });
  const conflictRoot = path.join(destinationRoot, ".migration-backups", "legacy-localappdata-v1");
  let copiedFiles = 0;
  let verifiedFiles = 0;
  let identicalFiles = 0;
  const preservedConflicts: string[] = [];
  const migratedEntries: string[] = [];

  const migrate = (source: string, destination: string, relativeName: string): void => {
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) throw new Error(`Refusing linked persistent data path: ${source}`);
    if (sourceStat.isDirectory()) {
      if (fs.existsSync(destination) && !fs.lstatSync(destination).isDirectory()) {
        const preserved = path.join(conflictRoot, relativeName);
        copyTreeToConflict(source, preserved, relativeName);
        return;
      }
      fs.mkdirSync(destination, { recursive: true });
      for (const name of fs.readdirSync(source)) migrate(path.join(source, name), path.join(destination, name), path.join(relativeName, name));
      return;
    }
    if (!sourceStat.isFile()) throw new Error(`Unsupported persistent data entry: ${source}`);
    if (!fs.existsSync(destination)) {
      copyFileVerified(source, destination);
      copiedFiles += 1;
      verifiedFiles += 1;
      return;
    }
    const destinationStat = fs.lstatSync(destination);
    if (destinationStat.isSymbolicLink()) throw new Error(`Refusing linked persistent destination: ${destination}`);
    if (destinationStat.isFile() && fileHash(source) === fileHash(destination)) {
      identicalFiles += 1;
      verifiedFiles += 1;
      return;
    }
    const preserved = path.join(conflictRoot, relativeName);
    copyTreeToConflict(source, preserved, relativeName);
  };

  const copyTreeToConflict = (source: string, destination: string, relativeName: string): void => {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error(`Refusing linked persistent data path: ${source}`);
    if (stat.isDirectory()) {
      fs.mkdirSync(destination, { recursive: true });
      for (const name of fs.readdirSync(source)) copyTreeToConflict(path.join(source, name), path.join(destination, name), path.join(relativeName, name));
      return;
    }
    if (!stat.isFile()) throw new Error(`Unsupported persistent data entry: ${source}`);
    if (fs.existsSync(destination)) {
      if (!fs.lstatSync(destination).isFile() || fileHash(source) !== fileHash(destination)) throw new Error(`Migration conflict backup already differs: ${destination}`);
    } else copyFileVerified(source, destination);
    verifiedFiles += 1;
    if (!preservedConflicts.includes(relativeName)) preservedConflicts.push(relativeName);
  };

  for (const name of PERSISTENT_DATA_ENTRIES) {
    const source = path.join(sourceRoot, name);
    if (!fs.existsSync(source)) continue;
    migrate(source, path.join(destinationRoot, name), name);
    migratedEntries.push(name);
  }
  const legacyHistory = path.join(sourceRoot, "history");
  if (fs.existsSync(legacyHistory)) {
    migrate(legacyHistory, historyDestination, "history");
    migratedEntries.push("history");
  }
  const report: PersistentDataMigrationReport = {
    version: 1,
    sourceRoot,
    destinationRoot,
    historyDestination,
    status: preservedConflicts.length ? "COMPLETE_WITH_PRESERVED_CONFLICTS" : "COMPLETE",
    copiedFiles,
    verifiedFiles,
    identicalFiles,
    preservedConflicts,
    migratedEntries,
    completedAt: new Date().toISOString()
  };
  const temporaryMarker = `${marker}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryMarker, JSON.stringify(report, null, 2), { flag: "wx" });
  fs.renameSync(temporaryMarker, marker);
  return report;
}

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
  for (const [from, to] of copied) {
    if (fileHash(from) !== fileHash(to)) throw new Error(`Profile verification failed: ${from}`);
  }
  fs.writeFileSync(path.join(staging, ".codex-boss-profile-ready"), JSON.stringify({ version: 1, verifiedFiles: copied.length }));
  fs.renameSync(staging, destination);
}
