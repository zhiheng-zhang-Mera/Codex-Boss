/**
 * Update-Plan/checkpoint-1.md §6.1 — the host-side Repository World Model builder.
 *
 * Reads a workspace once, deterministically and under hard caps, and produces
 * the `RepoWorldModel` contract from src/shared/repo-world-model.ts: layout,
 * package managers, languages, entry points, tests, CI, build system, runtimes,
 * git state, generated/ignored surfaces and workspace boundaries, plus the
 * module/import facts the §6.2 dependency graph is derived from.
 *
 * Deliberate properties:
 *   - bounded: capped files, capped bytes, capped imports per file, so a huge or
 *     hostile repository cannot turn discovery into a hang;
 *   - fail-soft per probe: a missing git binary or an unreadable directory
 *     degrades one field with a reason instead of failing the whole model;
 *   - no model, no network: every field is read off the disk or from git.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  GENERATED_DIRECTORIES,
  isEntryPointFile,
  languageOfFile,
  scanRepo,
  type RepoSnapshot
} from "./repo-inspector";
import {
  buildDependencyGraph,
  summarizeWorldModel,
  worldModelIdFor,
  REPO_WORLD_MODEL_VERSION,
  type DependencyGraph,
  type ModuleKind,
  type ModuleNode,
  type RepoWorldModel,
  type WorldModelSummary
} from "../../src/shared/repo-world-model";
import { writeJson, readJson } from "../commander/durable-json";

export interface WorldModelLimits {
  /** Source files whose imports/exports are read (the model still lists all). */
  moduleFiles: number;
  bytesPerFile: number;
  totalBytes: number;
  importsPerFile: number;
  entries: number;
}

export const DEFAULT_WORLD_MODEL_LIMITS: WorldModelLimits = {
  moduleFiles: 400,
  bytesPerFile: 96 * 1024,
  totalBytes: 3 * 1024 * 1024,
  importsPerFile: 80,
  entries: 12
};

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".cs", ".rb", ".php"]);
const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);
const MARKUP_EXTENSIONS = new Set([".html", ".htm", ".vue", ".svelte"]);
const CONFIG_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".conf", ".properties", ".editorconfig"]);
const LOCKFILE_MANAGERS: ReadonlyArray<{ file: string; manager: string }> = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "package-lock.json", manager: "npm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lockb", manager: "bun" },
  { file: "uv.lock", manager: "uv" },
  { file: "poetry.lock", manager: "poetry" },
  { file: "Pipfile.lock", manager: "pipenv" },
  { file: "Cargo.lock", manager: "cargo" },
  { file: "go.sum", manager: "go" },
  { file: "Gemfile.lock", manager: "bundler" },
  { file: "composer.lock", manager: "composer" }
];
const MANIFEST_MANAGERS: ReadonlyArray<{ file: string; manager: string }> = [
  { file: "package.json", manager: "npm" },
  { file: "pyproject.toml", manager: "python" },
  { file: "requirements.txt", manager: "pip" },
  { file: "Cargo.toml", manager: "cargo" },
  { file: "go.mod", manager: "go" },
  { file: "pom.xml", manager: "maven" },
  { file: "build.gradle", manager: "gradle" },
  { file: "Gemfile", manager: "bundler" },
  { file: "composer.json", manager: "composer" }
];
const BUILD_TOOLS: ReadonlyArray<{ file: (name: string) => boolean; tool: string }> = [
  { file: (name) => name === "tsconfig.json" || name.startsWith("tsconfig."), tool: "tsc" },
  { file: (name) => name.startsWith("vite.config."), tool: "vite" },
  { file: (name) => name.startsWith("vitest.config."), tool: "vitest" },
  { file: (name) => name.startsWith("webpack.config."), tool: "webpack" },
  { file: (name) => name.startsWith("rollup.config."), tool: "rollup" },
  { file: (name) => name.startsWith("esbuild") || name === "esbuild.mjs", tool: "esbuild" },
  { file: (name) => name === "Makefile" || name === "makefile", tool: "make" },
  { file: (name) => name === "CMakeLists.txt", tool: "cmake" },
  { file: (name) => name === "Dockerfile", tool: "docker" },
  { file: (name) => name === "turbo.json", tool: "turborepo" },
  { file: (name) => name === "nx.json", tool: "nx" }
];
const WORKSPACE_MARKERS = ["pnpm-workspace.yaml", "lerna.json", "nx.json", "turbo.json", "rush.json", "go.work"];
const IGNORE_FILES = [".gitignore", ".npmignore", ".dockerignore", ".eslintignore", ".prettierignore", ".git/info/exclude"];
const CI_LOCATIONS: ReadonlyArray<{ provider: string; test: (relative: string) => boolean }> = [
  { provider: "github-actions", test: (relative) => relative.startsWith(".github/workflows/") && /\.ya?ml$/i.test(relative) },
  { provider: "gitlab-ci", test: (relative) => relative === ".gitlab-ci.yml" },
  { provider: "azure-pipelines", test: (relative) => relative === "azure-pipelines.yml" },
  { provider: "circleci", test: (relative) => relative === ".circleci/config.yml" },
  { provider: "jenkins", test: (relative) => relative === "Jenkinsfile" },
  { provider: "buildkite", test: (relative) => relative === ".buildkite/pipeline.yml" }
];
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "dns", "domain", "events",
  "fs", "http", "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode",
  "querystring", "readline", "repl", "stream", "string_decoder", "timers", "tls", "trace_events", "tty", "url", "util",
  "v8", "vm", "wasi", "worker_threads", "zlib"
]);

