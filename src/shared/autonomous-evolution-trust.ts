/**
 * Update-Plan/self-evlo.md §2, §3, §4, §14, §16, §28–§34, §49–§52, §75, §77, §79, §91
 * — Phase C: the autonomous self-modification boundary.
 *
 * §2.1 states the invariant this module implements: Boss may modify product code, but
 * it may never rewrite the rules that certify the modification and then certify itself
 * with them. The boundary is expressed here as pure data plus pure decisions:
 *
 *   §3            `ROOT_TRUST_SURFACE_PATHS` / `classifySurface` / `rootSurfaceManifest`
 *   §4            `TrustEpochRecord`, `epochHashOf`, `verifyTrustEpoch`, `advanceTrustEpoch`
 *   §4/§51/§75    `judgeSelfCertification` — ROOT_TRUST_CHANGE ⇒ SELF_CERTIFICATION_FORBIDDEN
 *   §14/§91       `assessCapabilityRegistry`, `capabilityEvidenceGraph`
 *   §28–§30       `EVOLUTION_RUN_STATES`, `advanceRunState`, `assertCandidateImmutable`
 *   §31–§34       `forcePushDecision`, `autonomousBranchFor`, `rollbackPlan`, `containmentPath`
 *   §49/§50       `assessBudget`, `assessScope`
 *   §16/§77/§79   `assessBaseline`, `replayAttackVerdict`
 *
 * Everything here is a pure function of its arguments: no fs, no clock, no process, no
 * network. The host (and the acceptance suite) reads real files, digests them and passes
 * the result in as a `{ path, sha256 }` inventory; clocks are passed in as `createdAt`.
 * Decisions are `TrustProblem` values (§44) — the `reason`, `steps` and `note` strings
 * are display projections and must never be branched on.
 *
 * Path matching reuses the repository's existing Root Surface protection
 * (`normalizeRepoPath` + `codeownersPatternToRegExp` from
 * `src/shared/root-authority/protected-surface.ts`) so this boundary normalizes paths,
 * rejects escapes and anchors globs exactly the way the host guard already does. It is a
 * *separate* boundary from `ROOT_PROTECTED_MANIFEST`: that manifest decides which changes
 * need Owner approval, this one decides which changes invalidate the trust epoch. Root
 * Trust Surface ⊆ nothing — the plan's §3 list adds paths (contracts, verification
 * helpers, trust-policy data) that the Owner-review guard does not cover.
 */

import { CAPABILITY_GATES } from "./acceptance-contracts";
import { sha256Hex } from "./hash";
import { codeownersPatternToRegExp, normalizeRepoPath } from "./root-authority/protected-surface";
import { trustProblem, type TrustProblem } from "./trust-problems";

/** Machine codes this boundary branches on. Never match on prose (§44). */
export const EVOLUTION_TRUST_CODES = {
  OK: "OK",
  SELF_CERTIFICATION_FORBIDDEN: "SELF_CERTIFICATION_FORBIDDEN",
  TRUST_EPOCH_MISSING: "TRUST_EPOCH_MISSING",
  TRUST_EPOCH_SCHEMA_UNSUPPORTED: "TRUST_EPOCH_SCHEMA_UNSUPPORTED",
  TRUST_EPOCH_HASH_MISMATCH: "TRUST_EPOCH_HASH_MISMATCH",
  TRUST_EPOCH_ROOT_SURFACE_MISMATCH: "TRUST_EPOCH_ROOT_SURFACE_MISMATCH",
  TRUST_EPOCH_PARENT_MISMATCH: "TRUST_EPOCH_PARENT_MISMATCH",
  CANDIDATE_COMMIT_CHANGED: "CANDIDATE_COMMIT_CHANGED",
  CANDIDATE_TREE_CHANGED: "CANDIDATE_TREE_CHANGED",
  RUN_STATE_JUMP_REFUSED: "RUN_STATE_JUMP_REFUSED",
  RUN_STATE_UNKNOWN: "RUN_STATE_UNKNOWN",
  FORCE_PUSH_DENIED: "FORCE_PUSH_DENIED",
  MAIN_FORCE_PUSH_DENIED: "MAIN_FORCE_PUSH_DENIED",
  ROLLBACK_BASELINE_MISSING: "ROLLBACK_BASELINE_MISSING",
  ROLLBACK_WORKTREE_DIRTY: "ROLLBACK_WORKTREE_DIRTY",
  RUN_BUDGET_EXCEEDED: "RUN_BUDGET_EXCEEDED",
  SCOPE_VIOLATION: "SCOPE_VIOLATION",
  STALE_BASELINE: "STALE_BASELINE"
} as const;

/* -------------------------------------------------------------------------- */
/* §2/§3 — the four surfaces and the Root Trust Surface                        */
/* -------------------------------------------------------------------------- */

/** §2: the four trust tiers. ROOT_TRUST_SURFACE outranks every other tier. */
export type SurfaceClass = "PRODUCT_SURFACE" | "EVOLUTION_ENGINE" | "VERIFICATION_SURFACE" | "ROOT_TRUST_SURFACE";

/**
 * §3's literal list, verbatim. These are the paths the plan names by hand; they are the
 * part of the boundary that existed before Phase C and must keep classifying identically.
 */
export const PLAN_SECTION_3_ROOT_TRUST_PATHS: readonly string[] = [
  "src/shared/acceptance-contracts.ts",
  "src/shared/acceptance-evidence.ts",
  "src/shared/bootstrap-audit.ts",
  "src/shared/owner-intervention.ts",

  "electron/engineering/acceptance-session.ts",
  "electron/engineering/bootstrap-completion.ts",
  "electron/engineering/owner-intervention-ledger.ts",

  "scripts/acceptance-attest.cjs",
  "scripts/acceptance-prestart.cjs",
  "scripts/acceptance-session-start.cjs",

  ".github/workflows/ci.yml",

  "tests/acceptance/**",
  "tests/helpers/trusted-evidence.ts"
];

/**
 * §3's "以及未来所有" (and all future) entries plus the Phase C additions: the epoch, the
 * evolution engine's own trust/identity modules and the data this boundary reads.
 *
 * The two bare globs are §3's literal wording — "all future `autonomous-evolution-*.ts` /
 * `acceptance-evolution-*.cjs`", wherever they live — so e.g.
 * `electron/engineering/autonomous-evolution-identity.ts` is Root Trust even though the
 * directory around it is not. That is deliberate: root trust outranks §2's engine tier, and
 * a candidate-identity module is a judge. The qualified entries below it are the locations
 * Phase C names by hand; they are redundant with the globs and kept so the boundary reads
 * the way the plan and the task describe it.
 */
export const ROOT_TRUST_SURFACE_EXTENSIONS: readonly string[] = [
  "autonomous-evolution-*.ts",
  "acceptance-evolution-*.cjs",
  "trust-policy/**",
  "src/shared/autonomous-evolution-*.ts",
  "scripts/acceptance-evolution-*.cjs",
  "scripts/acceptance-autonomous-evolution.cjs",
  "src/shared/trust-problems.ts",
  "tests/acceptance/autonomous-evolution-*.test.ts",
  "tests/helpers/acceptance-report.ts"
];

/**
 * §3: everything the current autonomous run may change only by opening a new trust epoch.
 * Machine-generated data mirror: `trust-policy/root-trust-surface.json`.
 */
export const ROOT_TRUST_SURFACE_PATHS: readonly string[] = [
  ...PLAN_SECTION_3_ROOT_TRUST_PATHS,
  ...ROOT_TRUST_SURFACE_EXTENSIONS
];

/** §2: verification surface — changeable, but only with a higher-grade re-certification. */
export const VERIFICATION_SURFACE_PATHS: readonly string[] = [
  "src/shared/acceptance-*.ts",
  "src/shared/bootstrap-audit.ts",
  "src/shared/owner-intervention.ts",
  "scripts/acceptance-*.cjs",
  ".github/**",
  "tests/**"
];

