/**
 * Update-Plan/self-evlo.md §5–§13 + §37 — the identity vocabulary Phase B binds.
 *
 * Phase B ("Artifact / Build Binding", §101) turns a certificate about *source*
 * into a certificate about SOURCE + BUILD + RUNTIME: a graduation-time source
 * freeze (§9), a dependency lock (§10), a build manifest bound to the commit and
 * the tree (§7/§8), an immutable acceptance-contract snapshot (§11), a test
 * inventory lock (§12), required-id monotonicity (§13) and the reproducibility
 * digest (§37) an A/B clone pair must agree on.
 *
 * This module holds the shared vocabulary: the value types, the machine codes
 * every verification returns, and the pure helpers (`canonicalIdentityDigest`,
 * `compareFlatHashes`, `identityProblemsFrom`, `aggregateIdentityHash`,
 * `buildManifestAggregate`, `contractSnapshot`, `extractTestInventory`,
 * `testManifestFrom`, `compareRequiredIdSurface`, `reproducibilityDigest`) so the
 * host module and the acceptance suite speak one language.
 *
 * §44: a verification result is always a `TrustProblem` (`{code, detail?}`).
 * No control flow anywhere may read prose, which is why every decision here is
 * taken on a `code` and `detail` stays a machine-usable projection.
 *
 * Pure: no fs, no clock, no process. Reading bytes, git and the clock belongs to
 * `electron/engineering/autonomous-evolution-identity.ts`.
 */
import { sha256Hex } from "./hash";
import { trustProblem, type TrustProblem } from "./trust-problems";

/* ------------------------------------------------------------------ *
 * §43/§44: the machine codes this layer branches on
 * ------------------------------------------------------------------ */

/**
 * The codes the identity layer returns. They live here rather than in
 * `trust-problems.ts` so Phase B can grow without editing the Root Trust Surface
 * the earlier checkpoints froze; adding a code that can refuse a run is a trust
 * epoch change (§4) either way.
 */
export const EVOLUTION_IDENTITY_CODES = {
  /* §9 source freeze */
  SOURCE_FREEZE_FILE_CHANGED: "SOURCE_FREEZE_FILE_CHANGED",
  SOURCE_FREEZE_FILE_MISSING: "SOURCE_FREEZE_FILE_MISSING",
  SOURCE_FREEZE_FILE_ADDED: "SOURCE_FREEZE_FILE_ADDED",
  SOURCE_FREEZE_AGGREGATE_MISMATCH: "SOURCE_FREEZE_AGGREGATE_MISMATCH",

  /* §10 dependency lock */
  DEPENDENCY_LOCKFILE_MISSING: "DEPENDENCY_LOCKFILE_MISSING",
  DEPENDENCY_ELECTRON_UNKNOWN: "DEPENDENCY_ELECTRON_UNKNOWN",

  /* §7/§8 build identity */
  BUILD_MANIFEST_HASH_MISMATCH: "BUILD_MANIFEST_HASH_MISMATCH",
  BUILD_SOURCE_COMMIT_MISMATCH: "BUILD_SOURCE_COMMIT_MISMATCH",
  BUILD_SOURCE_TREE_MISMATCH: "BUILD_SOURCE_TREE_MISMATCH",
  BUILD_FILE_MISSING: "BUILD_FILE_MISSING",
  BUILD_FILE_ADDED: "BUILD_FILE_ADDED",

  /* §12 test inventory */
  TEST_FILE_REMOVED: "TEST_FILE_REMOVED",
  TEST_FILE_ADDED: "TEST_FILE_ADDED",
  TEST_FILE_MODIFIED: "TEST_FILE_MODIFIED",
  TEST_MANIFEST_HASH_MISMATCH: "TEST_MANIFEST_HASH_MISMATCH",
  TEST_CASE_COUNT_DECREASED: "TEST_CASE_COUNT_DECREASED",

  /* §13 required-id surface */
  REQUIREMENT_RETIREMENT_INCOMPLETE: "REQUIREMENT_RETIREMENT_INCOMPLETE",

  /* §37 reproducibility */
  REPRODUCIBILITY_COMPONENT_MISMATCH: "REPRODUCIBILITY_COMPONENT_MISMATCH"
} as const;

