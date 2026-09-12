import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Development-plane repo inspector (plan AP04 / §13.3 incremental everything).
 * A bounded, deterministic scan of a workspace that produces a test map and a
 * change fingerprint — the base every later dev-plane tool (symbol/dependency
 * index, semantic slices, targeted test selection) builds on.
 */

export interface RepoSnapshot {
  schemaVersion: 1;
  scannedAt: string;
  root: string;
  /** Relative paths of every tracked file, sorted. */
  files: string[];
  /** Test files (relative), grouped by their directory. */
  testMap: Record<string, string[]>;
  skippedDirectories: number;
  /** sha256 over the sorted file list; changes when the index must refresh. */
  fingerprint: string;
}

const SKIPPED_DIRECTORIES = new Set(["node_modules", "artifacts", "dist", "dist-electron", "runtime-data", "history", "coverage", ".git", ".cache", ".codex-boss", ".codex-controller"]);
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const MAX_ENTRIES = 50000;

/** Platform-independent relative path so inventories/fingerprints are stable. */
function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

export function discoverTestFiles(root: string): string[] {
  const snapshot = scanRepo(root);
  return Object.values(snapshot.testMap).flat();
}

/* ------------------------------------------------------------------ *
 * Bounded repository world model (checkpoint-1 §5)
 * ------------------------------------------------------------------ */