/** §2: evolution engine — changeable under controlled conditions. */
export const EVOLUTION_ENGINE_PATHS: readonly string[] = [
  "electron/self-evolution/**",
  "electron/stable-candidate/**",
  "electron/promotion-gate/**",
  "src/shared/autonomous-evolution-*.ts"
];

interface CompiledSurfaceRule {
  pattern: string;
  surface: SurfaceClass;
  regex: RegExp;
}

/**
 * Root Trust first, then verification, then engine, then PRODUCT_SURFACE. The order is
 * the decision: a path that matches two tiers always resolves to the stricter one, so
 * `src/shared/acceptance-contracts.ts` (root trust and, by pattern, verification) is
 * ROOT_TRUST_SURFACE, and `tests/acceptance/**` (root trust and verification) likewise.
 */
const COMPILED_SURFACE_RULES: readonly CompiledSurfaceRule[] = [
  ...ROOT_TRUST_SURFACE_PATHS.map((pattern) => ({ pattern, surface: "ROOT_TRUST_SURFACE" as SurfaceClass })),
  ...VERIFICATION_SURFACE_PATHS.map((pattern) => ({ pattern, surface: "VERIFICATION_SURFACE" as SurfaceClass })),
  ...EVOLUTION_ENGINE_PATHS.map((pattern) => ({ pattern, surface: "EVOLUTION_ENGINE" as SurfaceClass }))
].map((rule) => ({ ...rule, regex: codeownersPatternToRegExp(rule.pattern, true) }));

/**
 * §2/§3: classifies a repo-relative path into its trust tier.
 *
 * Input must be repo-relative, like every other caller of `normalizeRepoPath`: an
 * absolute path, a `..` escape or a non-string cannot be attributed to this repository,
 * so it is NOT a Root Trust path (the caller must refuse it elsewhere — containment
 * failure is a different decision, see `assessProtectedPaths`). Matching is
 * case-insensitive, mirroring the host guard's Windows-safe default.
 */
export function classifySurface(path: string): SurfaceClass {
  const normalized = normalizeRepoPath(typeof path === "string" ? path : "");
  if (!normalized) return "PRODUCT_SURFACE";
  for (const rule of COMPILED_SURFACE_RULES) {
    if (rule.regex.test(normalized)) return rule.surface;
  }
  return "PRODUCT_SURFACE";
}

/* -------------------------------------------------------------------------- */
/* §3 — the machine-generated root surface manifest                            */
/* -------------------------------------------------------------------------- */

/** One file of a repository inventory: repo-relative path plus its content digest. */
export interface RootSurfaceFile {
  path: string;
  sha256: string;
}

export interface RootSurfaceManifest {
  /** Entry paths, sorted. */
  paths: string[];
  /** Sorted entries; `{ path, sha256 }` records are the manifest itself. */
  entries: RootSurfaceFile[];
  /** SHA-256 over the canonical manifest text (see `rootSurfaceManifestText`). */
  aggregate_hash: string;
  count: number;
}

/**
 * §4: the epoch file records the hash of the Root Trust Surface, so it cannot be part of
 * that surface — `h = H(files including the file that stores h)` has no general solution.
 * Every surface hash therefore excludes these paths. Editing the epoch file is still a
 * Root Trust change (it classifies as ROOT_TRUST_SURFACE), it just cannot move the hash
 * it stores.
 */
export const ROOT_SURFACE_HASH_EXCLUSIONS: readonly string[] = ["trust-policy/trust-epoch.json"];

export const ROOT_TRUST_SURFACE_FILENAME = "trust-policy/root-trust-surface.json";
export const TRUST_EPOCH_FILENAME = "trust-policy/trust-epoch.json";
export const REQUIREMENT_RETIREMENTS_FILENAME = "trust-policy/requirement-retirements.json";

/** Normalizes one inventory entry; a malformed entry keeps its raw text so it still hashes. */
function normalizedSurfaceFile(file: RootSurfaceFile): RootSurfaceFile {
  const record = file as { path?: unknown; sha256?: unknown } | null | undefined;
  const rawPath = typeof record?.path === "string" ? record.path : JSON.stringify(record?.path ?? null);
  const rawDigest = typeof record?.sha256 === "string" ? record.sha256 : JSON.stringify(record?.sha256 ?? null);
  return { path: normalizeRepoPath(rawPath) ?? rawPath, sha256: rawDigest };
}

/**
 * §3: projects a full repository inventory down to the Root Trust Surface.
 *
 * `excludeSelfReferential` defaults to true and drops `ROOT_SURFACE_HASH_EXCLUSIONS`, so
 * the result is exactly the file set a trust epoch may hash (§4).
 */
export function rootTrustSurfaceFiles(
  files: readonly RootSurfaceFile[],
  options: { excludeSelfReferential?: boolean } = {}
): RootSurfaceFile[] {
  const excludeSelfReferential = options.excludeSelfReferential ?? true;
  const seen = new Set<string>();
  const selected: RootSurfaceFile[] = [];
  for (const file of files) {
    const entry = normalizedSurfaceFile(file);
    if (excludeSelfReferential && ROOT_SURFACE_HASH_EXCLUSIONS.includes(entry.path)) continue;
    if (classifySurface(entry.path) !== "ROOT_TRUST_SURFACE") continue;
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    selected.push(entry);
  }
  return selected;
}

/** The canonical manifest text: one `path\tsha256` line per sorted entry, LF-joined. */
export function rootSurfaceManifestText(entries: readonly RootSurfaceFile[]): string {
  return entries.map((entry) => `${entry.path}\t${entry.sha256}`).join("\n");
}

/**
 * §3: the manifest that participates in the hash. Machine-generated, never hand-written:
 * the same entries in any order produce the same manifest, and one changed byte in any
 * file changes its digest and therefore `aggregate_hash`.
 *
 * `files` must already be the surface inventory (use `rootTrustSurfaceFiles` to project
 * one). Duplicate paths are folded deterministically: entries are sorted by
 * `(path, sha256)` and the first one wins.
 */
