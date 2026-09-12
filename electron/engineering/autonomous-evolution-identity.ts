/**
 * Update-Plan/self-evlo.md §5–§13 + §37, §96 / §101 "Phase B — Artifact / Build
 * Binding" — the host side of the identity binding.
 *
 * The pure module (`src/shared/autonomous-evolution-identity.ts`) owns the
 * vocabulary and every comparison rule; this module owns the reading: the real
 * source tree (§9), the real lockfile and tool versions (§10), the real `dist/`
 * and `dist-electron/` artifacts (§7/§8), the acceptance-contract data (§11), the
 * real `tests/**` inventory (§12), the `trust-policy/` retirement records (§13)
 * and the §37 digest. Everything it writes goes through the §96 atomic writer.
 *
 * §44: every check returns `TrustProblem` values (`{code, detail?}`). Nothing in
 * this file inspects message text; the codes it returns are declared in the pure
 * module's `EVOLUTION_IDENTITY_CODES`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Dirent, Stats } from "node:fs";
import {
  ACCEPTANCE_CONTRACT_VERSION,
  ACCEPTANCE_GATE_CONTRACTS,
  CAPABILITY_GATES,
  DESKTOP_BLACK_BOX_CONTRACT,
  type AcceptanceGateContract
} from "../../src/shared/acceptance-contracts";
import { DESKTOP_BLACK_BOX_CONTRACT_HASH } from "../../src/shared/desktop-black-box-contract";
import {
  EVOLUTION_IDENTITY_CODES,
  aggregateIdentityHash,
  buildManifestAggregate,
  canonicalIdentityDigest,
  compareRequiredIdSurface as compareRequiredIdSurfacePure,
  contractSnapshot,
  declaredDependencyVersion,
  extractTestInventory,
  flatHashMap,
  identityProblemsFrom,
  pnpmVersionOf,
  reproducibilityDigest,
  requiredIdCountsOf,
  testManifestFrom,
  type BuildIdentityParts,
  type BuildManifest,
  type ContractSnapshot,
  type DependencyIdentity,
  type HashedPath,
  type IdentityContract,
  type ReproducibilityDigest,
  type ReproducibilityInput,
  type RequiredIdCounts,
  type RequiredIdSurfaceComparison,
  type RequirementRetirement,
  type SourceFreeze,
  type TestInventoryEntry,
  type TestManifest
} from "../../src/shared/autonomous-evolution-identity";
import { trustProblem, type TrustProblem } from "../../src/shared/trust-problems";
import { sha256FileSync, writeFileAtomicSync } from "./atomic-file";

/** §96: the one atomic writer. Re-exported so identity callers need one import. */
export { writeFileAtomicSync };

/* ------------------------------------------------------------------ *
 * What identity covers
 * ------------------------------------------------------------------ */

/**
 * §9: "不仅 Git tracked file" — the sources a certificate must freeze. These are
 * paths relative to the repository root; a directory is walked recursively.
 */
export const SOURCE_IDENTITY_ROOTS: readonly string[] = [
  "package.json",
  "pnpm-lock.yaml",
  ".github",
  "scripts",
  "src",
  "electron",
  "tests",
  "trust-policy"
];

/**
 * §9: never sources of identity. `node_modules` and the build outputs are
 * products, `artifacts` is evidence *about* the sources, and `.git` is the
 * history that produced them — hashing any of them would make the freeze
 * unstable for reasons that are not a source change.
 */
export const IDENTITY_EXCLUDED_DIRECTORIES: readonly string[] = [
  "node_modules",
  "dist",
  "dist-electron",
  "artifacts",
  ".git"
];

/** The test scan only prunes genuine non-sources: fixtures may be named anything. */
export const TEST_SCAN_EXCLUDED_DIRECTORIES: readonly string[] = ["node_modules", ".git"];

/** §12: where the locked inventory is read from. */
export const DEFAULT_TEST_DIRECTORIES: readonly string[] = ["tests"];

/** §7/§8: the build outputs whose bytes the certificate binds. */
export const DEFAULT_BUILD_DIRECTORIES: readonly string[] = ["dist", "dist-electron"];

