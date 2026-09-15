import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

interface PersistentDataMigrationReport {
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

/* -------------------------------------------------------------------------- */
/* §5 step 4 — the runtime roots Boss may create beside the checkout           */
/* -----------------------------------------------------------------───────── */

/**
 * `runtimeDataPath`: the app's own durable state (state.json, the task ledger,
 * knowledge, themes, project state, session data). In development this is
 * `<checkout>/runtime-data`; a packaged build gets its own userData directory.
 * It is never the workspace and never the user's project.
 */
const RUNTIME_DATA_DIRECTORY = "runtime-data";
/** Scratch: redirectable caches and the in-app TEMP redirection target. */
const SCRATCH_CACHE_DIRECTORY = ".cache";
/** Conversation export/history files written beside the checkout when not packaged. */
export const HISTORY_DIRECTORY = "history";
/** Acceptance evidence and build reports (`artifacts/acceptance`, soak, benchmarks). */
const ACCEPTANCE_ARTIFACTS_DIRECTORY = "artifacts";

/* -------------------------------------------------------------------------- */
/* The root model: one place turns a root into the directories Boss owns       */
/* -------------------------------------------------------------------------- */

/** `<root>/runtime-data` — the app data directory under any root. */
export function appDataUnder(root: string): string {
  return path.join(root, RUNTIME_DATA_DIRECTORY);
}
/** `<root>/.cache` — disposable caches under any root. */
export function cacheUnder(root: string): string {
  return path.join(root, SCRATCH_CACHE_DIRECTORY);
}
/** `<root>/history` — archived conversation history under any root. */
function historyUnder(root: string): string {
  return path.join(root, HISTORY_DIRECTORY);
}
/** `<root>/artifacts/acceptance` — acceptance evidence under any root. */
function acceptanceUnder(root: string): string {
  return path.join(root, ACCEPTANCE_ARTIFACTS_DIRECTORY, "acceptance");
}
/** `<root>/artifacts` — the build/evidence output directory under any root. */
function artifactsUnder(root: string): string {
  return path.join(root, ACCEPTANCE_ARTIFACTS_DIRECTORY);
}

/**
 * The resolved roots of one running instance.
 *
 * Every subsystem that needs to store something reads it from here instead of
 * joining its own directory onto the install path. That is what makes a move to
 * `%LOCALAPPDATA%`, a portable data directory or a container mount a change to
 * *this module* rather than a hunt through the codebase for `path.join(appPath, …)`.
 *
 * - `installRoot`  the checkout/installation the process runs from. Never a user
 *                  workspace, and never a place user work is written to.
 * - `appData`      durable state: state.json, `.boss/**` (ledgers, knowledge,
 *                  themes, attachments, research cache), `Session Data`.
 * - `cache`        disposable: browser profile, `tmp`, crash dumps.
 * - `history`      archived conversation history and exports.
 * - `acceptance`   acceptance evidence (`artifacts/acceptance`).
 * - `research`     the research work root under `appData`.
 * - `temp`         the app's `TEMP` redirection target under `cache`.
 *
 * All of them except `installRoot` live under `dataRootOverride` when one was
 * given (`--boss-data-dir=…`), which is what isolates one acceptance run from the
 * developer's own state.
 */
export interface RuntimeRoots {
  installRoot: string;
  appData: string;
  cache: string;
  history: string;
  acceptance: string;
  research: string;
  temp: string;
}

export function runtimeRoots(input: { installRoot: string; dataRootOverride?: string }): RuntimeRoots {
  const installRoot = path.resolve(input.installRoot);
  const override = input.dataRootOverride ? path.resolve(input.dataRootOverride) : undefined;
  const beside = override ?? installRoot;
  const appData = override ?? appDataUnder(installRoot);
  const cache = cacheUnder(beside);
  return {
    installRoot,
    appData,
    cache,
    history: historyUnder(beside),
    acceptance: acceptanceUnder(beside),
    research: path.join(appData, ".boss", "research"),
    temp: path.join(cache, "tmp")
  };
}

/**
 * Every path Boss may create inside the directory it runs from, as repository
 * relative POSIX-style paths.
 *
 * Update-Plan/cleaning.md §5 step 4: runtime scratch must never be scattered
 * into the source tree. This list is the declaration the guard test checks
 * against the real repository: each path must be ignored by git and must own no
 * tracked file, so a new runtime root that would ship untracked files into a
 * user's checkout fails that test instead of being discovered later.
 *
 * `.boss/worktrees/` and `.boss/tmp/` are the exception in shape only: Boss
 * creates them when the workspace IS this checkout (isolated engineering
 * worktrees), so they are listed by their exact paths rather than by `.boss/`,
 * which is the app's own data directory under `<userData>`, not a checkout root.
 */
export const RUNTIME_OWNED_PATHS: readonly string[] = [
  `${RUNTIME_DATA_DIRECTORY}/`,
  `${SCRATCH_CACHE_DIRECTORY}/`,
  `${HISTORY_DIRECTORY}/`,
  `${ACCEPTANCE_ARTIFACTS_DIRECTORY}/`,
  "evolution/",
  "live-acceptance/",
  ".live-acceptance/",
  "research-output/",
  ".boss/worktrees/",
  ".boss/tmp/"
];


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
const REBUILDABLE_CACHE_NAMES = new Set([
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