export function rootSurfaceManifest(files: readonly RootSurfaceFile[]): RootSurfaceManifest {
  const byPath = new Map<string, string>();
  const sorted = files
    .map(normalizedSurfaceFile)
    .slice()
    .sort((left, right) => (left.path === right.path ? (left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0) : left.path < right.path ? -1 : 1));
  for (const entry of sorted) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry.sha256);
  }
  const entries: RootSurfaceFile[] = [...byPath.entries()]
    .map(([path, sha256]) => ({ path, sha256 }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return {
    paths: entries.map((entry) => entry.path),
    entries,
    aggregate_hash: sha256Hex(rootSurfaceManifestText(entries)),
    count: entries.length
  };
}

/**
 * §3: the summary of what this module declares the Root Trust Surface to be.
 *
 * A declaration's identity is its pattern text, so each declared expression is digested
 * as itself and `boundary_hash` is a stable fingerprint of the boundary definition —
 * it changes when a tier is added, removed or reworded, and never because an unrelated
 * source file changed. `trust-policy/root-trust-surface.json` is exactly this value,
 * serialized by the acceptance suite (see its generation mode): the module is the
 * source, the committed JSON is machine-generated data for non-TypeScript consumers
 * (`.cjs` gates, the certificate verifier), and the suite refuses a hand edit of either
 * side by regenerating and comparing.
 */
export function declaredRootTrustSurface(): {
  schema_version: number;
  unit: string;
  generator: string;
  machine_generated: true;
  note: string;
  declared: { paths: string[]; count: number; boundary_hash: string };
} {
  const paths = [...ROOT_TRUST_SURFACE_PATHS];
  const boundary = rootSurfaceManifest(paths.map((path) => ({ path, sha256: sha256Hex(path) })));
  return {
    schema_version: 1,
    unit: "AUTONOMOUS_EVOLUTION_TRUST",
    generator: "src/shared/autonomous-evolution-trust.ts#declaredRootTrustSurface",
    machine_generated: true,
    note: "Do not hand-edit: regenerate from ROOT_TRUST_SURFACE_PATHS. A hand edit here is itself a Root Trust change (§3).",
    declared: { paths, count: paths.length, boundary_hash: boundary.aggregate_hash }
  };
}

/* -------------------------------------------------------------------------- */
/* §3/§51 — root trust change detection                                        */
/* -------------------------------------------------------------------------- */

export type RootTrustVerdict = "ROOT_TRUST_UNCHANGED" | "ROOT_TRUST_CHANGE";
export type SurfaceChangeKind = "ADDED" | "MODIFIED" | "REMOVED";

export interface SurfaceChange {
  path: string;
  kind: SurfaceChangeKind;
  /** §2 tier of the changed path. Only ROOT_TRUST_SURFACE raises the alarm. */
  surface: SurfaceClass;
}

export interface RootTrustChangeAssessment {
  verdict: RootTrustVerdict;
  /** Every added/modified/removed path of the diff, each with its tier. */
  changed: SurfaceChange[];
  /** True only when at least one changed path is ROOT_TRUST_SURFACE (§51). */
  rootTrustTouched: boolean;
  /** Root Trust Surface aggregate at the baseline (comparable to `root_surface_hash`). */
  sha256_before: string;
  /** Root Trust Surface aggregate at the candidate. */
  sha256_after: string;
}

function inventoryIndex(files: readonly RootSurfaceFile[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of files) {
    const entry = normalizedSurfaceFile(file);
    if (!index.has(entry.path)) index.set(entry.path, entry.sha256);
  }
  return index;
}

/**
 * §3/§51: compares two real inventories and classifies the diff.
 *
 * `changed` lists the whole diff (product edits included) so a report can show what the
 * run actually did; `rootTrustTouched` is raised only by ROOT_TRUST_SURFACE paths, and
 * `verdict` follows it. `sha256_before`/`sha256_after` are Root Trust Surface aggregates
 * (self-referential epoch file excluded), which is why they stay equal for a
 * product-only diff and can be compared against `TrustEpochRecord.root_surface_hash`.
 */
export function assessRootTrustChange(input: {
  baseline: readonly RootSurfaceFile[];
  candidate: readonly RootSurfaceFile[];
}): RootTrustChangeAssessment {
  const before = inventoryIndex(input.baseline);
  const after = inventoryIndex(input.candidate);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changed: SurfaceChange[] = [];
  for (const path of paths) {
    const beforeDigest = before.get(path);
    const afterDigest = after.get(path);
    const kind: SurfaceChangeKind | undefined =
      beforeDigest === undefined ? "ADDED" : afterDigest === undefined ? "REMOVED" : beforeDigest !== afterDigest ? "MODIFIED" : undefined;
    if (!kind) continue;
    changed.push({ path, kind, surface: classifySurface(path) });
  }
  const rootTrustTouched = changed.some((change) => change.surface === "ROOT_TRUST_SURFACE");
  return {
    verdict: rootTrustTouched ? "ROOT_TRUST_CHANGE" : "ROOT_TRUST_UNCHANGED",
    changed,
    rootTrustTouched,
    sha256_before: rootSurfaceManifest(rootTrustSurfaceFiles(input.baseline)).aggregate_hash,
    sha256_after: rootSurfaceManifest(rootTrustSurfaceFiles(input.candidate)).aggregate_hash
  };
}

/* -------------------------------------------------------------------------- */
/* §4 — trust epoch                                                            */
/* -------------------------------------------------------------------------- */

export const TRUST_EPOCH_SCHEMA_VERSION = 1;
export const ROOT_CONTRACT_VERSION_PREFIX = "boss-root-trust-";

export interface TrustEpochRecord {
  /** 1-based, monotonically increasing. */
  trust_epoch: number;
  /** `boss-root-trust-<trust_epoch>`; versioned with the epoch (§4). */
  root_contract_version: string;
  /** Root Trust Surface aggregate this epoch certifies. */
  root_surface_hash: string;
  /** `epochHashOf(previous)`, or "" for the genesis epoch. */
  parent_epoch_hash: string;
  created_at: string;
}

/** The on-disk shape of `trust-policy/trust-epoch.json`: the record plus its own digest. */
export interface TrustEpochFile {
  schema_version: number;
  record: TrustEpochRecord;
  epoch_hash: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractVersionFor(epoch: number): string {
  return `${ROOT_CONTRACT_VERSION_PREFIX}${epoch}`;
}

/**
 * §4: the digest that identifies a record. A domain prefix keeps this hash from ever
 * colliding with a source digest; every record field is covered, so no part of the epoch
 * identity can be edited without changing the digest the next epoch records as its parent.
 */
export function epochHashOf(record: TrustEpochRecord): string {
  const text = [
    "boss-trust-epoch-1",
    String(record?.trust_epoch),
    String(record?.root_contract_version),
    String(record?.root_surface_hash),
    String(record?.parent_epoch_hash),
    String(record?.created_at)
  ].join("\n");
  return sha256Hex(text);
}

function epochSchemaProblems(record: unknown): TrustProblem[] {
  if (!isObject(record)) return [trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_SCHEMA_UNSUPPORTED, "record is not an object")];
  const problems: TrustProblem[] = [];
  const epoch = record.trust_epoch;
  if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 1) {
    problems.push(trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_SCHEMA_UNSUPPORTED, `trust_epoch must be a positive integer (got ${JSON.stringify(epoch)})`));
  }
  const version = record.root_contract_version;
  if (typeof version !== "string" || (typeof epoch === "number" && version !== contractVersionFor(epoch))) {
    problems.push(
      trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_SCHEMA_UNSUPPORTED, `root_contract_version must be ${contractVersionFor(Number(epoch))} (got ${JSON.stringify(version)})`)
    );
  }
  const surfaceHash = record.root_surface_hash;
  if (typeof surfaceHash !== "string" || !SHA256_HEX.test(surfaceHash)) {
    problems.push(trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_SCHEMA_UNSUPPORTED, "root_surface_hash must be a 64-character sha256"));
  }
  const parentHash = record.parent_epoch_hash;
  if (typeof parentHash !== "string" || (parentHash !== "" && !SHA256_HEX.test(parentHash))) {
    problems.push(trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_SCHEMA_UNSUPPORTED, "parent_epoch_hash must be empty (genesis) or a 64-character sha256"));
  }
  const createdAt = record.created_at;
  if (typeof createdAt !== "string" || !createdAt.trim() || !Number.isFinite(Date.parse(createdAt))) {
    problems.push(trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_SCHEMA_UNSUPPORTED, "created_at must be an ISO-8601 timestamp"));
  }
  return problems;
}

/**
 * §4: verifies a record against the surface it is being used for.
 *
 * - `TRUST_EPOCH_MISSING`               no record at all — fail closed.
 * - `TRUST_EPOCH_SCHEMA_UNSUPPORTED`    malformed record, or a contract version that does
 *                                       not match its epoch number.
 * - `TRUST_EPOCH_HASH_MISMATCH`         the stored digest is not `epochHashOf(record)`.
 * - `TRUST_EPOCH_ROOT_SURFACE_MISMATCH` the record belongs to a different surface.
 * - `TRUST_EPOCH_PARENT_MISMATCH`       the recorded parent is not the previous record.
 *
 * `epochHash`/`parent` are optional so the pure decision can be reused, but a caller that
 * read the record from a file must pass both (or call `verifyTrustEpochFile`): without
 * them a tampered record cannot be detected.
 */