const MANIFEST_NAMES = new Set([
  "package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "tsconfig.json", "tsconfig.electron.json",
  "vite.config.mjs", "vite.config.ts", "vitest.config.mjs", "vitest.config.ts", "pyproject.toml", "requirements.txt",
  "setup.py", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json",
  "Makefile", "CMakeLists.txt", "Dockerfile", "docker-compose.yml", ".github/workflows/ci.yml"
]);
const ENTRY_NAMES = new Set([
  "index.html", "index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs",
  "main.ts", "main.tsx", "main.js", "main.mjs", "main.cjs", "main.py", "app.py", "manage.py", "main.go", "Main.java", "Program.cs"
]);
const UI_DIRECTORIES = ["renderer", "ui", "web", "frontend", "components", "views", "pages", "styles", "themes", "assets"];
const UI_EXTENSIONS = new Set([".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".sass", ".less", ".html"]);
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".rb": "Ruby", ".cs": "C#", ".php": "PHP",
  ".css": "CSS", ".scss": "CSS", ".less": "CSS", ".html": "HTML", ".vue": "Vue", ".svelte": "Svelte",
  ".md": "Markdown", ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML", ".sql": "SQL",
  ".sh": "Shell", ".ps1": "PowerShell"
};
const MODEL_LIMITS = { topLevel: 24, manifests: 12, entryPoints: 12, testFiles: 40, uiFiles: 40, languages: 6 };

/** Generated/derived directories the scanner skips, with the reason to report. */
export const GENERATED_DIRECTORIES: ReadonlyArray<{ path: string; reason: string }> = [
  { path: "node_modules", reason: "installed dependencies" },
  { path: "dist", reason: "build output" },
  { path: "dist-electron", reason: "compiled electron output" },
  { path: "artifacts", reason: "generated acceptance evidence" },
  { path: "runtime-data", reason: "application runtime state" },
  { path: "history", reason: "archived conversation history" },
  { path: "coverage", reason: "test coverage output" },
  { path: ".cache", reason: "content/scan cache" },
  { path: ".codex-boss", reason: "tool state" },
  { path: ".codex-controller", reason: "tool state" }
];

/** Languages observed by file extension (shared by the model and the scanner). */
export function languageOfFile(file: string): string | undefined {
  return LANGUAGE_BY_EXTENSION[extensionOf(file)];
}

/** True for files that look like a process/program entry point. */
export function isEntryPointFile(file: string): boolean {
  const base = file.split("/").pop() ?? "";
  return ENTRY_NAMES.has(base) || /^electron\/main\.[cm]?[jt]s$/.test(file);
}

function extensionOf(file: string): string {
  const match = /\.[A-Za-z0-9]+$/.exec(file);
  return match ? match[0].toLocaleLowerCase() : "";
}

function isUiSurfaceFile(file: string): boolean {
  const segments = file.split("/");
  const inUiDirectory = segments.some((segment) => UI_DIRECTORIES.includes(segment.toLocaleLowerCase()));
  return inUiDirectory || UI_EXTENSIONS.has(extensionOf(file));
}

/**
 * Derives the reusable repository model from an existing scan. Nothing is read
 * twice: the caller already paid for the scan, and every list is capped so a
 * huge repository cannot flood a durable record or a prompt.
 */
export function repositoryModelFrom(snapshot: RepoSnapshot): import("../../src/shared/workbook-dispatch").RepositoryModelSummary {
  const topLevel = new Set<string>();
  const manifests: string[] = [];
  const entryPoints: string[] = [];
  const uiFiles: string[] = [];
  const languageCounts = new Map<string, number>();

  for (const file of snapshot.files) {
    const segments = file.split("/");
    topLevel.add(segments[0]);
    const base = segments[segments.length - 1];
    if (MANIFEST_NAMES.has(base) || file.startsWith(".github/workflows/")) manifests.push(file);
    if (ENTRY_NAMES.has(base) || /^electron\/main\.[cm]?[jt]s$/.test(file)) entryPoints.push(file);
    if (isUiSurfaceFile(file)) uiFiles.push(file);
    const language = LANGUAGE_BY_EXTENSION[extensionOf(file)];
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
  }

  const testFiles = Object.values(snapshot.testMap).flat().sort((a, b) => a.localeCompare(b));
  const languages = [...languageCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([language]) => language);

  const cap = <T>(values: T[], limit: number): T[] => values.slice(0, limit);
  const topLevelList = [...topLevel].sort((a, b) => a.localeCompare(b));
  const model = {
    schemaVersion: 1 as const,
    top_level: cap(topLevelList, MODEL_LIMITS.topLevel),
    manifests: cap(manifests.sort((a, b) => a.localeCompare(b)), MODEL_LIMITS.manifests),
    entry_points: cap(entryPoints.sort((a, b) => a.localeCompare(b)), MODEL_LIMITS.entryPoints),
    test_files: cap(testFiles, MODEL_LIMITS.testFiles),
    ui_surface_files: cap(uiFiles.sort((a, b) => a.localeCompare(b)), MODEL_LIMITS.uiFiles),
    languages: cap(languages, MODEL_LIMITS.languages),
    truncated: topLevelList.length > MODEL_LIMITS.topLevel
      || manifests.length > MODEL_LIMITS.manifests
      || entryPoints.length > MODEL_LIMITS.entryPoints
      || testFiles.length > MODEL_LIMITS.testFiles
      || uiFiles.length > MODEL_LIMITS.uiFiles
      || languages.length > MODEL_LIMITS.languages
  };
  return model;
}

/**
 * Targeted test selection seed (plan AP04): given changed files, return the
 * tests that live in the same directory or any of its subdirectories. When a
 * changed file has no co-located tests, nothing is returned so the caller can
 * decide whether to widen to the full map.
 */
export function selectTestsForFiles(snapshot: RepoSnapshot, changedFiles: string[]): string[] {
  const candidates = new Set<string>();
  for (const file of changedFiles) {
    const dir = path.posix.dirname(file.replace(/\\/g, "/"));
    for (const [testDir, tests] of Object.entries(snapshot.testMap)) {
      if (testDir === dir || testDir.startsWith(dir === "." ? "" : dir + "/")) for (const test of tests) candidates.add(test);
    }
  }
  return [...candidates].sort((a, b) => a.localeCompare(b));
}

/** Bounded recursive walk; symlinks and hidden/dependency trees are skipped. */
export function scanRepo(root: string, now = Date.now): RepoSnapshot {
  const realRoot = fs.realpathSync(root);
  const files: string[] = [];
  const testMap: Record<string, string[]> = {};
  let entries = 0;
  let skippedDirectories = 0;

  const visit = (relative: string) => {
    let directoryEntries: fs.Dirent[];
    try {
      directoryEntries = fs.readdirSync(path.join(realRoot, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of directoryEntries) {
      if (++entries > MAX_ENTRIES) throw new Error("Repo scan exceeds entry budget");
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) { skippedDirectories += 1; continue; }
        visit(relative ? path.join(relative, entry.name) : entry.name);
        continue;
      }
      if (!entry.isFile()) continue;
      const joined = relative ? path.join(relative, entry.name) : entry.name;
      const file = toPosix(joined);
      files.push(file);
      if (TEST_FILE_PATTERN.test(entry.name)) {
        const dir = toPosix(relative || ".");
        (testMap[dir] ??= []).push(file);
      }
    }
  };
  visit(".");

  files.sort((a, b) => a.localeCompare(b));
  for (const key of Object.keys(testMap)) testMap[key].sort((a, b) => a.localeCompare(b));
  const fingerprint = createHash("sha256").update(files.join("\n"), "utf8").digest("hex");
  return { schemaVersion: 1, scannedAt: new Date(now()).toISOString(), root: realRoot, files, testMap, skippedDirectories, fingerprint };
}