export interface BuildWorldModelOptions {
  limits?: Partial<WorldModelLimits>;
  now?: () => string;
  /** Injected for tests; defaults to the real bounded scan. */
  scan?: (root: string) => RepoSnapshot;
  /** Injected for tests; defaults to reading git synchronously. */
  git?: (root: string) => RepoWorldModel["git"];
}

const IMPORT_PATTERNS: readonly RegExp[] = [
  /\bimport\s+[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];
const EXPORT_PATTERNS: readonly RegExp[] = [
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s*\{\s*([^}]+)\}/g,
  /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/gm,
  /\bexports\.([A-Za-z_$][\w$]*)\s*=/g
];

/**
 * Removes line and block comments while preserving string literals, so a
 * commented-out import is not recorded as a real dependency (and a `//` inside a
 * string is not mistaken for a comment). Deterministic, no parser dependency.
 */
export function stripComments(content: string): string {
  const out: string[] = [];
  let index = 0;
  let quote: string | undefined;
  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];
    if (quote) {
      out.push(char);
      if (char === "\\" && index + 1 < content.length) { out.push(content[index + 1]); index += 2; continue; }
      if (char === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < content.length && content[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; out.push(char); index += 1; continue; }
    out.push(char);
    index += 1;
  }
  return out.join("");
}

/** Extracts import specifiers from source text (deterministic, ordered, unique). */
export function extractImportSpecifiers(content: string, limit: number): string[] {
  const source = stripComments(content);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags);
    for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
      const specifier = match[1]?.trim();
      if (!specifier || seen.has(specifier)) continue;
      seen.add(specifier);
      found.push(specifier);
      if (found.length >= limit) return found;
    }
  }
  return found;
}

/** Extracts exported symbol names from source text. */
export function extractExportedSymbols(content: string): string[] {
  const source = stripComments(content);
  const symbols = new Set<string>();
  for (const pattern of EXPORT_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags);
    for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
      const captured = match[1] ?? "";
      if (pattern.source.includes("\\{")) {
        for (const piece of captured.split(",")) {
          const name = piece.split(" as ").pop()?.trim().replace(/^type\s+/, "") ?? "";
          if (/^[A-Za-z_$][\w$]*$/.test(name)) symbols.add(name);
        }
        continue;
      }
      for (const word of captured.split(/[\s,]+/)) if (/^[A-Za-z_$][\w$]*$/.test(word)) symbols.add(word);
    }
  }
  return [...symbols].sort((a, b) => a.localeCompare(b)).slice(0, 200);
}

function classificationFor(relative: string, fingerprintSet: Set<string>): ModuleKind {
  const extension = path.posix.extname(relative).toLocaleLowerCase();
  if (GENERATED_DIRECTORIES.some((entry) => relative === entry.path || relative.startsWith(`${entry.path}/`))) return "GENERATED";
  if (fingerprintSet.has(relative)) return "TEST";
  if (STYLE_EXTENSIONS.has(extension)) return "STYLE";
  if (MARKUP_EXTENSIONS.has(extension)) return "MARKUP";
  if (CODE_EXTENSIONS.has(extension)) return "SOURCE";
  if (path.posix.basename(relative) === "package.json" || extension === ".lock" || relative.endsWith("lock.yaml") || relative.endsWith("lock.json")) return "MANIFEST";
  if (CONFIG_EXTENSIONS.has(extension)) return "CONFIG";
  return "OTHER";
}