export function verifyTrustEpoch(input: {
  record: TrustEpochRecord | null | undefined;
  rootSurfaceHash: string;
  epochHash?: string;
  parent?: TrustEpochRecord | null;
}): TrustProblem[] {
  if (input.record === null || input.record === undefined) {
    return [trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_MISSING, "no trust epoch record is available")];
  }
  const problems = epochSchemaProblems(input.record);
  if (problems.length) return problems;

  if (typeof input.epochHash === "string" && input.epochHash !== epochHashOf(input.record)) {
    problems.push(
      trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_HASH_MISMATCH, `stored epoch hash ${input.epochHash} does not cover the record`)
    );
  }
  if (input.record.root_surface_hash !== input.rootSurfaceHash) {
    problems.push(
      trustProblem(
        EVOLUTION_TRUST_CODES.TRUST_EPOCH_ROOT_SURFACE_MISMATCH,
        `epoch ${input.record.trust_epoch} certifies ${input.record.root_surface_hash} but the surface is ${input.rootSurfaceHash}`
      )
    );
  }
  if (input.parent !== null && input.parent !== undefined) {
    const parentProblems = epochSchemaProblems(input.parent);
    const expectedParent = parentProblems.length ? undefined : epochHashOf(input.parent);
    if (parentProblems.length || input.record.parent_epoch_hash !== expectedParent) {
      problems.push(
        trustProblem(
          EVOLUTION_TRUST_CODES.TRUST_EPOCH_PARENT_MISMATCH,
          `epoch ${input.record.trust_epoch} records parent ${input.record.parent_epoch_hash || "(none)"}`
        )
      );
    } else if (input.parent.trust_epoch + 1 !== input.record.trust_epoch) {
      problems.push(
        trustProblem(
          EVOLUTION_TRUST_CODES.TRUST_EPOCH_PARENT_MISMATCH,
          `epoch ${input.parent.trust_epoch} cannot be the parent of epoch ${input.record.trust_epoch}`
        )
      );
    }
  }
  return problems;
}

/** §4: the file to write for a record. `epoch_hash` is what makes tampering visible. */
export function trustEpochFile(record: TrustEpochRecord, schemaVersion: number = TRUST_EPOCH_SCHEMA_VERSION): TrustEpochFile {
  const problems = epochSchemaProblems(record);
  if (problems.length) throw new Error(`trustEpochFile: ${problems.map((problem) => problem.code).join(", ")}`);
  return { schema_version: schemaVersion, record, epoch_hash: epochHashOf(record) };
}

/**
 * §4: structural parse of a `trust-policy/trust-epoch.json` value.
 *
 * Checks the schema *and* that the stored `epoch_hash` still covers the record, so a
 * hand-edited file is refused here rather than silently accepted by a later step.
 */
export function parseTrustEpochFile(value: unknown): { file?: TrustEpochFile; problems: TrustProblem[] } {
  if (value === null || value === undefined) {
    return { problems: [trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_MISSING, `${TRUST_EPOCH_FILENAME} is missing`)] };
  }
  if (!isObject(value)) {
    return { problems: [trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_SCHEMA_UNSUPPORTED, "the epoch file is not an object")] };
  }
  if (value.schema_version !== TRUST_EPOCH_SCHEMA_VERSION) {
    return {
      problems: [
        trustProblem(
          EVOLUTION_TRUST_CODES.TRUST_EPOCH_SCHEMA_UNSUPPORTED,
          `schema_version ${JSON.stringify(value.schema_version)} is not ${TRUST_EPOCH_SCHEMA_VERSION}`
        )
      ]
    };
  }
  const recordProblems = epochSchemaProblems(value.record);
  if (recordProblems.length) return { problems: recordProblems };
  const record = value.record as unknown as TrustEpochRecord;
  const storedHash = value.epoch_hash;
  if (typeof storedHash !== "string" || storedHash !== epochHashOf(record)) {
    return {
      problems: [trustProblem(EVOLUTION_TRUST_CODES.TRUST_EPOCH_HASH_MISMATCH, `stored epoch hash ${JSON.stringify(storedHash)} does not cover the record`)],
      file: { schema_version: TRUST_EPOCH_SCHEMA_VERSION, record, epoch_hash: typeof storedHash === "string" ? storedHash : "" }
    };
  }
  return { file: { schema_version: TRUST_EPOCH_SCHEMA_VERSION, record, epoch_hash: storedHash }, problems: [] };
}

/** §4: parse no-fail-open path — the caller cannot forget the stored digest. */
export function verifyTrustEpochFile(input: {
  value: unknown;
  rootSurfaceHash: string;
  parent?: TrustEpochRecord | null;
}): TrustProblem[] {
  const parsed = parseTrustEpochFile(input.value);
  if (!parsed.file) return parsed.problems;
  return verifyTrustEpoch({ record: parsed.file.record, rootSurfaceHash: input.rootSurfaceHash, epochHash: parsed.file.epoch_hash, parent: input.parent });
}

/**
 * §4: the next epoch. `trust_epoch + 1`, contract version bumped to
 * `boss-root-trust-<n+1>`, and `parent_epoch_hash` set to the previous record's digest.
 *
 * This is the *only* legitimate way to move the boundary: the plan's rule is
 * `EPOCH_N → root change → EPOCH_N+1 bootstrap → fresh CI → fresh certificate`, never
 * "edit the rules, then certify the edit with the edited rules". Malformed input throws,
 * because a written record that cannot verify is worse than a refused write.
 */
export function advanceTrustEpoch(input: {
  previous?: TrustEpochRecord | null;
  rootSurfaceHash: string;
  createdAt: string;
}): TrustEpochRecord {
  if (typeof input.rootSurfaceHash !== "string" || !SHA256_HEX.test(input.rootSurfaceHash)) {
    throw new Error("advanceTrustEpoch: rootSurfaceHash must be a 64-character sha256");
  }
  if (typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error("advanceTrustEpoch: createdAt must be an ISO-8601 timestamp");
  }
  const previousProblems = input.previous ? epochSchemaProblems(input.previous) : [];
  if (previousProblems.length) throw new Error(`advanceTrustEpoch: previous epoch is invalid (${previousProblems.map((problem) => problem.code).join(", ")})`);
  const nextEpoch = input.previous ? input.previous.trust_epoch + 1 : 1;
  return {
    trust_epoch: nextEpoch,
    root_contract_version: contractVersionFor(nextEpoch),
    root_surface_hash: input.rootSurfaceHash,
    parent_epoch_hash: input.previous ? epochHashOf(input.previous) : "",
    created_at: input.createdAt
  };
}

/* -------------------------------------------------------------------------- */
/* §4/§51/§75 — self-certification refusal                                     */
/* -------------------------------------------------------------------------- */

export type SelfCertificationCode = "SELF_CERTIFICATION_FORBIDDEN" | "OK";
export type RequiredAction = "TRUST_EPOCH_MIGRATION" | "NONE";
export type CertificationRunState = "ROOT_TRUST_CHANGED" | "ROOT_TRUST_STABLE";

export interface SelfCertificationVerdict {
  run_state: CertificationRunState;
  allowed: boolean;
  code: SelfCertificationCode;
  required_action: RequiredAction;
  /** Display only (§44): branch on `code`, never on this string. */
  reason: string;
}

/**
 * §4/§51/§75: may this run certify itself?
 *
 * A candidate whose diff touches the Root Trust Surface may NEVER produce
 * `AUTONOMOUS_EVOLUTION_CERTIFIED`: the run changed the judge, so the judge can no
 * longer speak for the change. The answer is `SELF_CERTIFICATION_FORBIDDEN` with
 * `TRUST_EPOCH_MIGRATION` — a new epoch, a full rebootstrap and fresh hostile tests.
 *
 * Missing or mismatched epochs fail closed the same way (§99): the run must first prove
 * which surface it is certifying. `reason` is display-only.
 */