export const LOCKFILE_NAME = "pnpm-lock.yaml";
export const PACKAGE_JSON_NAME = "package.json";

/** §11: the trust policy lives next to the sources, not inside `artifacts/`. */
export const TRUST_POLICY_DIRECTORY = "trust-policy";

/** §13: the retirement records that make a removed id legitimate. */
export const REQUIREMENT_RETIREMENTS_RELATIVE = "trust-policy/requirement-retirements.json";

/** §14: the capability registry whose hash §37 records. */
export const CAPABILITY_REGISTRY_RELATIVE = "trust-policy/capability-registry.json";

/** The acceptance namespace every identity artifact is written into. */
export const IDENTITY_ARTIFACT_DIRECTORY = "artifacts/acceptance";

export const SOURCE_FREEZE_RELATIVE = "artifacts/acceptance/source-freeze.json";
export const BUILD_MANIFEST_RELATIVE = "artifacts/acceptance/build-manifest.json";
export const CONTRACT_SNAPSHOT_RELATIVE = "artifacts/acceptance/contract-snapshot.json";
export const TEST_MANIFEST_RELATIVE = "artifacts/acceptance/test-manifest.json";
export const REPRODUCIBILITY_RELATIVE = "artifacts/acceptance/reproducibility.json";

/** How deep a source walk may go before it is treated as a cycle. */
const IDENTITY_MAX_DEPTH = 24;

/** §12: the files the inventory is about. */
const TEST_FILE_NAME = /\.test\.ts$/;

/* ------------------------------------------------------------------ *
 * Small readers
 * ------------------------------------------------------------------ */

/** SHA-256 of a file's exact bytes, or "" when the file cannot be read (§7). */
export function sha256File(file: string): string {
  return sha256FileSync(file);
}

export function readTextFile(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function resolveUnderRoot(root: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(root, ...target.split("/"));
}

/** The repository-relative POSIX path identity is always recorded under. */
export function relativeIdentityPath(root: string, absolute: string): string {
  const relative = path.relative(root, absolute);
  const segments = relative.split(/[\\/]/);
  const outside = relative === "" || segments[0] === "..";
  return (outside ? absolute : relative).split(path.sep).join("/");
}

/* ------------------------------------------------------------------ *
 * §9: the source freeze
 * ------------------------------------------------------------------ */

function collectFiles(absolute: string, out: string[], excluded: ReadonlySet<string>, depth: number): void {
  if (depth > IDENTITY_MAX_DEPTH) return;
  let entries: Dirent[];
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      collectFiles(child, out, excluded, depth + 1);
      continue;
    }
    if (entry.isFile()) {
      out.push(child);
      continue;
    }
    // A link: hash a linked *file*, never walk a linked directory. Following
    // directory links would let the freeze escape the root or loop.
    let linked: Stats;
    try {
      linked = fs.statSync(child);
    } catch {
      continue;
    }
    if (linked.isFile()) out.push(child);
  }
}

function collectUnder(root: string, target: string, out: string[], excluded: ReadonlySet<string>): void {
  const absolute = resolveUnderRoot(root, target);
  let stat: Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return;
  }
  if (stat.isFile()) {
    out.push(absolute);
    return;
  }
  if (stat.isDirectory()) collectFiles(absolute, out, excluded, 0);
}