export type EvolutionIdentityCode = (typeof EVOLUTION_IDENTITY_CODES)[keyof typeof EVOLUTION_IDENTITY_CODES];

/**
 * §12: the codes that are recorded but do not, on their own, refuse a run.
 * `TEST_FILE_ADDED` is informational — a *new* test file cannot make the locked
 * inventory weaker, so it is growth to review, not tampering to stop. It still
 * changes the manifest hash (the inventory moved), so a caller that wants the
 * strict reading can use the raw problem list.
 */
export const INFORMATIONAL_IDENTITY_CODES: readonly string[] = [EVOLUTION_IDENTITY_CODES.TEST_FILE_ADDED];

/** The problems that are failures (§12: TEST_FILE_ADDED on its own is not one). */
export function failuresOf(problems: readonly TrustProblem[]): TrustProblem[] {
  return problems.filter((problem) => INFORMATIONAL_IDENTITY_CODES.indexOf(problem.code) < 0);
}

/** PASS when nothing but informational codes was reported. */
export function identityVerdict(problems: readonly TrustProblem[]): "PASS" | "FAIL" {
  return failuresOf(problems).length === 0 ? "PASS" : "FAIL";
}

/* ------------------------------------------------------------------ *
 * Shared value types
 * ------------------------------------------------------------------ */

/** One identified file: a repository-relative POSIX path and its SHA-256. */
export interface HashedPath {
  path: string;
  sha256: string;
}

/** §9: the source snapshot taken when certification starts. */
export interface SourceFreeze {
  files: HashedPath[];
  /** Hash over `files`; identical sources always produce the same value. */
  aggregate_hash: string;
  file_count: number;
  computed_at: string;
}

/** §10: what the certification actually depends on. */
export interface DependencyIdentity {
  lockfile_sha256: string;
  node: string;
  pnpm: string;
  electron: string;
  platform: string;
  arch: string;
}

/** §7/§8: the recorded build, bound to the commit and the tree that produced it. */
export interface BuildManifest {
  source_commit: string;
  source_tree: string;
  files: HashedPath[];
  per_file_sha256: Record<string, string>;
  aggregate_build_hash: string;
  node_version: string;
  pnpm_version: string;
  electron_version: string;
  platform: string;
  arch: string;
  built_at: string;
}

/** The parts of a build identity the aggregate hash covers (never `built_at`). */
export interface BuildIdentityParts {
  source_commit: string;
  source_tree: string;
  files: readonly HashedPath[];
  node_version: string;
  pnpm_version: string;
  electron_version: string;
  platform: string;
  arch: string;
}

/** The contract data a snapshot hashes; the host reads it, this layer never does. */
export interface IdentityContract {
  gate: string;
  contract_version: string;
  required_ids: readonly string[];
  out_of_scope_ids?: readonly string[];
}

/** §11: one immutable contract snapshot per certification session. */
export interface ContractSnapshot {
  contract_snapshot_hash: string;
  acceptance_contract_version: string;
  desktop_contract_version: string;
  desktop_contract_hash: string;
  capability_count: number;
  gate_count: number;
  trust_policy: HashedPath[];
}

export interface ContractSnapshotInput {
  acceptance_contract_version: string;
  contracts: readonly IdentityContract[];
  desktop_contract: IdentityContract;
  /** §2.7 digest of the desktop contract itself. */
  desktop_contract_hash: string;
  capability_gates: Readonly<Record<string, readonly string[]>>;
  trust_policy: readonly HashedPath[];
}

/** §12: one statically extracted case — `it` has only a title, `scenario` an id. */
export interface TestCase {
  id?: string;
  title: string;
}

/** The inventory of a single test source file. */
export interface TestFileInventory {
  describe: string[];
  cases: TestCase[];
}

/** What a scanner measures for one test file (no source text, only identity). */
export interface TestInventoryEntry {
  path: string;
  sha256: string;
  describe: readonly string[];
  cases: readonly TestCase[];
}

export interface TestManifestFile {
  path: string;
  sha256: string;
  describe: string[];
  cases: TestCase[];
  case_count: number;
}

export type TestCategory = "acceptance" | "unit" | "other";

/** §12: the locked test inventory. */
export interface TestManifest {
  files: TestManifestFile[];
  file_count: number;
  case_count: number;
  manifest_hash: string;
  categories: { acceptance: number; unit: number; other: number };
}