export function judgeSelfCertification(input: {
  epoch: TrustEpochRecord | null | undefined;
  rootTrustChange: RootTrustChangeAssessment;
  runId: string;
}): SelfCertificationVerdict {
  const runId = typeof input.runId === "string" && input.runId.trim() ? input.runId.trim() : "(unbound-run)";
  const touched = input.rootTrustChange.rootTrustTouched;
  const runState: CertificationRunState = touched ? "ROOT_TRUST_CHANGED" : "ROOT_TRUST_STABLE";
  const epochProblems = verifyTrustEpoch({ record: input.epoch, rootSurfaceHash: input.rootTrustChange.sha256_after });

  if (touched) {
    const rootPaths = input.rootTrustChange.changed.filter((change) => change.surface === "ROOT_TRUST_SURFACE").map((change) => `${change.kind.toLowerCase()} ${change.path}`);
    return {
      run_state: runState,
      allowed: false,
      code: "SELF_CERTIFICATION_FORBIDDEN",
      required_action: "TRUST_EPOCH_MIGRATION",
      reason: `run ${runId} touched the Root Trust Surface (${rootPaths.join(", ") || "unknown path"}); the run that changes the judge may never certify itself — open a new trust epoch and rebootstrap`
    };
  }
  if (epochProblems.length) {
    return {
      run_state: runState,
      allowed: false,
      code: "SELF_CERTIFICATION_FORBIDDEN",
      required_action: "TRUST_EPOCH_MIGRATION",
      reason: `run ${runId} has no usable trust epoch for surface ${input.rootTrustChange.sha256_after} (${epochProblems.map((problem) => problem.code).join(", ")}); bootstrap the epoch before certifying`
    };
  }
  return {
    run_state: runState,
    allowed: true,
    code: "OK",
    required_action: "NONE",
    reason: `run ${runId} changed no Root Trust Surface path and epoch ${input.epoch?.trust_epoch} certifies this surface`
  };
}

/* -------------------------------------------------------------------------- */
/* §14/§91 — capability monotonicity and the capability evidence graph          */
/* -------------------------------------------------------------------------- */

export const CAPABILITY_STATES = ["ESTABLISHED", "DEGRADED", "REMOVED", "NEW", "UNKNOWN"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];
export type CapabilityRegistry = Readonly<Record<string, CapabilityState>>;

export type CapabilityVerdict = "CAPABILITY_UNCHANGED" | "CAPABILITY_REGRESSION" | "BREAKING_CAPABILITY_CHANGE" | "CAPABILITY_GROWN";

export interface CapabilityTransition {
  capability: string;
  from: CapabilityState;
  to: CapabilityState;
  /** A usable capability that became UNKNOWN or REMOVED: it may not graduate (§14). */
  breaking: boolean;
}

export interface CapabilityAssessment {
  verdict: CapabilityVerdict;
  transitions: CapabilityTransition[];
  /** Capabilities that left the registry (or became REMOVED) in the candidate. */
  removed: string[];
  /** Capabilities that fell to DEGRADED. */
  degraded: string[];
}

type TransitionClass = "UNCHANGED" | "GROWN" | "REGRESSED" | "BREAKING";

/**
 * §14: `ESTABLISHED → ESTABLISHED` is the only silent transition allowed. Losing a
 * capability (ESTABLISHED/DEGRADED → UNKNOWN or REMOVED) is breaking: a run may not
 * quietly delete what it cannot re-establish. NEW is "the candidate introduces this
 * capability", so it is not breaking by construction (§14).
 */
function classifyCapabilityTransition(from: CapabilityState, to: CapabilityState): TransitionClass {
  if (from === to) return "UNCHANGED";
  if (from === "NEW") return to === "ESTABLISHED" ? "GROWN" : "REGRESSED";
  if (to === "ESTABLISHED") return "GROWN";
  if (to === "UNKNOWN" || to === "REMOVED") return from === "ESTABLISHED" || from === "DEGRADED" ? "BREAKING" : "REGRESSED";
  // to === "DEGRADED" or to === "NEW" (a capability cannot become NEW again).
  return "REGRESSED";
}

/**
 * §14/§91: compares two capability registries.
 *
 * A capability missing from `baseline` is `NEW` (absent ⇒ introduced), and one missing
 * from `candidate` is `REMOVED` — fail closed, because a registry that silently drops a
 * key must not read as "unchanged". Verdict precedence is breaking > regression > growth.
 */
export function assessCapabilityRegistry(input: { baseline: CapabilityRegistry; candidate: CapabilityRegistry }): CapabilityAssessment {
  const baseline = input.baseline ?? {};
  const candidate = input.candidate ?? {};
  const capabilities = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort();
  const transitions: CapabilityTransition[] = [];
  const classes: TransitionClass[] = [];
  const removed: string[] = [];
  const degraded: string[] = [];
  for (const capability of capabilities) {
    const from: CapabilityState = baseline[capability] ?? "NEW";
    const to: CapabilityState = candidate[capability] ?? "REMOVED";
    if (to === "REMOVED" && from !== "REMOVED") removed.push(capability);
    if (to === "DEGRADED" && from !== "DEGRADED") degraded.push(capability);
    const transitionClass = classifyCapabilityTransition(from, to);
    if (transitionClass === "UNCHANGED") continue;
    transitions.push({ capability, from, to, breaking: transitionClass === "BREAKING" });
    classes.push(transitionClass);
  }
  // Breaking outranks a plain regression, which outranks growth, which outranks no change.
  const verdict: CapabilityVerdict = classes.includes("BREAKING")
    ? "BREAKING_CAPABILITY_CHANGE"
    : classes.includes("REGRESSED")
      ? "CAPABILITY_REGRESSION"
      : classes.length
        ? "CAPABILITY_GROWN"
        : "CAPABILITY_UNCHANGED";
  return { verdict, transitions, removed, degraded };
}

export interface CapabilityEvidence {
  capability: string;
  /** The trusted gates §91 binds this capability to. */
  gates: string[];
  /** True only when every bound gate has current trusted evidence. */
  established: boolean;
  /** Bound gates with no current trusted evidence. */
  missing_evidence: string[];
}

/**
 * §91: `each capability → one or more required gates → current trusted evidence`.
 *
 * `capabilityGates` defaults to the repository's canonical `CAPABILITY_GATES`, so the
 * certificate can prove the same 13 capabilities the bootstrap audit counts. A gate with
 * no current trusted evidence leaves its capability unestablished — and `missing_evidence`
 * names it, so a report never has to explain a boolean.
 */
export function capabilityEvidenceGraph(input: {
  capabilityGates?: Readonly<Record<string, readonly string[]>>;
  trustedGates: readonly string[];
}): CapabilityEvidence[] {
  const capabilityGates = input.capabilityGates ?? CAPABILITY_GATES;
  const trusted = new Set((input.trustedGates ?? []).filter((gate): gate is string => typeof gate === "string" && gate.trim() !== "").map((gate) => gate.trim()));
  return Object.keys(capabilityGates)
    .sort()
    .map((capability) => {
      const gates = [...new Set(capabilityGates[capability] ?? [])];
      const missingEvidence = gates.filter((gate) => !trusted.has(gate));
      return { capability, gates, established: gates.length > 0 && missingEvidence.length === 0, missing_evidence: missingEvidence };
    });
}

/* -------------------------------------------------------------------------- */
/* §28/§29/§30 — run state machine, promotion separation, candidate immutability */
/* -------------------------------------------------------------------------- */

export const EVOLUTION_RUN_STATES = [
  "CREATED",
  "BASELINE_VERIFIED",
  "PLANNED",
  "IMPLEMENTING",
  "CANDIDATE_READY",
  "VERIFYING",
  "REVIEWING",
  "CERTIFYING",
  "CERTIFIED",
  "PROMOTED"
] as const;

/** §28: the explicit exits. They are terminal: a failed run is contained, never resumed. */
export const EVOLUTION_FAILURE_STATES = ["FAILED", "ROLLED_BACK", "BLOCKED_EXTERNAL"] as const;

export type EvolutionRunState = (typeof EVOLUTION_RUN_STATES)[number];
export type EvolutionFailureState = (typeof EVOLUTION_FAILURE_STATES)[number];
export type EvolutionRunStatus = EvolutionRunState | EvolutionFailureState;

export const EVOLUTION_ALL_STATES: readonly EvolutionRunStatus[] = [...EVOLUTION_RUN_STATES, ...EVOLUTION_FAILURE_STATES];
export const EVOLUTION_TERMINAL_STATES: readonly EvolutionRunStatus[] = ["PROMOTED", "FAILED", "ROLLED_BACK", "BLOCKED_EXTERNAL"];