/**
 * Resolves a specifier against the repository's file set (extension/index aware).
 *
 * A `./helper.js` specifier is resolved to `helper.ts` as well, because that is
 * how ESM-authored TypeScript references its own modules.
 */
export function resolveSpecifier(fromFile: string, specifier: string, files: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  // A trailing slash (`./` or `../`) means "the directory's index".
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)).replace(/\/+$/, "");
  const withoutExtension = base.replace(/\.(?:js|mjs|cjs|jsx)$/, "");
  const candidates = [
    base,
    ...EXTENSION_CANDIDATES.map((extension) => `${base}${extension}`),
    ...EXTENSION_CANDIDATES.map((extension) => `${withoutExtension}${extension}`),
    ...INDEX_CANDIDATES.map((candidate) => `${base}${candidate}`),
    ...INDEX_CANDIDATES.map((candidate) => `${withoutExtension}${candidate}`)
  ];
  return candidates.find((candidate) => files.has(candidate));
}

const EXTENSION_CANDIDATES = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".py", ".css"];
const INDEX_CANDIDATES = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs", "/index.cjs"];

function isBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  const base = specifier.split("/")[0];
  return NODE_BUILTINS.has(base);
}

function detectPackageManagers(files: ReadonlySet<string>): string[] {
  const managers = new Set<string>();
  for (const entry of LOCKFILE_MANAGERS) if (files.has(entry.file)) managers.add(entry.manager);
  for (const entry of MANIFEST_MANAGERS) if (files.has(entry.file)) managers.add(entry.manager);
  return [...managers].sort();
}

function detectBuildSystem(files: ReadonlyArray<string>, root: string): { tool: string; evidence: string[] }[] {
  const byTool = new Map<string, Set<string>>();
  for (const file of files) {
    const base = path.posix.basename(file);
    for (const entry of BUILD_TOOLS) {
      if (!entry.file(base)) continue;
      (byTool.get(entry.tool) ?? byTool.set(entry.tool, new Set()).get(entry.tool)!).add(file);
    }
  }
  // package.json scripts are build-system evidence too (typecheck/test/build).
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    for (const name of Object.keys(manifest.scripts ?? {})) {
      if (!/build|test|typecheck|lint|package|bundle/i.test(name)) continue;
      (byTool.get("npm-scripts") ?? byTool.set("npm-scripts", new Set()).get("npm-scripts")!).add(`package.json#scripts.${name}`);
    }
  } catch { /* no package.json is not an error */ }
  return [...byTool.entries()].map(([tool, evidence]) => ({ tool, evidence: [...evidence].sort() })).sort((a, b) => a.tool.localeCompare(b.tool));
}

function detectRuntimes(files: ReadonlySet<string>, buildSystem: { tool: string }[], root: string): string[] {
  const runtimes = new Set<string>();
  if (files.has("package.json")) {
    runtimes.add("node");
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      if (manifest.dependencies?.electron || manifest.devDependencies?.electron) runtimes.add("electron");
      if (manifest.dependencies?.react || manifest.devDependencies?.react) runtimes.add("browser");
    } catch { /* unreadable manifest keeps the node default */ }
  }
  if ([...files].some((file) => /\.html?$/i.test(file))) runtimes.add("browser");
  if (files.has("pyproject.toml") || files.has("requirements.txt")) runtimes.add("python");
  if (files.has("go.mod")) runtimes.add("go");
  if (files.has("Cargo.toml")) runtimes.add("rust");
  if (buildSystem.some((entry) => entry.tool === "docker")) runtimes.add("container");
  return [...runtimes].sort();
}

/**
 * CI detection. `scanRepo` skips dot-directories, so CI is read directly — but
 * only from the known provider locations, which keeps this cheap and
 * deterministic (a general dot-directory walk hits its budget on a large tree
 * long before it reaches `.github`, and then reports "no CI" — a false claim).
 */
function detectCi(root: string): { provider: string; files: string[] }[] {
  const found = new Map<string, Set<string>>();
  const record = (provider: string, file: string): void => {
    (found.get(provider) ?? found.set(provider, new Set()).get(provider)!).add(file);
  };
  const list = (relative: string): string[] => {
    try { return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name); }
    catch { return []; }
  };
  for (const name of list(".")) {
    for (const location of CI_LOCATIONS) if (location.test(name)) record(location.provider, name);
  }
  for (const name of list(".github/workflows")) {
    if (/\.ya?ml$/i.test(name)) record("github-actions", `.github/workflows/${name}`);
  }
  for (const name of list(".circleci")) if (name === "config.yml") record("circleci", `.circleci/${name}`);
  for (const name of list(".buildkite")) if (name === "pipeline.yml") record("buildkite", `.buildkite/${name}`);
  for (const name of list(".github")) if (name === "dependabot.yml") record("github-dependabot", `.github/${name}`);
  return [...found.entries()].map(([provider, files]) => ({ provider, files: [...files].sort() })).sort((a, b) => a.provider.localeCompare(b.provider));
}