/** §13: a formal Requirement Retirement Record. */
export interface RequirementRetirement {
  old_id: string;
  reason: string;
  replacement: string;
  migration: string;
  risk: string;
  gate?: string;
  recorded_at?: string;
}

export interface RemovedRequirement {
  gate: string;
  id: string;
  retirement?: RequirementRetirement;
}

export interface AddedRequirement {
  gate: string;
  id: string;
}

/** §13 outcome labels for the required acceptance surface. */
export const SURFACE_VERDICTS = {
  UNCHANGED: "UNCHANGED",
  ACCEPTANCE_SURFACE_REGRESSION: "ACCEPTANCE_SURFACE_REGRESSION",
  ACCEPTANCE_SURFACE_GROWN: "ACCEPTANCE_SURFACE_GROWN",
  RETIRED_WITH_RECORD: "RETIRED_WITH_RECORD"
} as const;

export type SurfaceVerdict = (typeof SURFACE_VERDICTS)[keyof typeof SURFACE_VERDICTS];

export interface RequiredIdSurfaceComparison {
  verdict: SurfaceVerdict;
  removed: RemovedRequirement[];
  added: AddedRequirement[];
  /** True while at least one removed id has no complete retirement record. */
  retirement_records_required: boolean;
  retired: string[];
  unretired: string[];
}

/** Gate name → the ids that must PASS. */
export type RequiredIdCounts = Readonly<Record<string, readonly string[]>>;

/** §37: the reproducibility digest an A/B clone pair must agree on. */
export interface ReproducibilityInput {
  commit: string;
  tree: string;
  lockfile: string;
  contract_snapshot_hash: string;
  test_manifest_hash: string;
  build_manifest_hash: string;
  capability_registry_hash: string;
}

export interface ReproducibilityDigest extends ReproducibilityInput {
  reproducibility_hash: string;
}

/** The §37 components, in one place so nothing silently drops out of the digest. */
export const REPRODUCIBILITY_FIELDS: readonly (keyof ReproducibilityInput)[] = [
  "commit",
  "tree",
  "lockfile",
  "contract_snapshot_hash",
  "test_manifest_hash",
  "build_manifest_hash",
  "capability_registry_hash"
];

/* ------------------------------------------------------------------ *
 * Canonical hashing
 * ------------------------------------------------------------------ */

/**
 * Deterministic JSON: object keys sorted at every depth. §37 hashes must not
 * depend on how a value happened to be built, so this is the only serialisation
 * the identity layer hashes. (It mirrors the canonical form the evidence layer
 * already uses; kept local so this module depends on nothing but `hash.ts`.)
 */
export function canonicalIdentityText(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortKeys(entry));
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeys(source[key]);
    return sorted;
  }
  return value;
}

/** SHA-256 over the canonical serialisation of any identity value. */
export function canonicalIdentityDigest(value: unknown): string {
  return sha256Hex(canonicalIdentityText(value));
}

/** The `path → sha256` projection of a hashed file list. */
export function flatHashMap(entries: readonly HashedPath[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries) map[entry.path] = entry.sha256;
  return map;
}

/** The `[path, sha256]` pairs, path-sorted, that every aggregate is built from. */
export function sortedHashPairs(entries: readonly HashedPath[]): [string, string][] {
  return entries
    .map((entry): [string, string] => [entry.path, entry.sha256])
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}

/** §9: the aggregate identity of a hashed file set. */
export function aggregateIdentityHash(entries: readonly HashedPath[]): string {
  return canonicalIdentityDigest(sortedHashPairs(entries));
}

/**
 * §7/§8: the build aggregate. Unlike §9's source aggregate it also binds the
 * commit, the tree and the runtime that produced the artifacts, so "old dist +
 * new source" cannot hash to the same build.
 */
export function buildManifestAggregate(parts: BuildIdentityParts): string {
  return canonicalIdentityDigest({
    source_commit: parts.source_commit,
    source_tree: parts.source_tree,
    files: sortedHashPairs(parts.files),
    node_version: parts.node_version,
    pnpm_version: parts.pnpm_version,
    electron_version: parts.electron_version,
    platform: parts.platform,
    arch: parts.arch
  });
}

/* ------------------------------------------------------------------ *
 * §44: expected-vs-actual comparison
 * ------------------------------------------------------------------ */