/**
 * §28/§29/§31: the forward path plus the explicit exits. There is no edge that skips a
 * step — `IMPLEMENTING → CERTIFIED` is not a transition, and `PROMOTED` is reachable
 * only from `CERTIFIED`, which is what keeps "push main, then verify" impossible.
 */
export const EVOLUTION_TRANSITIONS: Readonly<Record<EvolutionRunStatus, readonly EvolutionRunStatus[]>> = {
  CREATED: ["BASELINE_VERIFIED", "FAILED", "BLOCKED_EXTERNAL"],
  BASELINE_VERIFIED: ["PLANNED", "FAILED", "ROLLED_BACK", "BLOCKED_EXTERNAL"],
  PLANNED: ["IMPLEMENTING", "FAILED", "ROLLED_BACK", "BLOCKED_EXTERNAL"],
  IMPLEMENTING: ["CANDIDATE_READY", "FAILED", "ROLLED_BACK", "BLOCKED_EXTERNAL"],
  CANDIDATE_READY: ["VERIFYING", "FAILED", "ROLLED_BACK", "BLOCKED_EXTERNAL"],
  VERIFYING: ["REVIEWING", "FAILED", "ROLLED_BACK", "BLOCKED_EXTERNAL"],
  REVIEWING: ["CERTIFYING", "FAILED", "ROLLED_BACK", "BLOCKED_EXTERNAL"],
  CERTIFYING: ["CERTIFIED", "FAILED", "ROLLED_BACK", "BLOCKED_EXTERNAL"],
  CERTIFIED: ["PROMOTED", "FAILED", "ROLLED_BACK", "BLOCKED_EXTERNAL"],
  PROMOTED: [],
  FAILED: [],
  ROLLED_BACK: [],
  BLOCKED_EXTERNAL: []
};

/** §29: certification is not promotion. This is the only edge into PROMOTED. */
export const PROMOTION_EDGE = { from: "CERTIFIED", to: "PROMOTED" } as const;

export function isEvolutionRunStatus(value: unknown): value is EvolutionRunStatus {
  return typeof value === "string" && (EVOLUTION_ALL_STATES as readonly string[]).includes(value);
}

/** §28: true when `to` is an explicit transition of `from`. Jumps are refused. */
export function canAdvance(from: EvolutionRunStatus | string, to: EvolutionRunStatus | string): boolean {
  if (!isEvolutionRunStatus(from) || !isEvolutionRunStatus(to)) return false;
  return EVOLUTION_TRANSITIONS[from].includes(to);
}

export interface RunStateAdvance {
  ok: boolean;
  /** The state the run was in. On refusal the run stays here. */
  from: EvolutionRunStatus | string;
  /** The requested state; only applied when `ok`. */
  to: EvolutionRunStatus | string;
  problems: TrustProblem[];
}

/**
 * §28: applies one transition, or refuses it with a machine code. A jump, an unknown
 * state and any move out of a terminal state are all refused — including the tempting
 * `IMPLEMENTING → CERTIFIED` and the §29 shortcut `CERTIFIED → PROMOTED` without the
 * promotion gate (which is a separate, later decision the host makes).
 */
export function advanceRunState(current: EvolutionRunStatus | string, next: EvolutionRunStatus | string): RunStateAdvance {
  if (!isEvolutionRunStatus(current)) {
    return { ok: false, from: current, to: next, problems: [trustProblem(EVOLUTION_TRUST_CODES.RUN_STATE_UNKNOWN, `unknown run state ${JSON.stringify(current)}`)] };
  }
  if (!isEvolutionRunStatus(next)) {
    return { ok: false, from: current, to: next, problems: [trustProblem(EVOLUTION_TRUST_CODES.RUN_STATE_UNKNOWN, `unknown run state ${JSON.stringify(next)}`)] };
  }
  if (!canAdvance(current, next)) {
    const terminal = EVOLUTION_TERMINAL_STATES.includes(current) ? " (the run is terminal)" : "";
    return {
      ok: false,
      from: current,
      to: next,
      problems: [trustProblem(EVOLUTION_TRUST_CODES.RUN_STATE_JUMP_REFUSED, `${current} → ${next} is not a transition${terminal}`)]
    };
  }
  return { ok: true, from: current, to: next, problems: [] };
}

/** `advanceRunState`, but a refusal throws. For call sites where a jump is a bug. */
export function assertRunStateAdvance(current: EvolutionRunStatus | string, next: EvolutionRunStatus | string): EvolutionRunStatus {
  const advance = advanceRunState(current, next);
  if (!advance.ok) throw new Error(`run state refused: ${advance.problems.map((problem) => problem.code).join(", ")} (${current} → ${next})`);
  return next as EvolutionRunStatus;
}

/**
 * §30: the candidate commit is frozen once certification starts. Any later change is a
 * NEW_CANDIDATE / NEW_SESSION, never an amend that keeps the old evidence. A missing
 * identity is refused with the same codes as a mismatch: an unprovable candidate is not
 * an immutable one.
 */