function detectWorkspace(root: string, files: ReadonlyArray<string>): RepoWorldModel["workspace"] {
  const evidence: string[] = [];
  const packages: { path: string; name?: string }[] = [];
  for (const marker of WORKSPACE_MARKERS) if (files.includes(marker)) evidence.push(marker);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { workspaces?: unknown };
    if (manifest.workspaces) evidence.push("package.json#workspaces");
  } catch { /* no manifest */ }
  if (evidence.length) {
    for (const file of files) {
      if (path.posix.basename(file) !== "package.json" || file === "package.json") continue;
      if (packages.length >= 50) break;
      const directory = path.posix.dirname(file);
      let name: string | undefined;
      try { name = (JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as { name?: string }).name; } catch { name = undefined; }
      packages.push(name ? { path: directory, name } : { path: directory });
    }
    return { kind: "MONOREPO", packages, evidence };
  }
  return { kind: "SINGLE", packages: [{ path: "." }], evidence: ["single package root: no workspace marker found"] };
}

/** Synchronous, bounded git state; a missing git binary degrades, never fails. */
export function readGitState(root: string): RepoWorldModel["git"] {
  const run = (args: string[]): string | undefined => {
    try {
      return execFileSync("git", args, { cwd: root, windowsHide: true, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return undefined;
    }
  };
  const head = run(["rev-parse", "HEAD"]);
  if (!head) return { is_repository: false, reason: "git rev-parse HEAD failed (not a repository, or git is unavailable)" };
  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = run(["status", "--porcelain=v1", "-uno"]);
  const dirty = status === undefined ? undefined : status.split("\n").filter((line) => line.trim().length > 0).length;
  const state: RepoWorldModel["git"] = { is_repository: true, head };
  if (branch) state.branch = branch;
  if (dirty !== undefined) state.dirty_files = dirty;
  return state;
}

/**
 * Builds the world model for one workspace. Deterministic for a fixed tree: the
 * id is derived from the repository fingerprint, the module count and the build
 * timestamp the caller supplies.
 */
export function buildWorldModel(root: string, options: BuildWorldModelOptions = {}): RepoWorldModel {
  const limits: WorldModelLimits = { ...DEFAULT_WORLD_MODEL_LIMITS, ...(options.limits ?? {}) };
  const now = options.now ?? (() => new Date().toISOString());
  const scan = options.scan ?? scanRepo;
  const snapshot = scan(root);
  const fileSet = new Set(snapshot.files);
  const tests = Object.values(snapshot.testMap).flat().sort((a, b) => a.localeCompare(b));
  const testSet = new Set(tests);
  const entryPoints = snapshot.files.filter(isEntryPointFile).slice(0, limits.entries);

  const languageCounts = new Map<string, number>();
  for (const file of snapshot.files) {
    const language = languageOfFile(file);
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
  }
  const languages = [...languageCounts.entries()].map(([language, files]) => ({ language, files })).sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));

  const buildSystem = detectBuildSystem(snapshot.files, root);
  const ci = detectCi(root);
  const generated = GENERATED_DIRECTORIES.map((entry) => ({ path: entry.path, present: fs.existsSync(path.join(root, entry.path)), reason: entry.reason }));
  const ignoreFiles = IGNORE_FILES.filter((file) => fs.existsSync(path.join(root, file)));

  let truncated = false;
  let budget = limits.totalBytes;
  const modules: ModuleNode[] = [];
  // The cap must not decide WHAT the model is about: stylesheets, markup,
  // entry points and manifests are what §6.1/§9 need, so they are read first and
  // the remaining budget goes to ordinary sources in path order.
  const priority = (file: string): number => {
    const kind = classificationFor(file, testSet);
    if (kind === "STYLE" || kind === "MARKUP") return 0;
    if (isEntryPointFile(file)) return 1;
    // §9 needs the whole UI surface inside the model even when it is truncated,
    // so renderer/UI component files outrank ordinary sources.
    if (/\.(?:tsx|jsx|vue|svelte)$/.test(file) || /(?:^|\/)(?:renderer|components|views|pages|ui)\//.test(file)) return 2;
    if (kind === "TEST") return 3;
    return 4;
  };
  const readable = snapshot.files
    .filter((file) => {
      const kind = classificationFor(file, testSet);
      return kind !== "GENERATED" && (kind === "SOURCE" || kind === "TEST" || kind === "STYLE" || kind === "MARKUP");
    })
    .sort((left, right) => priority(left) - priority(right) || left.localeCompare(right));
  if (readable.length > limits.moduleFiles) truncated = true;
  for (const file of readable.slice(0, limits.moduleFiles)) {
    const absolute = path.join(root, file);
    let content = "";
    let bytes = 0;
    try {
      const stat = fs.statSync(absolute);
      bytes = stat.size;
      if (budget > 0) {
        const read = Math.min(bytes, limits.bytesPerFile, budget);
        const handle = fs.openSync(absolute, "r");
        try {
          const buffer = Buffer.alloc(read);
          const readBytes = fs.readSync(handle, buffer, 0, read, 0);
          content = buffer.subarray(0, readBytes).toString("utf8");
        } finally { fs.closeSync(handle); }
        budget -= read;
      } else truncated = true;
    } catch { continue; }
    const specifiers = content ? extractImportSpecifiers(content, limits.importsPerFile) : [];
    modules.push({
      path: file,
      kind: classificationFor(file, testSet),
      language: languageOfFile(file) ?? "unknown",
      bytes,
      exports: content ? extractExportedSymbols(content) : [],
      imports: specifiers.map((specifier) => {
        const resolved = resolveSpecifier(file, specifier, fileSet);
        const builtin = !resolved && isBuiltin(specifier);
        const external = !resolved && !builtin;
        return {
          specifier,
          ...(resolved ? { resolved } : {}),
          external,
          ...(builtin ? { builtin: true } : {})
        };
      }),
      test_files: (snapshot.testMap[path.posix.dirname(file)] ?? []).slice(0, 20),
      is_entry: entryPoints.includes(file)
    });
  }
  if (snapshot.files.length > limits.moduleFiles && readable.length <= limits.moduleFiles) truncated = true;

  const generatedAt = now();
  const model: RepoWorldModel = {
    schemaVersion: 1,
    version: REPO_WORLD_MODEL_VERSION,
    id: worldModelIdFor({ fingerprint: snapshot.fingerprint, modules: modules.length, generatedAt }),
    generated_at: generatedAt,
    fingerprint: snapshot.fingerprint,
    root: snapshot.root,
    package_managers: detectPackageManagers(fileSet),
    build_system: buildSystem,
    runtimes: detectRuntimes(fileSet, buildSystem, root),
    ci,
    languages,
    entry_points: entryPoints,
    modules,
    tests,
    tests_by_directory: snapshot.testMap,
    git: (options.git ?? readGitState)(root),
    generated_surfaces: generated,
    ignore_files: ignoreFiles,
    workspace: detectWorkspace(root, snapshot.files),
    truncated
  };
  return model;
}

/** Model + graph in one call, since §6.2 is derived from §6.1. */
export function buildWorldModelWithGraph(root: string, options: BuildWorldModelOptions = {}): { model: RepoWorldModel; graph: DependencyGraph; summary: WorldModelSummary } {
  const model = buildWorldModel(root, options);
  return { model, graph: buildDependencyGraph(model), summary: summarizeWorldModel(model) };
}

/**
 * Durable store for built models: one JSON file per model id under a directory.
 * §47 lists the plan/state a Boss restart must be able to read back.
 */
export class WorldModelStore {
  constructor(private readonly directory: string) {}

  put(model: RepoWorldModel): string {
    const file = this.fileFor(model.id);
    writeJson(file, model);
    writeJson(path.join(this.directory, "latest.json"), { schemaVersion: 1, id: model.id, root: model.root, fingerprint: model.fingerprint, generated_at: model.generated_at });
    return file;
  }

  get(id: string): RepoWorldModel | undefined {
    return readJson<RepoWorldModel>(this.fileFor(id));
  }

  latest(): RepoWorldModel | undefined {
    const pointer = readJson<{ id?: string }>(path.join(this.directory, "latest.json"));
    return pointer?.id ? this.get(pointer.id) : undefined;
  }

  list(): string[] {
    try {
      return fs.readdirSync(this.directory).filter((name) => name.startsWith("wm-") && name.endsWith(".json")).sort();
    } catch {
      return [];
    }
  }

  private fileFor(id: string): string {
    return path.join(this.directory, `${id.replace(/[^A-Za-z0-9_-]/g, "")}.json`);
  }
}