export interface FlatHashDiff {
  changed: string[];
  missing: string[];
  added: string[];
  unchanged: string[];
}

/** Compares two `path → sha256` maps; every list is path-sorted. */
export function compareFlatHashes(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>
): FlatHashDiff {
  const changed: string[] = [];
  const missing: string[] = [];
  const unchanged: string[] = [];
  for (const path of Object.keys(expected).sort()) {
    if (!Object.prototype.hasOwnProperty.call(actual, path)) missing.push(path);
    else if (actual[path] !== expected[path]) changed.push(path);
    else unchanged.push(path);
  }
  const added = Object.keys(actual)
    .filter((path) => !Object.prototype.hasOwnProperty.call(expected, path))
    .sort();
  return { changed, missing, added, unchanged };
}

/** The codes a set comparison reports; `added` and `aggregate` are optional. */
export interface IdentityComparisonCodes {
  changed: string;
  missing: string;
  added?: string;
  aggregate?: string;
}

export interface IdentityComparison {
  expected: readonly HashedPath[];
  actual: readonly HashedPath[];
  expected_aggregate: string;
  actual_aggregate: string;
  codes: IdentityComparisonCodes;
}

/**
 * The one place a frozen identity is compared with what is on disk now, so the
 * source freeze (§9), the build manifest (§7) and the test inventory (§12) all
 * report the same way. The `detail` is machine-usable: `path` for a missing or
 * added file, `path:expected:actual` for a changed one, `expected:actual` for an
 * aggregate.
 */