export function assertCandidateImmutable(input: {
  candidateCommit: string;
  candidateTree: string;
  observedCommit: string;
  observedTree: string;
}): TrustProblem[] {
  const problems: TrustProblem[] = [];
  const candidateCommit = typeof input.candidateCommit === "string" ? input.candidateCommit.trim() : "";
  const observedCommit = typeof input.observedCommit === "string" ? input.observedCommit.trim() : "";
  const candidateTree = typeof input.candidateTree === "string" ? input.candidateTree.trim() : "";
  const observedTree = typeof input.observedTree === "string" ? input.observedTree.trim() : "";

  if (!candidateCommit) problems.push(trustProblem(EVOLUTION_TRUST_CODES.CANDIDATE_COMMIT_CHANGED, "the frozen candidate commit is missing"));
  else if (!observedCommit) problems.push(trustProblem(EVOLUTION_TRUST_CODES.CANDIDATE_COMMIT_CHANGED, `observed commit is missing (frozen ${candidateCommit})`));
  else if (candidateCommit !== observedCommit) {
    problems.push(trustProblem(EVOLUTION_TRUST_CODES.CANDIDATE_COMMIT_CHANGED, `frozen ${candidateCommit} != observed ${observedCommit}`));
  }

  if (!candidateTree) problems.push(trustProblem(EVOLUTION_TRUST_CODES.CANDIDATE_TREE_CHANGED, "the frozen candidate tree is missing"));
  else if (!observedTree) problems.push(trustProblem(EVOLUTION_TRUST_CODES.CANDIDATE_TREE_CHANGED, `observed tree is missing (frozen ${candidateTree})`));
  else if (candidateTree !== observedTree) {
    problems.push(trustProblem(EVOLUTION_TRUST_CODES.CANDIDATE_TREE_CHANGED, `frozen ${candidateTree} != observed ${observedTree}`));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* §31/§32/§33/§34 — force push, branch, rollback, containment                 */
/* -------------------------------------------------------------------------- */

export type ForcePushCode = "FORCE_PUSH_DENIED" | "MAIN_FORCE_PUSH_DENIED" | "OK";

export interface ForcePushDecision {
  denied: boolean;
  code: ForcePushCode;
}

/** Branch names that are always protected against an autonomous force push (§31). */
export const NEVER_FORCE_PUSHED_BRANCHES: readonly string[] = ["main", "master"];

export const AUTONOMOUS_BRANCH_PREFIX = "boss/evolution/";
export const EVOLUTION_ARTIFACTS_ROOT = "artifacts/evolution";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * §32: run ids become branch names and directory names, so they are validated before
 * they are used rather than escaped: a run id that cannot be a safe path segment is a
 * caller error, and refusing it is cheaper than proving an escaping scheme correct.
 */
export function isValidRunId(runId: unknown): runId is string {
  return typeof runId === "string" && RUN_ID.test(runId) && !runId.includes("..") && !runId.endsWith(".lock");
}

function requireRunId(runId: unknown): string {
  if (!isValidRunId(runId)) throw new Error(`invalid evolution run id ${JSON.stringify(runId)}: expected [A-Za-z0-9][A-Za-z0-9._-]* without ".." or a .lock suffix`);
  return runId;
}

/** §32: every run writes its candidate branch first — never main. */
export function autonomousBranchFor(runId: string): string {
  return `${AUTONOMOUS_BRANCH_PREFIX}${requireRunId(runId)}`;
}

/** §34: the run's private namespace; a new run always gets a new one. */
export function namespaceFor(runId: string): string {
  return `evolution-${requireRunId(runId)}`;
}

/** §34: where a failed run's artifacts, reports, builds and state are contained. */
export function containmentPath(runId: string): string {
  return `${EVOLUTION_ARTIFACTS_ROOT}/history/${requireRunId(runId)}/`;
}

/** Force-class push operations: rewriting history, deleting refs, or mirroring. */
function isForceClassArgument(argument: string): boolean {
  if (typeof argument !== "string") return false;
  const value = argument.trim();
  if (!value) return false;
  // `--force`, `--force-with-lease`, `--force-with-lease=<ref>`, and fail-closed on any
  // other `--force*` spelling.
  if (value.startsWith("--force")) return true;
  // `--mirror` deletes remote refs; `--delete` removes them. Both are force-class.
  if (value === "--mirror" || value === "--delete") return true;
  // Short clusters: `-f`, `-fd`, `-uf`, `-d`, ...
  if (/^-[A-Za-z]*f[A-Za-z]*$/.test(value)) return true;
  if (/^-[A-Za-z]*d[A-Za-z]*$/.test(value)) return true;
  // Forced refspec: `+refs/heads/x:refs/heads/y`, `+main`.
  if (value.startsWith("+") && value.length > 1) return true;
  return false;
}

function destinationBranch(refspec: string): string {
  const withoutForce = refspec.startsWith("+") ? refspec.slice(1) : refspec;
  const destination = withoutForce.includes(":") ? withoutForce.slice(withoutForce.indexOf(":") + 1) : withoutForce;
  return destination.startsWith("refs/heads/") ? destination.slice("refs/heads/".length) : destination;
}

/**
 * §31: decides a `git push` argument vector.
 *
 * Force-class arguments are denied by default; an explicit Root Policy may lift the
 * denial for a named non-protected branch, but never for main/master, and never when the
 * destination cannot be identified (an unnamed destination may be main — fail closed).
 */
export function forcePushDecision(
  argv: readonly string[],
  options: { mainBranch: string; policyAllows: boolean }
): ForcePushDecision {
  const args = (argv ?? []).filter((argument): argument is string => typeof argument === "string");
  const force = args.some(isForceClassArgument);
  if (!force) return { denied: false, code: "OK" };

  const protectedBranches = new Set([options.mainBranch, ...NEVER_FORCE_PUSHED_BRANCHES].filter((branch): branch is string => typeof branch === "string" && branch !== ""));
  const words = args
    .map((argument) => argument.trim())
    .filter((argument) => argument !== "" && !argument.startsWith("-") && argument !== "git" && argument !== "push");
  // `git push <remote> <refspec>...` — with a single positional there is no explicit
  // refspec unless the argument itself is one (`+main`, `HEAD:main`, `refs/heads/main`).
  const refspecs = words.length >= 2 ? words.slice(1) : words.filter((word) => word.startsWith("+") || word.includes(":") || word.startsWith("refs/"));

  const targets = refspecs.map(destinationBranch).filter((branch) => branch !== "");
  if (targets.some((branch) => protectedBranches.has(branch))) {
    return { denied: true, code: "MAIN_FORCE_PUSH_DENIED" };
  }
  if (targets.length === 0) return { denied: true, code: "FORCE_PUSH_DENIED" };
  if (!options.policyAllows) return { denied: true, code: "FORCE_PUSH_DENIED" };
  return { denied: false, code: "OK" };
}

export interface RollbackPlan {
  branch: string;
  baseline_commit: string;
  baseline_tree: string;
  /** The observed identity the rollback is meant to undo. */
  observed_commit: string;
  observed_tree: string;
  /** True when HEAD and TREE already equal the recorded baseline. */
  already_at_baseline: boolean;
  /** Display/execution data (§33). Not a decision input. */
  steps: string[];
}

/**
 * §33: the rollback contract. The run records its baseline identity before it touches
 * code; a failed run restores it and re-verifies HEAD and TREE.
 *
 * `ok` is "the rollback may be executed as planned". A dirty worktree is a refusal, not a
 * warning: §34 requires the run to be contained (its uncommitted state moved to
 * `containmentPath(runId)`) before a `reset --hard` discards it. A missing baseline
 * identity is a refusal too — there would be nothing to restore.
 */
export function rollbackPlan(input: {
  baselineCommit: string;
  baselineTree: string;
  branch: string;
  worktreeStatus: string;
  observedCommit: string;
  observedTree: string;
}): { ok: boolean; problems: TrustProblem[]; plan: RollbackPlan } {
  const baselineCommit = typeof input.baselineCommit === "string" ? input.baselineCommit.trim() : "";
  const baselineTree = typeof input.baselineTree === "string" ? input.baselineTree.trim() : "";
  const branch = typeof input.branch === "string" ? input.branch.trim() : "";
  const worktreeStatus = typeof input.worktreeStatus === "string" ? input.worktreeStatus.trim() : "";
  const observedCommit = typeof input.observedCommit === "string" ? input.observedCommit.trim() : "";
  const observedTree = typeof input.observedTree === "string" ? input.observedTree.trim() : "";

  const problems: TrustProblem[] = [];
  if (!baselineCommit || !baselineTree || !branch) {
    problems.push(
      trustProblem(
        EVOLUTION_TRUST_CODES.ROLLBACK_BASELINE_MISSING,
        `baseline_commit=${baselineCommit || "(missing)"} baseline_tree=${baselineTree || "(missing)"} branch=${branch || "(missing)"}`
      )
    );
  }
  if (worktreeStatus) {
    problems.push(trustProblem(EVOLUTION_TRUST_CODES.ROLLBACK_WORKTREE_DIRTY, `the worktree has uncommitted state: ${worktreeStatus.split(/\r?\n/)[0]}`));
  }

  const alreadyAtBaseline = baselineCommit !== "" && observedCommit === baselineCommit && observedTree === baselineTree;
  const steps: string[] = [];
  if (!alreadyAtBaseline) {
    if (worktreeStatus) steps.push("contain the failed run's uncommitted state under artifacts/evolution/history/<run-id>/ (§34)");
    if (branch) steps.push(`git checkout ${branch}`);
    steps.push(`git reset --hard ${baselineCommit || "<baseline_commit>"}`);
    steps.push("git clean -fd");
  }
  steps.push(`git rev-parse HEAD  # must equal ${baselineCommit || "<baseline_commit>"}`);
  steps.push(`git rev-parse HEAD^{tree}  # must equal ${baselineTree || "<baseline_tree>"}`);

  return {
    ok: problems.length === 0,
    problems,
    plan: {
      branch,
      baseline_commit: baselineCommit,
      baseline_tree: baselineTree,
      observed_commit: observedCommit,
      observed_tree: observedTree,
      already_at_baseline: alreadyAtBaseline,
      steps
    }
  };
}

/* -------------------------------------------------------------------------- */
/* §49/§50 — budget and scope enforcement                                      */
/* -------------------------------------------------------------------------- */

export interface EvolutionBudget {
  max_changed_files: number;
  max_changed_loc: number;
  max_iterations: number;
  max_repair_attempts: number;
  max_test_retries: number;
  max_wall_clock_ms: number;
}

/** §49: the default per-run ceiling. Thirty minutes of wall clock, 25 files, 600 lines. */
export const DEFAULT_EVOLUTION_BUDGET: EvolutionBudget = {
  max_changed_files: 25,
  max_changed_loc: 600,
  max_iterations: 4,
  max_repair_attempts: 2,
  max_test_retries: 2,
  max_wall_clock_ms: 30 * 60 * 1000
};

/** Usage keys mirror the budget keys without the `max_` prefix. */
export interface EvolutionUsage {
  changed_files?: number;
  changed_loc?: number;
  iterations?: number;
  repair_attempts?: number;
  test_retries?: number;
  wall_clock_ms?: number;
}

export type BudgetCode = "RUN_BUDGET_EXCEEDED" | "OK";

export interface BudgetBreach {
  limit: keyof EvolutionBudget;
  allowed: number;
  used: number;
}

/**
 * §49: exceeding any limit ends the run (`RUN_BUDGET_EXCEEDED`); the next attempt is a new
 * run, never an unbounded self-repair. A non-finite usage value counts as infinite — an
 * unmeasurable run cannot be shown to be inside its budget.
 */
export function assessBudget(input: { budget?: Partial<EvolutionBudget>; usage?: EvolutionUsage }): {
  exceeded: boolean;
  code: BudgetCode;
  breaches: BudgetBreach[];
} {
  const budget: EvolutionBudget = { ...DEFAULT_EVOLUTION_BUDGET, ...(input.budget ?? {}) };
  const usage = input.usage ?? {};
  const pairs: readonly (readonly [keyof EvolutionBudget, keyof EvolutionUsage])[] = [
    ["max_changed_files", "changed_files"],
    ["max_changed_loc", "changed_loc"],
    ["max_iterations", "iterations"],
    ["max_repair_attempts", "repair_attempts"],
    ["max_test_retries", "test_retries"],
    ["max_wall_clock_ms", "wall_clock_ms"]
  ];
  const breaches: BudgetBreach[] = [];
  for (const [limit, usageKey] of pairs) {
    const allowed = Number.isFinite(budget[limit]) ? budget[limit] : 0;
    const rawUsed = usage[usageKey];
    const used = typeof rawUsed === "number" && Number.isFinite(rawUsed) ? rawUsed : rawUsed === undefined ? 0 : Number.POSITIVE_INFINITY;
    if (used > allowed) breaches.push({ limit, allowed, used });
  }
  return { exceeded: breaches.length > 0, code: breaches.length ? "RUN_BUDGET_EXCEEDED" : "OK", breaches };
}

export interface EvolutionScope {
  /** Patterns the plan is allowed to touch at all. */
  allowed_files: readonly string[];
  /** Patterns the plan expects to touch; an allowed but unexpected file is a violation. */
  expected_files: readonly string[];
  /** Patterns that are never allowed, whatever `allowed_files` says. */
  forbidden_files: readonly string[];
}

export type ScopeViolationKind = "NOT_ALLOWED" | "FORBIDDEN" | "UNEXPECTED";
export type ScopeVerdict = "SCOPE_OK" | "SCOPE_VIOLATION";

export interface ScopeViolation {
  path: string;
  kind: ScopeViolationKind;
}

/**
 * §50/§51: the real diff must match the declared plan.
 *
 * The Root Trust Surface is a hard floor: a changed Root Trust path is FORBIDDEN even
 * when the plan listed it in `allowed_files`, and it is reported in `never_allowed` so
 * the caller can raise ROOT_TRUST_CHANGE (§51) instead of pretending a scope violation
 * is an ordinary planning mistake. Precedence per path is FORBIDDEN > NOT_ALLOWED >
 * UNEXPECTED, one violation per path.
 */
export function assessScope(input: { declared: EvolutionScope; changed: readonly string[] }): {
  verdict: ScopeVerdict;
  violations: ScopeViolation[];
  never_allowed: string[];
} {
  const declared = input.declared;
  const compilers = (patterns: readonly string[] | undefined): RegExp[] =>
    (patterns ?? [])
      .filter((pattern): pattern is string => typeof pattern === "string" && pattern.trim() !== "")
      .map((pattern) => codeownersPatternToRegExp(pattern.trim(), true));
  const allowed = compilers(declared?.allowed_files);
  const expected = compilers(declared?.expected_files);
  const forbidden = compilers(declared?.forbidden_files);

  const violations: ScopeViolation[] = [];
  const neverAllowed: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.changed ?? []) {
    const rawText = typeof raw === "string" ? raw : String(raw);
    if (seen.has(rawText)) continue;
    seen.add(rawText);
    const path = normalizeRepoPath(rawText);
    if (!path) {
      // An absolute path or a `..` escape cannot be attributed to this repository, so it
      // can never be an allowed file. `never_allowed` stays reserved for Root Trust paths.
      violations.push({ path: rawText, kind: "FORBIDDEN" });
      continue;
    }
    const isRootTrust = classifySurface(path) === "ROOT_TRUST_SURFACE";
    if (isRootTrust) neverAllowed.push(path);
    if (isRootTrust || forbidden.some((regex) => regex.test(path))) {
      violations.push({ path, kind: "FORBIDDEN" });
      continue;
    }
    if (!allowed.some((regex) => regex.test(path))) {
      violations.push({ path, kind: "NOT_ALLOWED" });
      continue;
    }
    if (!expected.some((regex) => regex.test(path))) {
      violations.push({ path, kind: "UNEXPECTED" });
    }
  }
  return { verdict: violations.length ? "SCOPE_VIOLATION" : "SCOPE_OK", violations, never_allowed: neverAllowed };
}

/* -------------------------------------------------------------------------- */
/* §16/§77/§79 — baseline currency and replay                                  */
/* -------------------------------------------------------------------------- */

export type BaselineVerdict = "BASELINE_CURRENT" | "STALE_BASELINE";

/**
 * §79/§16: a certificate carries the baseline commit it was produced against. If main has
 * moved, the certificate may not be merged directly — rebase/replay and a fresh
 * certificate are required. A missing commit on either side is STALE_BASELINE: currency
 * that cannot be shown is not currency.
 */
export function assessBaseline(input: { certificateBaselineCommit: string; currentMainCommit: string }): {
  verdict: BaselineVerdict;
  code: string;
} {
  const baseline = typeof input.certificateBaselineCommit === "string" ? input.certificateBaselineCommit.trim() : "";
  const current = typeof input.currentMainCommit === "string" ? input.currentMainCommit.trim() : "";
  if (!baseline || !current || baseline !== current) {
    return { verdict: "STALE_BASELINE", code: EVOLUTION_TRUST_CODES.STALE_BASELINE };
  }
  return { verdict: "BASELINE_CURRENT", code: EVOLUTION_TRUST_CODES.OK };
}

/** The five bindings §77 requires a certificate to carry. */
export const REPLAY_BINDING_FIELDS = ["session_id", "commit", "tree", "build_hash", "run_id"] as const;
export type ReplayBindingField = (typeof REPLAY_BINDING_FIELDS)[number];
export type ReplayBinding = Readonly<Record<ReplayBindingField, string>>;

/**
 * §77: copied evidence from an earlier run must fail on at least one of session, commit,
 * tree, build hash or run id. Every field is compared, an empty value on either side is a
 * mismatch (fail closed), and a missing certificate reports `certificate`.
 */
export function replayAttackVerdict(input: {
  certificate: Partial<ReplayBinding> | null | undefined;
  current: Partial<ReplayBinding> | null | undefined;
}): { replayed: boolean; mismatches: string[] } {
  if (input.certificate === null || input.certificate === undefined || typeof input.certificate !== "object") {
    return { replayed: true, mismatches: ["certificate"] };
  }
  if (input.current === null || input.current === undefined || typeof input.current !== "object") {
    return { replayed: true, mismatches: ["current"] };
  }
  const mismatches: string[] = [];
  for (const field of REPLAY_BINDING_FIELDS) {
    const fromCertificate = typeof input.certificate[field] === "string" ? input.certificate[field]!.trim() : "";
    const fromCurrent = typeof input.current[field] === "string" ? input.current[field]!.trim() : "";
    if (!fromCertificate || !fromCurrent || fromCertificate !== fromCurrent) mismatches.push(field);
  }
  return { replayed: mismatches.length > 0, mismatches };
}