function toHashedPaths(root: string, files: readonly string[]): HashedPath[] {
  return [...new Set(files)]
    .map((file) => ({ path: relativeIdentityPath(root, file), sha256: sha256File(file) }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/**
 * §9: hash a tree or a file list. Directories are walked (minus the excluded
 * product directories), missing paths contribute nothing, and every path is
 * recorded repository-relative with forward slashes so two clones agree.
 */
export function sha256Tree(root: string, relativePaths: readonly string[]): HashedPath[] {
  const files: string[] = [];
  for (const relative of relativePaths) collectUnder(root, relative, files, new Set(IDENTITY_EXCLUDED_DIRECTORIES));
  return toHashedPaths(root, files);
}

export interface SourceFreezeOptions {
  root: string;
  /** Defaults to `SOURCE_IDENTITY_ROOTS`; the same list must be used to verify. */
  paths?: readonly string[];
  now?: () => Date;
}

/** §9: the source snapshot a certification run starts from. */
export function computeSourceFreeze(options: SourceFreezeOptions): SourceFreeze {
  const now = options.now ?? (() => new Date());
  const files = sha256Tree(options.root, options.paths ?? SOURCE_IDENTITY_ROOTS);
  return {
    files,
    aggregate_hash: aggregateIdentityHash(files),
    file_count: files.length,
    computed_at: now().toISOString()
  };
}

export interface VerifySourceFreezeOptions {
  /** Must be the list the freeze was computed with. */
  paths?: readonly string[];
}

/**
 * §9: re-hash at graduation and compare with the session-start freeze. A single
 * changed byte, a deleted source and a new source are all reported; the caller
 * fails closed on any of them.
 */
export function verifySourceFreeze(
  freeze: SourceFreeze,
  root: string,
  options: VerifySourceFreezeOptions = {}
): TrustProblem[] {
  const actual = sha256Tree(root, options.paths ?? SOURCE_IDENTITY_ROOTS);
  return identityProblemsFrom({
    expected: freeze.files,
    actual,
    expected_aggregate: freeze.aggregate_hash,
    actual_aggregate: aggregateIdentityHash(actual),
    codes: {
      changed: EVOLUTION_IDENTITY_CODES.SOURCE_FREEZE_FILE_CHANGED,
      missing: EVOLUTION_IDENTITY_CODES.SOURCE_FREEZE_FILE_MISSING,
      added: EVOLUTION_IDENTITY_CODES.SOURCE_FREEZE_FILE_ADDED,
      aggregate: EVOLUTION_IDENTITY_CODES.SOURCE_FREEZE_AGGREGATE_MISMATCH
    }
  });
}

/* ------------------------------------------------------------------ *
 * §10: the dependency lock
 * ------------------------------------------------------------------ */

/**
 * §10: what the run actually depends on. Node comes from the running process,
 * pnpm from `packageManager`, Electron from the declared dependency — never from
 * "whatever version happens to be installed today".
 */
export function computeDependencyIdentity(options: { root: string }): DependencyIdentity {
  const packageJson = readJsonFile(path.join(options.root, PACKAGE_JSON_NAME));
  return {
    lockfile_sha256: sha256File(path.join(options.root, LOCKFILE_NAME)),
    node: process.versions.node,
    pnpm: pnpmVersionOf(isRecord(packageJson) ? packageJson.packageManager : undefined),
    electron: declaredDependencyVersion(packageJson, "electron"),
    platform: process.platform,
    arch: process.arch
  };
}

/**
 * §10: a dependency identity is only usable when the lockfile really exists and
 * the Electron version is declared. Refusing here is what makes
 * `pnpm install --frozen-lockfile` meaningful — that command belongs to the
 * build/CI driver, not to this reader.
 */
export function verifyDependencyIdentity(identity: DependencyIdentity): TrustProblem[] {
  const problems: TrustProblem[] = [];
  if (identity.lockfile_sha256 === "") {
    problems.push(trustProblem(EVOLUTION_IDENTITY_CODES.DEPENDENCY_LOCKFILE_MISSING, LOCKFILE_NAME));
  }
  if (identity.electron === "") {
    problems.push(trustProblem(EVOLUTION_IDENTITY_CODES.DEPENDENCY_ELECTRON_UNKNOWN, "electron"));
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * §7/§8: the build manifest
 * ------------------------------------------------------------------ */

function gitRevParse(root: string, ref: string): string {
  const result = spawnSync("git", ["rev-parse", ref], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) return "";
  return String(result.stdout ?? "").trim();
}

/** §5/§6: the commit and the tree the working copy is at. */
export function readGitIdentity(root: string): { commit: string; tree: string } {
  return { commit: gitRevParse(root, "HEAD"), tree: gitRevParse(root, "HEAD^{tree}") };
}

function hashBuildTrees(root: string, directories: readonly string[]): HashedPath[] {
  const files: string[] = [];
  for (const directory of directories) {
    collectUnder(root, directory, files, new Set(IDENTITY_EXCLUDED_DIRECTORIES));
  }
  return toHashedPaths(root, files);
}

export interface BuildManifestOptions {
  root: string;
  /** Defaults to `dist`; a directory name or an absolute path. */
  dist?: string;
  /** Defaults to `dist-electron`. */
  distElectron?: string;
  /** Test seam / caller override: recorded verbatim (§6). Defaults to git HEAD. */
  sourceCommit?: string;
  sourceTree?: string;
  now?: () => Date;
}

/**
 * §7/§8: walk the real build outputs and record what they are, bound to the
 * commit and tree that produced them plus the runtime that ran the build. The
 * aggregate deliberately excludes `built_at`, so rebuilding identical sources
 * reproduces the same build identity.
 */
export function computeBuildManifest(options: BuildManifestOptions): BuildManifest {
  const now = options.now ?? (() => new Date());
  const git = readGitIdentity(options.root);
  const packageJson = readJsonFile(path.join(options.root, PACKAGE_JSON_NAME));
  const files = hashBuildTrees(options.root, [
    options.dist ?? DEFAULT_BUILD_DIRECTORIES[0],
    options.distElectron ?? DEFAULT_BUILD_DIRECTORIES[1]
  ]);
  const parts: BuildIdentityParts = {
    source_commit: options.sourceCommit ?? git.commit,
    source_tree: options.sourceTree ?? git.tree,
    files,
    node_version: process.versions.node,
    pnpm_version: pnpmVersionOf(isRecord(packageJson) ? packageJson.packageManager : undefined),
    electron_version: declaredDependencyVersion(packageJson, "electron"),
    platform: process.platform,
    arch: process.arch
  };
  return {
    ...parts,
    files,
    per_file_sha256: flatHashMap(files),
    aggregate_build_hash: buildManifestAggregate(parts),
    built_at: now().toISOString()
  };
}

/** The directories a recorded manifest's artifacts live in, from its own paths. */
function buildDirectoriesOf(manifest: BuildManifest): string[] {
  const directories = new Set<string>();
  for (const entry of manifest.files) {
    const segments = entry.path.split("/");
    if (segments.length > 1 && segments[0] !== "") directories.add(segments[0]);
  }
  return directories.size > 0 ? [...directories].sort() : [...DEFAULT_BUILD_DIRECTORIES];
}

export interface VerifyBuildManifestOptions {
  root: string;
  sourceCommit: string;
  sourceTree: string;
  buildDirectories?: readonly string[];
}

/**
 * §7/§8: refuse a build that is not the certified one. Deleted artifacts, changed
 * artifacts, artifacts the manifest never recorded, a manifest whose own hash
 * does not follow from its contents, and a source commit/tree that is not the
 * one the manifest was bound to are all reported. "Old dist + new source" cannot
 * pass because the commit/tree check and the per-file check are independent.
 */
export function verifyBuildManifest(
  manifest: BuildManifest,
  expected: VerifyBuildManifestOptions
): TrustProblem[] {
  const problems: TrustProblem[] = [];
  if (manifest.source_commit !== expected.sourceCommit) {
    problems.push(
      trustProblem(EVOLUTION_IDENTITY_CODES.BUILD_SOURCE_COMMIT_MISMATCH, `${manifest.source_commit}:${expected.sourceCommit}`)
    );
  }
  if (manifest.source_tree !== expected.sourceTree) {
    problems.push(
      trustProblem(EVOLUTION_IDENTITY_CODES.BUILD_SOURCE_TREE_MISMATCH, `${manifest.source_tree}:${expected.sourceTree}`)
    );
  }
  const recorded = flatHashMap(manifest.files);
  for (const relative of Object.keys(manifest.per_file_sha256).sort()) {
    if (recorded[relative] !== manifest.per_file_sha256[relative]) {
      problems.push(
        trustProblem(
          EVOLUTION_IDENTITY_CODES.BUILD_MANIFEST_HASH_MISMATCH,
          `${relative}:per_file_sha256:${String(recorded[relative])}`
        )
      );
    }
  }
  for (const entry of manifest.files) {
    const absolute = resolveUnderRoot(expected.root, entry.path);
    const actual = sha256File(absolute);
    if (actual === "") {
      problems.push(trustProblem(EVOLUTION_IDENTITY_CODES.BUILD_FILE_MISSING, entry.path));
      continue;
    }
    if (actual !== entry.sha256) {
      problems.push(
        trustProblem(EVOLUTION_IDENTITY_CODES.BUILD_MANIFEST_HASH_MISMATCH, `${entry.path}:${entry.sha256}:${actual}`)
      );
    }
  }
  const onDisk = hashBuildTrees(expected.root, expected.buildDirectories ?? buildDirectoriesOf(manifest));
  for (const entry of onDisk) {
    if (!Object.prototype.hasOwnProperty.call(recorded, entry.path)) {
      problems.push(trustProblem(EVOLUTION_IDENTITY_CODES.BUILD_FILE_ADDED, entry.path));
    }
  }
  const recomputed = buildManifestAggregate(manifest);
  if (recomputed !== manifest.aggregate_build_hash) {
    problems.push(
      trustProblem(
        EVOLUTION_IDENTITY_CODES.BUILD_MANIFEST_HASH_MISMATCH,
        `aggregate:${manifest.aggregate_build_hash}:${recomputed}`
      )
    );
  }
  return problems;
}

/** §96: persist a build manifest atomically under a repository root. */
export function writeBuildManifest(root: string, manifest: BuildManifest, relative = BUILD_MANIFEST_RELATIVE): string {
  return writeIdentityArtifact(root, relative, manifest);
}

/**
 * The manifest as it is on disk, rebuilt field by field in the order
 * `computeBuildManifest` emits it, so a written manifest reads back byte-identical
 * and a malformed field degrades to "" instead of being trusted.
 */
export function readBuildManifest(file: string): BuildManifest | undefined {
  const parsed = readJsonFile(file);
  if (!isRecord(parsed)) return undefined;
  if (typeof parsed.aggregate_build_hash !== "string" || !Array.isArray(parsed.files)) return undefined;
  const perFileSha256: Record<string, string> = {};
  if (isRecord(parsed.per_file_sha256)) {
    for (const [key, value] of Object.entries(parsed.per_file_sha256)) {
      if (typeof value === "string") perFileSha256[key] = value;
    }
  }
  return {
    source_commit: textOrEmpty(parsed.source_commit),
    source_tree: textOrEmpty(parsed.source_tree),
    files: parsed.files.filter(isRecord).map((entry) => ({
      path: textOrEmpty(entry.path),
      sha256: textOrEmpty(entry.sha256)
    })),
    node_version: textOrEmpty(parsed.node_version),
    pnpm_version: textOrEmpty(parsed.pnpm_version),
    electron_version: textOrEmpty(parsed.electron_version),
    platform: textOrEmpty(parsed.platform),
    arch: textOrEmpty(parsed.arch),
    per_file_sha256: perFileSha256,
    aggregate_build_hash: parsed.aggregate_build_hash,
    built_at: textOrEmpty(parsed.built_at)
  };
}

/* ------------------------------------------------------------------ *
 * §11: the contract snapshot
 * ------------------------------------------------------------------ */

function identityContractOf(contract: AcceptanceGateContract): IdentityContract {
  return {
    gate: contract.gate,
    contract_version: contract.contract_version,
    required_ids: contract.required_ids,
    out_of_scope_ids: contract.out_of_scope_ids.map((entry) => entry.id)
  };
}

export interface ContractSnapshotOptions {
  /** Where the trust policy is read from. Defaults to the process working directory. */
  root?: string;
  /** Defaults to the sixteen delivery gates. */
  contracts?: readonly AcceptanceGateContract[];
  /** Defaults to the desktop black-box contract. */
  desktopContract?: AcceptanceGateContract;
  /** Defaults to `CAPABILITY_GATES`. */
  capabilityGates?: Readonly<Record<string, readonly string[]>>;
  trustPolicyDirectory?: string;
}

/**
 * §11: snapshot the contracts, the desktop contract (with the §2.7 digest that
 * proves which claim set it was) and the trust policy files, then hash the whole
 * thing. Every later attestation, audit and certificate may only refer to this
 * one snapshot, so a contract edited mid-run cannot reinterpret old evidence.
 */
export function computeContractSnapshot(options: ContractSnapshotOptions = {}): ContractSnapshot {
  const root = options.root ?? process.cwd();
  const desktopContract = options.desktopContract ?? DESKTOP_BLACK_BOX_CONTRACT;
  return contractSnapshot({
    acceptance_contract_version: ACCEPTANCE_CONTRACT_VERSION,
    contracts: (options.contracts ?? ACCEPTANCE_GATE_CONTRACTS).map(identityContractOf),
    desktop_contract: identityContractOf(desktopContract),
    desktop_contract_hash: DESKTOP_BLACK_BOX_CONTRACT_HASH,
    capability_gates: options.capabilityGates ?? CAPABILITY_GATES,
    trust_policy: sha256Tree(root, [options.trustPolicyDirectory ?? TRUST_POLICY_DIRECTORY])
  });
}

/** §96: persist a contract snapshot atomically under a repository root. */
export function writeContractSnapshot(
  root: string,
  snapshot: ContractSnapshot,
  relative = CONTRACT_SNAPSHOT_RELATIVE
): string {
  return writeIdentityArtifact(root, relative, snapshot);
}

/* ------------------------------------------------------------------ *
 * §12: the test inventory lock
 * ------------------------------------------------------------------ */

export interface TestManifestOptions {
  root: string;
  /** Defaults to `tests`; a directory name or an absolute path. */
  testDirs?: readonly string[];
}

/**
 * §12: the static inventory of every `*.test.ts` under the test roots — file
 * hash, describe blocks, declared cases and category. A suite that is deleted
 * simply stops appearing here, which is exactly what the lock has to notice.
 */
export function computeTestManifest(options: TestManifestOptions): TestManifest {
  const files: string[] = [];
  for (const directory of options.testDirs ?? DEFAULT_TEST_DIRECTORIES) {
    collectUnder(options.root, directory, files, new Set(TEST_SCAN_EXCLUDED_DIRECTORIES));
  }
  const entries: TestInventoryEntry[] = [...new Set(files)]
    .filter((file) => TEST_FILE_NAME.test(path.basename(file)))
    .map((file) => {
      const inventory = extractTestInventory(readTextFile(file));
      return {
        path: relativeIdentityPath(options.root, file),
        sha256: sha256File(file),
        describe: inventory.describe,
        cases: inventory.cases
      };
    });
  return testManifestFrom(entries);
}

/**
 * §12: re-scan and compare with the locked inventory. A removed file, a modified
 * file, an inventory that no longer hashes to its own manifest, a locked manifest
 * that no longer hashes the tree on disk and — the one that actually fails a run —
 * a decreased case count are all reported; a *new* test file is reported too but
 * stays informational (`EVOLUTION_IDENTITY_CODES` classifies it in the pure
 * module).
 */
export function verifyTestManifest(
  manifest: TestManifest,
  root: string,
  options: { testDirs?: readonly string[] } = {}
): TrustProblem[] {
  const actual = computeTestManifest({ root, testDirs: options.testDirs ?? DEFAULT_TEST_DIRECTORIES });
  const problems: TrustProblem[] = [];
  const actualByPath = new Map(actual.files.map((file) => [file.path, file]));
  const recordedByPath = new Map(manifest.files.map((file) => [file.path, file]));
  for (const file of manifest.files) {
    const current = actualByPath.get(file.path);
    if (current === undefined) {
      problems.push(trustProblem(EVOLUTION_IDENTITY_CODES.TEST_FILE_REMOVED, file.path));
      continue;
    }
    if (current.sha256 !== file.sha256) {
      problems.push(
        trustProblem(EVOLUTION_IDENTITY_CODES.TEST_FILE_MODIFIED, `${file.path}:${file.sha256}:${current.sha256}`)
      );
    }
  }
  for (const file of actual.files) {
    if (!recordedByPath.has(file.path)) {
      problems.push(trustProblem(EVOLUTION_IDENTITY_CODES.TEST_FILE_ADDED, file.path));
    }
  }
  if (actual.case_count < manifest.case_count) {
    problems.push(
      trustProblem(EVOLUTION_IDENTITY_CODES.TEST_CASE_COUNT_DECREASED, `${manifest.case_count}:${actual.case_count}`)
    );
  }
  // Two independent readings of the same claim: the manifest must still hash to
  // its own contents (§12 forbids an edited inventory) *and* the tree on disk must
  // still hash to the locked manifest.
  const recomputed = testManifestFrom(manifest.files);
  if (recomputed.manifest_hash !== manifest.manifest_hash) {
    problems.push(
      trustProblem(
        EVOLUTION_IDENTITY_CODES.TEST_MANIFEST_HASH_MISMATCH,
        `manifest:${manifest.manifest_hash}:${recomputed.manifest_hash}`
      )
    );
  }
  if (actual.manifest_hash !== manifest.manifest_hash) {
    problems.push(
      trustProblem(
        EVOLUTION_IDENTITY_CODES.TEST_MANIFEST_HASH_MISMATCH,
        `tree:${manifest.manifest_hash}:${actual.manifest_hash}`
      )
    );
  }
  return problems;
}

/** §96: persist a test manifest atomically under a repository root. */
export function writeTestManifest(root: string, manifest: TestManifest, relative = TEST_MANIFEST_RELATIVE): string {
  return writeIdentityArtifact(root, relative, manifest);
}

/* ------------------------------------------------------------------ *
 * §13: required-id monotonicity
 * ------------------------------------------------------------------ */

export function requirementRetirementsPath(root: string): string {
  return resolveUnderRoot(root, REQUIREMENT_RETIREMENTS_RELATIVE);
}

function toRetirement(value: Record<string, unknown>): RequirementRetirement {
  const record: RequirementRetirement = {
    old_id: typeof value.old_id === "string" ? value.old_id : "",
    reason: typeof value.reason === "string" ? value.reason : "",
    replacement: typeof value.replacement === "string" ? value.replacement : "",
    migration: typeof value.migration === "string" ? value.migration : "",
    risk: typeof value.risk === "string" ? value.risk : ""
  };
  if (typeof value.gate === "string") record.gate = value.gate;
  if (typeof value.recorded_at === "string") record.recorded_at = value.recorded_at;
  return record;
}

/**
 * §13: the Requirement Retirement Records on disk. Both a bare array and a
 * `{retirements: [...]}` document are accepted; an incomplete record is kept so
 * the comparison can refuse it rather than silently ignoring it.
 */
export function readRequirementRetirements(root: string): RequirementRetirement[] {
  const parsed = readJsonFile(requirementRetirementsPath(root));
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.retirements) ? parsed.retirements : [];
  return list.filter(isRecord).map(toRetirement);
}

export interface CompareSurfaceOptions {
  /** Repository root to read `trust-policy/requirement-retirements.json` from. */
  root?: string;
  /** Explicit records; when given, no file is read. */
  retirements?: readonly RequirementRetirement[];
}

/**
 * §13: compare the required surface before and after. Removing an id is a
 * regression unless a complete retirement record names it, in which case the
 * removal is recorded as `RETIRED_WITH_RECORD` — and either way the change means
 * the Root Trust Surface moved, which is a new Trust Epoch (§4).
 */
export function compareRequiredIdSurface(
  baselineCounts: RequiredIdCounts,
  candidateCounts: RequiredIdCounts,
  options: CompareSurfaceOptions = {}
): RequiredIdSurfaceComparison {
  const retirements = options.retirements ?? (options.root === undefined ? [] : readRequirementRetirements(options.root));
  return compareRequiredIdSurfacePure(baselineCounts, candidateCounts, retirements);
}

/** The §13 baseline the repository's own declared contracts establish. */
export function acceptanceRequiredIdCounts(): Record<string, string[]> {
  return requiredIdCountsOf(ACCEPTANCE_GATE_CONTRACTS.map(identityContractOf));
}

/* ------------------------------------------------------------------ *
 * §37: the reproducibility digest
 * ------------------------------------------------------------------ */

export interface ReproducibilityOptions {
  root: string;
  commit?: string;
  tree?: string;
  contracts?: readonly AcceptanceGateContract[];
  capabilityGates?: Readonly<Record<string, readonly string[]>>;
  /** Defaults to `artifacts/acceptance/build-manifest.json`. */
  buildManifestPath?: string;
  /** Defaults to `trust-policy/capability-registry.json`. */
  capabilityRegistryPath?: string;
  testDirs?: readonly string[];
}

/**
 * The §37 `build manifest hash`: the certified build aggregate when a manifest
 * exists, otherwise the manifest file's own bytes, otherwise "" — never a
 * fabricated value, so a missing build shows up as a component mismatch.
 */
function buildManifestHashOf(file: string): string {
  const parsed = readJsonFile(file);
  if (isRecord(parsed) && typeof parsed.aggregate_build_hash === "string" && parsed.aggregate_build_hash !== "") {
    return parsed.aggregate_build_hash;
  }
  return sha256File(file);
}

/**
 * §37: assemble the seven components from what is really on disk and hash them.
 * Two clones that reproduce each other produce the same digest; a single changed
 * component changes it.
 */
export function readReproducibilityDigest(options: ReproducibilityOptions): ReproducibilityDigest {
  const git = readGitIdentity(options.root);
  const input: ReproducibilityInput = {
    commit: options.commit ?? git.commit,
    tree: options.tree ?? git.tree,
    lockfile: sha256File(path.join(options.root, LOCKFILE_NAME)),
    contract_snapshot_hash: computeContractSnapshot({
      root: options.root,
      contracts: options.contracts ?? ACCEPTANCE_GATE_CONTRACTS,
      capabilityGates: options.capabilityGates ?? CAPABILITY_GATES
    }).contract_snapshot_hash,
    test_manifest_hash: computeTestManifest({
      root: options.root,
      testDirs: options.testDirs ?? DEFAULT_TEST_DIRECTORIES
    }).manifest_hash,
    build_manifest_hash: buildManifestHashOf(resolveUnderRoot(options.root, options.buildManifestPath ?? BUILD_MANIFEST_RELATIVE)),
    capability_registry_hash: sha256File(resolveUnderRoot(options.root, options.capabilityRegistryPath ?? CAPABILITY_REGISTRY_RELATIVE))
  };
  return reproducibilityDigest(input);
}

/** §96: persist a reproducibility digest atomically under a repository root. */
export function writeReproducibilityDigest(
  root: string,
  digest: ReproducibilityDigest,
  relative = REPRODUCIBILITY_RELATIVE
): string {
  return writeIdentityArtifact(root, relative, digest);
}

/** §96: persist a source freeze atomically under a repository root. */
export function writeSourceFreeze(root: string, freeze: SourceFreeze, relative = SOURCE_FREEZE_RELATIVE): string {
  return writeIdentityArtifact(root, relative, freeze);
}

/* ------------------------------------------------------------------ *
 * §96: writes
 * ------------------------------------------------------------------ */

/**
 * §96: every identity artifact goes through `writeFileAtomicSync`, so a reader
 * sees either the previous file or the complete new one — never a prefix that
 * parses. The returned path is the final location, not the temp file.
 */
function writeIdentityArtifact(root: string, relative: string, value: unknown): string {
  const file = resolveUnderRoot(root, relative);
  writeFileAtomicSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

/** The §37 identity of a repository, as one canonical digest of its artifacts. */
export function identityArtifactDigest(value: unknown): string {
  return canonicalIdentityDigest(value);
}