export function identityProblemsFrom(input: IdentityComparison): TrustProblem[] {
  const expected = flatHashMap(input.expected);
  const actual = flatHashMap(input.actual);
  const diff = compareFlatHashes(expected, actual);
  const problems: TrustProblem[] = [];
  for (const path of diff.missing) problems.push(trustProblem(input.codes.missing, path));
  for (const path of diff.changed) problems.push(trustProblem(input.codes.changed, `${path}:${expected[path]}:${actual[path]}`));
  if (input.codes.added !== undefined) {
    for (const path of diff.added) problems.push(trustProblem(input.codes.added, path));
  }
  if (input.codes.aggregate !== undefined && input.expected_aggregate !== input.actual_aggregate) {
    problems.push(trustProblem(input.codes.aggregate, `${input.expected_aggregate}:${input.actual_aggregate}`));
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * §10/§11: dependency identity and the contract snapshot
 * ------------------------------------------------------------------ */

/** The pnpm version from `packageManager`, or the raw value when it is not pnpm. */
export function pnpmVersionOf(packageManager: unknown): string {
  if (typeof packageManager !== "string") return "";
  const separator = packageManager.indexOf("@");
  if (separator < 0) return packageManager;
  return packageManager.slice(separator + 1);
}

/** The declared version of a dependency, as `package.json` states it. */
export function declaredDependencyVersion(packageJson: unknown, name: string): string {
  if (packageJson === null || typeof packageJson !== "object") return "";
  const source = packageJson as Record<string, unknown>;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const group = source[field];
    if (group === null || typeof group !== "object") continue;
    const value = (group as Record<string, unknown>)[name];
    if (typeof value === "string") return value;
  }
  return "";
}

function contractIdentity(contract: IdentityContract): IdentityContract {
  return {
    gate: contract.gate,
    contract_version: contract.contract_version,
    required_ids: [...contract.required_ids],
    out_of_scope_ids: [...(contract.out_of_scope_ids ?? [])]
  };
}

/**
 * §11: hash the acceptance contracts, the desktop black-box contract and its
 * digest, the capability mapping and the trust policy files into one immutable
 * snapshot. Data in, hash out — the host does the reading.
 */
export function contractSnapshot(input: ContractSnapshotInput): ContractSnapshot {
  const contracts = [...input.contracts]
    .map(contractIdentity)
    .sort((left, right) => (left.gate < right.gate ? -1 : left.gate > right.gate ? 1 : 0));
  const desktop = contractIdentity(input.desktop_contract);
  const trustPolicy = [...input.trust_policy].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
  const capabilityCount = Object.keys(input.capability_gates).length;
  return {
    contract_snapshot_hash: canonicalIdentityDigest({
      acceptance_contract_version: input.acceptance_contract_version,
      contracts,
      desktop_contract: desktop,
      desktop_contract_hash: input.desktop_contract_hash,
      capability_gates: input.capability_gates,
      trust_policy: sortedHashPairs(trustPolicy)
    }),
    acceptance_contract_version: input.acceptance_contract_version,
    desktop_contract_version: desktop.contract_version,
    desktop_contract_hash: input.desktop_contract_hash,
    capability_count: capabilityCount,
    gate_count: contracts.length,
    trust_policy: trustPolicy
  };
}

/* ------------------------------------------------------------------ *
 * §12: the test inventory lock
 * ------------------------------------------------------------------ */

/**
 * The static inventory pattern. Four declarations are recognised, in source
 * order, each in a single- or double-quoted or in a template literal:
 *
 *   describe("…")           → the describe block title
 *   it("…") / it('…')       → one executable case title
 *   scenario("ID", "title") → one declared requirement id plus its title
 *
 * A template literal containing `${` is deliberately *not* a case: a title that
 * is computed at runtime is not a static inventory entry, and pretending it is
 * would make the locked hash lie. The scan is syntactic — it reads the source
 * text, never executes it — so a title inside a comment counts; that is the
 * price of an inventory that cannot be defeated by importing the suite.
 */
const TEST_INVENTORY_PATTERN =
  /\bdescribe\s*\(\s*(["'`])([^"'`$]*)\1|\bit\s*\(\s*(["'`])([^"'`$]*)\3|\bscenario\s*\(\s*(["'`])([^"'`$]*)\5\s*,\s*(["'`])([^"'`$]*)\7/g;

/** The categories §12 records for a test path. */
export const TEST_CATEGORY_SEGMENTS: Readonly<Record<string, TestCategory>> = {
  acceptance: "acceptance",
  unit: "unit"
};

/** The category of a repository-relative test path (last known directory wins). */
export function testCategoryOf(relativePath: string): TestCategory {
  const segments = relativePath.split("/").slice(0, -1);
  let category: TestCategory = "other";
  for (const segment of segments) {
    const known = TEST_CATEGORY_SEGMENTS[segment];
    if (known !== undefined) category = known;
  }
  return category;
}

/** Extracts the inventory a test source file declares (describe blocks + cases). */
export function extractTestInventory(source: string): TestFileInventory {
  const describe: string[] = [];
  const cases: TestCase[] = [];
  for (const match of source.matchAll(TEST_INVENTORY_PATTERN)) {
    if (match[2] !== undefined) describe.push(match[2]);
    else if (match[4] !== undefined) cases.push({ title: match[4] });
    else if (match[6] !== undefined && match[8] !== undefined) cases.push({ id: match[6], title: match[8] });
  }
  return { describe, cases };
}

/**
 * Builds the §12 manifest from scanned files. Both counts and the hash are
 * derived here, so a manifest edited by hand no longer reproduces its own
 * `manifest_hash` and `verifyTestManifest` can see it.
 */
export function testManifestFrom(files: readonly TestInventoryEntry[]): TestManifest {
  const entries: TestManifestFile[] = files
    .map((file) => ({
      path: file.path,
      sha256: file.sha256,
      describe: [...file.describe],
      cases: file.cases.map((entry) => (entry.id === undefined ? { title: entry.title } : { id: entry.id, title: entry.title })),
      case_count: file.cases.length
    }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const caseCount = entries.reduce((total, entry) => total + entry.case_count, 0);
  const categories = { acceptance: 0, unit: 0, other: 0 };
  for (const entry of entries) categories[testCategoryOf(entry.path)] += 1;
  return {
    files: entries,
    file_count: entries.length,
    case_count: caseCount,
    categories,
    manifest_hash: canonicalIdentityDigest({
      files: entries.map((entry) => [entry.path, entry.sha256, entry.case_count]),
      file_count: entries.length,
      case_count: caseCount
    })
  };
}

/* ------------------------------------------------------------------ *
 * §13: required-id monotonicity and Requirement Retirement Records
 * ------------------------------------------------------------------ */

/** A retirement record only counts when it explains all five required fields. */
export function requirementRetirementComplete(record: RequirementRetirement | undefined): boolean {
  if (record === undefined) return false;
  return [record.old_id, record.reason, record.replacement, record.migration, record.risk].every(
    (value) => typeof value === "string" && value.trim() !== ""
  );
}

/** The gate → required-id counts of a contract list, for a §13 comparison. */
export function requiredIdCountsOf(contracts: readonly IdentityContract[]): Record<string, string[]> {
  const counts: Record<string, string[]> = {};
  for (const contract of contracts) counts[contract.gate] = [...contract.required_ids];
  return counts;
}

/**
 * §13: the required acceptance surface may not shrink without a formal record.
 * A removed id that a complete record names is `RETIRED_WITH_RECORD`; a removed
 * id without one is `ACCEPTANCE_SURFACE_REGRESSION` — never silently absorbed by
 * the fact that the candidate still runs green.
 */
export function compareRequiredIdSurface(
  baselineCounts: RequiredIdCounts,
  candidateCounts: RequiredIdCounts,
  retirements: readonly RequirementRetirement[] = []
): RequiredIdSurfaceComparison {
  const removed: RemovedRequirement[] = [];
  const added: AddedRequirement[] = [];
  const gates = [...new Set([...Object.keys(baselineCounts), ...Object.keys(candidateCounts)])].sort();
  for (const gate of gates) {
    const before = [...(baselineCounts[gate] ?? [])];
    const after = new Set(candidateCounts[gate] ?? []);
    for (const id of before) {
      if (after.has(id)) continue;
      const retirement = retirements.find(
        (record) => record.old_id === id && (record.gate === undefined || record.gate === gate) && requirementRetirementComplete(record)
      );
      removed.push(retirement === undefined ? { gate, id } : { gate, id, retirement });
    }
    for (const id of candidateCounts[gate] ?? []) {
      if (before.indexOf(id) < 0) added.push({ gate, id });
    }
  }
  const unretired = removed.filter((entry) => entry.retirement === undefined).map((entry) => entry.id);
  const retired = removed.filter((entry) => entry.retirement !== undefined).map((entry) => entry.id);
  const verdict: SurfaceVerdict =
    removed.length === 0
      ? added.length > 0
        ? SURFACE_VERDICTS.ACCEPTANCE_SURFACE_GROWN
        : SURFACE_VERDICTS.UNCHANGED
      : unretired.length > 0
        ? SURFACE_VERDICTS.ACCEPTANCE_SURFACE_REGRESSION
        : SURFACE_VERDICTS.RETIRED_WITH_RECORD;
  return { verdict, removed, added, retirement_records_required: unretired.length > 0, retired, unretired };
}

/* ------------------------------------------------------------------ *
 * §37: the reproducibility digest
 * ------------------------------------------------------------------ */

/** §37: hash the seven components, so one changed component changes the digest. */
export function reproducibilityDigest(input: ReproducibilityInput): ReproducibilityDigest {
  const components: ReproducibilityInput = {
    commit: input.commit,
    tree: input.tree,
    lockfile: input.lockfile,
    contract_snapshot_hash: input.contract_snapshot_hash,
    test_manifest_hash: input.test_manifest_hash,
    build_manifest_hash: input.build_manifest_hash,
    capability_registry_hash: input.capability_registry_hash
  };
  return { ...components, reproducibility_hash: canonicalIdentityDigest(components) };
}

/** The §37 components that differ between two digests (empty when they agree). */
export function reproducibilityDiff(left: ReproducibilityDigest, right: ReproducibilityDigest): string[] {
  const differing: string[] = REPRODUCIBILITY_FIELDS.filter((field) => left[field] !== right[field]);
  if (left.reproducibility_hash !== right.reproducibility_hash) differing.push("reproducibility_hash");
  return differing;
}

/** §37: two clones reproduce each other only when every component agrees. */
export function reproducibilityEqual(left: ReproducibilityDigest, right: ReproducibilityDigest): boolean {
  return reproducibilityDiff(left, right).length === 0;
}

/** §37 as structured problems, so an A/B comparison needs no prose either. */
export function reproducibilityProblems(left: ReproducibilityDigest, right: ReproducibilityDigest): TrustProblem[] {
  return reproducibilityDiff(left, right).map((field) =>
    trustProblem(EVOLUTION_IDENTITY_CODES.REPRODUCIBILITY_COMPONENT_MISMATCH, field)
  );
}
