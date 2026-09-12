/**
 * Update-Plan/self-evlo.md §20–§23, §43/§44, §76–§78 — the Phase E adversarial lab.
 *
 * This module is the machinery the `autonomous-evolution-adversarial` acceptance suite
 * attacks through. It builds a *real* workspace — a real git repository, a real
 * acceptance session, real report files, real SHA-256 attestations, a real Owner
 * ledger, real snapshots and a real certificate written with the repository's atomic
 * writer — and then offers mutators that change those real bytes. Every judgement is
 * taken by production code:
 *
 *   • `createBootstrapAuditor` / `evaluateTrustedBootstrap` (the real host auditor),
 *   • `validateGateReport` / `validateDesktopBlackBoxReport` (the strict report
 *     contract) and `verifyGateAttestation` (the provenance sidecar),
 *   • `sessionProblems`, `verifyOwnerLedger`, `readGitIdentity` (the graduation-time
 *     identity lock of `scripts/acceptance-prestart.cjs` §2),
 *   • `sha256File`, `canonicalSha256`, `writeFileAtomicSync`, `hashOnceStable`.
 *
 * HONESTY NOTES (they are reproduced in the acceptance report, see
 * `evolutionHarnessNotes()`), because they bound what these attacks prove:
 *
 *   1. `scripts/acceptance-prestart.cjs` is the authoritative Prestart graduation
 *      command, but it is not importable: it self-executes on require. The composed
 *      verdict below (`graduate`) mirrors that command's step order and calls the same
 *      production readers/validators it loads from `dist-electron`. `assertScriptMirrors`
 *      proves the script still contains the identity codes and the check order this
 *      lab mirrors, so the mirror cannot rot silently.
 *   2. The Phase D/E evolution modules named by §3/§7–§12/§47
 *      (`src/shared/autonomous-evolution-*.ts`, `scripts/acceptance-evolution-*.cjs`)
 *      did not exist in this checkout when this suite was written. The artifacts the
 *      plan requires for them (`contract-snapshot.json`, `test-manifest.json`,
 *      `build-manifest.json`, `dependency-identity.json`,
 *      `autonomous-evolution-attestation.json`) are therefore written *here*, with
 *      the plan's own field names and real hashes, and re-verified by re-derivation.
 *      `evolutionHarnessNotes()` records exactly which production module was missing.
 *   3. Nothing in this module ever decides a case by matching prose: every refusal is
 *      reported as a structured `AttackProblem { code, detail? }` (§44). Reasons are
 *      rendered for humans only.
 *
 * Pure-fixture helpers live in `root-fixtures.ts` / `acceptance-report.ts`; this file
 * adds only what the hostile cases need.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { commit, gitRepo, revParse, tempDir, write as writeFixtureFile } from "./root-fixtures";
import { cleanGateReport, desktopBlackBoxReport } from "./acceptance-report";
import {
  ACCEPTANCE_GATE_CONTRACTS,
  ACCEPTANCE_SUPPORTING_CONTRACTS,
  ALL_ACCEPTANCE_CONTRACTS,
  DESKTOP_BLACK_BOX_CONTRACT,
  type AcceptanceGateContract
} from "../../src/shared/acceptance-contracts";
import {
  buildGateAttestation,
  canonicalJson,
  canonicalSha256,
  sessionProblems,
  validateDesktopBlackBoxReport,
  validateGateReport,
  verifyGateAttestation,
  type AcceptanceSession,
  type GateAttestation
} from "../../src/shared/acceptance-evidence";
import { emptyOwnerLedger, ownerLedgerHashOf, verifyOwnerLedger, type OwnerInterventionLedger } from "../../src/shared/owner-intervention";
import {
  PLAN_SECTION_3_ROOT_TRUST_PATHS,
  ROOT_TRUST_SURFACE_EXTENSIONS,
  ROOT_TRUST_SURFACE_PATHS,
  assessBaseline,
  replayAttackVerdict
} from "../../src/shared/autonomous-evolution-trust";
import { TRUST_CODES, type TrustProblem } from "../../src/shared/trust-problems";
import type { TrustedBootstrapAudit } from "../../src/shared/bootstrap-audit";
import {
  acceptanceDirectory,
  attestationDirectory,
  attestationPath,
  inspectSession,
  readGitIdentity,
  readJsonFile,
  reportPath,
  sessionPath,
  sha256File,
  startAcceptanceSession,
  SESSION_FILE
} from "../../electron/engineering/acceptance-session";
import { ownerLedgerPath, writeOwnerLedger, OWNER_LEDGER_FILE } from "../../electron/engineering/owner-intervention-ledger";
import { createBootstrapAuditor } from "../../electron/engineering/bootstrap-completion";
import { hashOnceStable, writeFileAtomicSync } from "../../electron/engineering/atomic-file";

/* ------------------------------------------------------------------ *
 * Fixture clock and identity
 * ------------------------------------------------------------------ */

/** The frozen instant the lab's session, attestations and reports use. */
export const LAB_INSTANT = "2026-06-01T00:00:00.000Z";
const WINDOW_START = Date.parse(LAB_INSTANT);
const WINDOW_END = WINDOW_START + 60 * 60 * 1000;
/** A deterministic instant inside the run window. */
export function labTime(offsetMs = 0): string {
  return new Date(WINDOW_START + offsetMs).toISOString();
}

/** §43/§44: the structured truth this lab reports. */
export interface AttackProblem {
  code: string;
  detail?: string;
}

export function problem(code: string, detail?: string): AttackProblem {
  return detail === undefined ? { code } : { code, detail };
}

export function renderProblems(problems: readonly AttackProblem[]): string[] {
  return problems.map((entry) => (entry.detail === undefined ? entry.code : `${entry.code}:${entry.detail}`));
}

export function hasCode(problems: readonly AttackProblem[], code: string): boolean {
  return problems.some((entry) => entry.code === code);
}

function fromTrustProblems(problems: readonly TrustProblem[]): AttackProblem[] {
  return problems.map((entry) => (entry.detail === undefined ? { code: entry.code } : { code: entry.code, detail: entry.detail }));
}

/* ------------------------------------------------------------------ *
 * §3 Root Trust Surface
 * ------------------------------------------------------------------ */

/**
 * §3: the surface list is imported from the evolution trust module itself
 * (`src/shared/autonomous-evolution-trust.ts`), not re-typed here — the boundary this
 * suite attacks is the boundary that module declares.
 */
export const ROOT_TRUST_SURFACE_PATTERNS: readonly string[] = [
  ...new Set([...PLAN_SECTION_3_ROOT_TRUST_PATHS, ...ROOT_TRUST_SURFACE_PATHS])
];

/**
 * §9: the freeze also covers the files that decide what "the same source" means — the
 * manifest, the lockfile and the ignore rules — so the lab hashes them alongside §3.
 */
export const ROOT_TRUST_SURFACE_EXTRA_PATHS: readonly string[] = [
  "package.json",
  "pnpm-lock.yaml",
  ".gitignore",
  "src/shared/hash.ts",
  "electron/engineering/atomic-file.ts"
];

/** Kept for readers of the report: the globs that make new evolution modules root trust. */
export const ROOT_TRUST_SURFACE_GLOBS: readonly string[] = [...ROOT_TRUST_SURFACE_EXTENSIONS];

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  // CODEOWNERS semantics: a pattern without a slash matches at any depth.
  return glob.includes("/") ? new RegExp(`^${body}$`) : new RegExp(`(^|/)${body}$`);
}

function matchesGlob(relative: string, glob: string): boolean {
  return globToRegExp(glob).test(relative);
}

function listFiles(root: string, directory = ""): string[] {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...listFiles(root, relative));
    else if (entry.isFile()) found.push(relative);
  }
  return found;
}

/** Every §3 surface file that exists in `root`, sorted, forward slashes. */
export function rootTrustSurfaceFiles(root: string): string[] {
  const present = new Set(listFiles(root).filter((entry) => !entry.startsWith("node_modules/") && !entry.startsWith(".git/") && !entry.startsWith("artifacts/")));
  const patterns = [...ROOT_TRUST_SURFACE_PATTERNS, ...ROOT_TRUST_SURFACE_EXTRA_PATHS];
  return [...present].filter((entry) => patterns.some((pattern) => matchesGlob(entry, pattern))).sort();
}

export type SurfaceHashes = Record<string, string>;

export function hashFiles(root: string, files: readonly string[]): SurfaceHashes {
  const hashes: SurfaceHashes = {};
  for (const file of files) hashes[file] = sha256File(path.join(root, ...file.split("/")));
  return hashes;
}

/** §3/§9: the surface manifest must be machine generated and participate in the hash. */
export function surfaceManifestHash(hashes: SurfaceHashes): string {
  return canonicalSha256(Object.keys(hashes).sort().map((file) => ({ file, sha256: hashes[file] })));
}

export function surfaceProblems(before: SurfaceHashes, after: SurfaceHashes): AttackProblem[] {
  const problems: AttackProblem[] = [];
  for (const file of Object.keys(before).sort()) {
    const now = after[file];
    if (now === undefined || now === "") problems.push(problem("ROOT_TRUST_SURFACE_MISSING", file));
    else if (now !== before[file]) problems.push(problem("ROOT_TRUST_SURFACE_CHANGED", file));
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * §11 contract snapshot
 * ------------------------------------------------------------------ */

export interface ContractSnapshot {
  schemaVersion: number;
  taken_at: string;
  acceptance_contract_version: string;
  gates: { gate: string; contract_version: string; required_ids: string[]; out_of_scope_ids: string[]; report_file: string; exact_ids: boolean }[];
  snapshot_hash: string;
}

export function contractSnapshotBody(contracts: readonly AcceptanceGateContract[], takenAt: string) {
  return {
    schemaVersion: 1,
    taken_at: takenAt,
    acceptance_contract_version: "acceptance-contracts-1",
    gates: contracts.map((contract) => ({
      gate: contract.gate,
      contract_version: contract.contract_version,
      required_ids: [...contract.required_ids],
      out_of_scope_ids: contract.out_of_scope_ids.map((entry) => entry.id),
      report_file: contract.report_file,
      exact_ids: contract.exact_ids === true
    }))
  };
}

export function contractSnapshotOf(contracts: readonly AcceptanceGateContract[], takenAt = LAB_INSTANT): ContractSnapshot {
  const body = contractSnapshotBody(contracts, takenAt);
  return { ...body, snapshot_hash: canonicalSha256(body) };
}

/** §11: the live contracts may not be re-interpreted against a session snapshot. */
export function contractSnapshotProblems(snapshot: unknown, contracts: readonly AcceptanceGateContract[]): AttackProblem[] {
  const problems: AttackProblem[] = [];
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return [problem("CONTRACT_SNAPSHOT_MISSING")];
  const stored = snapshot as Partial<ContractSnapshot>;
  const { snapshot_hash: storedHash, ...storedBody } = stored as ContractSnapshot;
  if (canonicalSha256(storedBody) !== storedHash) problems.push(problem("CONTRACT_SNAPSHOT_HASH_MISMATCH", String(storedHash)));
  const gates = Array.isArray(stored.gates) ? stored.gates : [];
  if (!Array.isArray(stored.gates)) problems.push(problem("CONTRACT_SNAPSHOT_GATES_INVALID", typeof stored.gates));
  for (const contract of contracts) {
    // §23: a verifier must never throw on a mutated snapshot — a missing or retyped
    // gate entry is a refusal with a code, not an exception.
    const entry = gates.find((candidate) => candidate !== null && typeof candidate === "object" && (candidate as { gate?: unknown }).gate === contract.gate) as
      { required_ids?: unknown; contract_version?: unknown } | undefined;
    if (!entry) {
      problems.push(problem("REQUIRED_SOURCE_MISSING", contract.gate));
      continue;
    }
    const required = Array.isArray(entry.required_ids) ? entry.required_ids : [];
    if (!Array.isArray(entry.required_ids)) problems.push(problem("CONTRACT_REQUIRED_IDS_INVALID", contract.gate));
    if (canonicalJson(required) !== canonicalJson([...contract.required_ids])) {
      problems.push(problem("CONTRACT_REQUIRED_IDS_CHANGED", `${contract.gate}:${required.length}!=${contract.required_ids.length}`));
    }
    if (entry.contract_version !== contract.contract_version) {
      problems.push(problem("CONTRACT_VERSION_CHANGED", `${contract.gate}:${String(entry.contract_version)}!=${contract.contract_version}`));
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * §12 test inventory lock
 * ------------------------------------------------------------------ */

export interface TestManifest {
  schemaVersion: number;
  taken_at: string;
  files: { file: string; sha256: string }[];
  manifest_hash: string;
}

export function testManifestOf(root: string, files: readonly string[], takenAt = LAB_INSTANT): TestManifest {
  const body = {
    schemaVersion: 1,
    taken_at: takenAt,
    files: files.map((file) => ({ file, sha256: sha256File(path.join(root, ...file.split("/"))) }))
  };
  return { ...body, manifest_hash: canonicalSha256(body) };
}

export function testManifestProblems(manifest: unknown, root: string): AttackProblem[] {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return [problem("TEST_MANIFEST_MISSING")];
  const stored = manifest as Partial<TestManifest>;
  const problems: AttackProblem[] = [];
  const files = Array.isArray(stored.files) ? stored.files : [];
  for (const entry of files) {
    const current = sha256File(path.join(root, ...entry.file.split("/")));
    if (current === "") problems.push(problem("TEST_FILE_MISSING", entry.file));
    else if (current !== entry.sha256) problems.push(problem("TEST_FILE_CHANGED", entry.file));
  }
  const { manifest_hash: storedHash, ...body } = stored as TestManifest;
  if (canonicalSha256(body) !== storedHash) problems.push(problem("TEST_MANIFEST_HASH_MISMATCH", String(storedHash)));
  return problems;
}

/* ------------------------------------------------------------------ *
 * §7/§8 build artifact identity
 * ------------------------------------------------------------------ */

export interface BuildManifest {
  schemaVersion: number;
  built_at: string;
  source_commit: string;
  source_tree: string;
  build_files: string[];
  per_file_sha256: Record<string, string>;
  aggregate_build_hash: string;
  node_version: string;
  pnpm_version: string;
  electron_version: string;
  platform: string;
  arch: string;
}

export function buildManifestOf(root: string, files: readonly string[], identity: { commit_sha: string; tree_sha: string }, builtAt = LAB_INSTANT): BuildManifest {
  const perFile: Record<string, string> = {};
  for (const file of [...files].sort()) perFile[file] = sha256File(path.join(root, ...file.split("/")));
  const body = {
    schemaVersion: 1,
    built_at: builtAt,
    source_commit: identity.commit_sha,
    source_tree: identity.tree_sha,
    build_files: [...files].sort(),
    per_file_sha256: perFile,
    aggregate_build_hash: canonicalSha256(perFile),
    node_version: process.version,
    pnpm_version: pnpmVersionOf(root),
    electron_version: electronVersionOf(root),
    platform: process.platform,
    arch: process.arch
  };
  return body;
}

function pnpmVersionOf(root: string): string {
  const parsed = readJsonFile(path.join(root, "package.json")) as { packageManager?: unknown } | undefined;
  return typeof parsed?.packageManager === "string" ? parsed.packageManager.replace(/^pnpm@/, "") : "";
}

function electronVersionOf(root: string): string {
  const parsed = readJsonFile(path.join(root, "package.json")) as { dependencies?: Record<string, unknown> } | undefined;
  const value = parsed?.dependencies?.electron;
  return typeof value === "string" ? value : "";
}

export function buildIdentityProblems(manifest: unknown, root: string, identity: { commit_sha: string; tree_sha: string }): AttackProblem[] {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return [problem("BUILD_MANIFEST_MISSING")];
  const stored = manifest as Partial<BuildManifest>;
  const problems: AttackProblem[] = [];
  // §8: an old dist may never be paired with new source.
  if (stored.source_tree !== identity.tree_sha) problems.push(problem("BUILD_SOURCE_TREE_MISMATCH", `${String(stored.source_tree)}!=${identity.tree_sha}`));
  if (identity.commit_sha !== "" && stored.source_commit !== identity.commit_sha) {
    problems.push(problem("BUILD_SOURCE_COMMIT_MISMATCH", `${String(stored.source_commit)}!=${identity.commit_sha}`));
  }
  const files = Array.isArray(stored.build_files) ? stored.build_files : [];
  const recorded = stored.per_file_sha256 && typeof stored.per_file_sha256 === "object" ? stored.per_file_sha256 : {};
  if (!files.length) problems.push(problem("BUILD_MODULE_MISSING", "no build files recorded"));
  for (const file of files) {
    const current = sha256File(path.join(root, ...file.split("/")));
    if (current === "") problems.push(problem("BUILD_MODULE_MISSING", file));
    else if (current !== recorded[file]) problems.push(problem("BUILD_FILE_HASH_MISMATCH", file));
  }
  if (canonicalSha256(recorded) !== stored.aggregate_build_hash) problems.push(problem("BUILD_AGGREGATE_HASH_MISMATCH", String(stored.aggregate_build_hash)));
  return problems;
}

/** The modules `scripts/acceptance-prestart.cjs` refuses to start without. */
export const GRADUATION_BUILD_MODULES: readonly string[] = [
  "dist-electron/src/shared/acceptance-contracts.js",
  "dist-electron/src/shared/acceptance-evidence.js",
  "dist-electron/electron/engineering/bootstrap-completion.js",
  "dist-electron/electron/engineering/acceptance-session.js",
  "dist-electron/electron/engineering/owner-intervention-ledger.js",
  "dist-electron/electron/engineering/atomic-file.js"
];

/* ------------------------------------------------------------------ *
 * §10 dependency identity
 * ------------------------------------------------------------------ */

export interface DependencyIdentity {
  lockfile: string;
  lockfile_sha256: string;
  node: string;
  pnpm: string;
  electron: string;
}

export function dependencyIdentityOf(root: string): DependencyIdentity {
  return {
    lockfile: "pnpm-lock.yaml",
    lockfile_sha256: sha256File(path.join(root, "pnpm-lock.yaml")),
    node: process.version,
    pnpm: pnpmVersionOf(root),
    electron: electronVersionOf(root)
  };
}

export function dependencyProblems(recorded: unknown, root: string): AttackProblem[] {
  if (recorded === null || typeof recorded !== "object" || Array.isArray(recorded)) return [problem("DEPENDENCY_IDENTITY_MISSING")];
  const value = recorded as Partial<DependencyIdentity>;
  const current = dependencyIdentityOf(root);
  const problems: AttackProblem[] = [];
  if (current.lockfile_sha256 === "") problems.push(problem("LOCKFILE_MISSING", current.lockfile));
  else if (value.lockfile_sha256 !== current.lockfile_sha256) {
    problems.push(problem("DEPENDENCY_IDENTITY_MISMATCH", `${String(value.lockfile_sha256).slice(0, 12)}…!=${current.lockfile_sha256.slice(0, 12)}…`));
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * §47 the evolution certificate
 * ------------------------------------------------------------------ */

export interface CertificateSourceRecord {
  gate: string;
  kind: string;
  report_file: string;
  report_sha256: string;
  attestation_file: string;
  attestation_sha256: string;
  verdict: string;
}

export interface EvolutionCertificate {
  schemaVersion: number;
  state: string;
  run_id: string;
  trust_epoch: number;
  root_contract_version: string;
  session_id: string;
  baseline_commit: string;
  candidate_commit: string;
  candidate_tree: string;
  source_manifest_hash: string;
  build_manifest_hash: string;
  dependency_lock_hash: string;
  contract_snapshot_hash: string;
  test_manifest_hash: string;
  /** §8: the audit this certificate was derived from — bound so a TOCTOU window shows. */
  bootstrap_root_hash: string;
  /** §10: the dependency identity the run certified. */
  dependency_identity: DependencyIdentity;
  gates: { passed: number; required: number };
  desktop: { contract_version: string; verified_claims: number; required_claims: number };
  capabilities: { established: number; required: number };
  owner_interventions: number;
  adversarial: { passed: boolean; false_positive_cases: number | null };
  fuzz: { cases: number; mutations: number; passes: number };
  reproducible: boolean;
  validator_a: string;
  validator_b: string;
  graduate_identity: { commit_sha: string; tree_sha: string; worktree_clean: boolean; index_clean: boolean; checked_at: string };
  sources: CertificateSourceRecord[];
  problems: string[];
  root_hash: string;
  certified_at: string;
}

export const CERTIFIED_STATE = "AUTONOMOUS_EVOLUTION_CERTIFIED";
export const INCOMPLETE_STATE = "AUTONOMOUS_EVOLUTION_INCOMPLETE";
export const CERTIFICATE_FILE = "autonomous-evolution-attestation.json";
export const CONTRACT_SNAPSHOT_FILE = "contract-snapshot.json";
export const TEST_MANIFEST_FILE = "test-manifest.json";
export const BUILD_MANIFEST_FILE = "build-manifest.json";
export const DEPENDENCY_FILE = "dependency-identity.json";

/** Everything but the digest itself — the §47 certificate root hash. */
export function certificateRootHash(certificate: EvolutionCertificate): string {
  const { root_hash: _ignored, ...body } = certificate;
  return canonicalSha256(body);
}

/* ------------------------------------------------------------------ *
 * The lab
 * ------------------------------------------------------------------ */

export interface LabOptions {
  /** A real git repository (session bound to its real HEAD and tree) when true. */
  git?: boolean;
  sessionId?: string;
  /** §9 code freeze: extra repository paths (beyond the §3 surface) kept under hash. */
  freeze?: readonly string[];
  /** Support suites whose real report + attestation the lab seeds. */
  supporting?: boolean;
}

export interface Lab {
  root: string;
  artifacts: string;
  git: boolean;
  session: AcceptanceSession;
  gates: readonly AcceptanceGateContract[];
  reportFile(gate: string): string;
  attestationFile(gate: string): string;
  readReport(gate: string): unknown;
  writeReport(gate: string, report: unknown): void;
  attest(gate: string, attestedAt?: string): void;
  readAttestation(gate: string): GateAttestation | undefined;
  writeLedger(ledger: OwnerInterventionLedger): void;
  readLedger(): OwnerInterventionLedger | undefined;
  /** §9/§3: the surface + frozen sources as they were when the session started. */
  startSurface: SurfaceHashes;
  startTests: TestManifest;
  startSnapshot: ContractSnapshot;
  startDependency: DependencyIdentity;
  buildFiles: readonly string[];
  buildManifest(overrides?: Partial<BuildManifest>): BuildManifest;
  /** §8.4: the supporting suites' source records, hashed as they are on disk. */
  supportingSources(): CertificateSourceRecord[];
  evaluate(): TrustedBootstrapAudit;
  certificate(overrides?: Partial<EvolutionCertificate>): EvolutionCertificate;
  readCertificate(): EvolutionCertificate | undefined;
  graduate(options?: GraduateOptions): GraduationVerdict;
  /** §77: quarantine the current run and open the next real session on this repository. */
  restart(sessionSuffix?: string): AcceptanceSession;
  auditRecordPath: string;
  certificatePath: string;
  contractSnapshotPath: string;
  testManifestPath: string;
  buildManifestPath: string;
  dependencyPath: string;
  labTime(offsetMs?: number): string;
}

export interface GraduateOptions {
  /** §11: the contracts the run re-interprets the session snapshot with. */
  contracts?: readonly AcceptanceGateContract[];
  /** The identity the certificate must agree with; defaults to the real repository. */
  identity?: { commit_sha: string; tree_sha: string; worktree_clean: boolean; index_clean: boolean; status: string };
  /** Skip the certificate step (used while deriving the certificate itself). */
  skipCertificate?: boolean;
  requireSupporting?: boolean;
}

export interface GraduationVerdict {
  state: string;
  problems: AttackProblem[];
  reasons: string[];
  codes: string[];
  audit_root_hash: string;
  certificate_root_hash: string;
  audit: TrustedBootstrapAudit;
}

const SUPPORTING_ALL: readonly AcceptanceGateContract[] = [...ACCEPTANCE_SUPPORTING_CONTRACTS];

function contractOf(gate: string): AcceptanceGateContract {
  if (gate === DESKTOP_BLACK_BOX_CONTRACT.gate) return DESKTOP_BLACK_BOX_CONTRACT;
  const found = [...ACCEPTANCE_GATE_CONTRACTS, ...SUPPORTING_ALL].find((entry) => entry.gate === gate);
  if (!found) throw new Error(`no acceptance contract for gate ${gate}`);
  return found;
}

function pinInstant<T extends { generatedAt?: string }>(report: T): T {
  if (typeof report.generatedAt === "string") report.generatedAt = LAB_INSTANT;
  return report;
}

export function createLab(options: LabOptions = {}): Lab {
  const git = options.git === true;
  // The §3 surface, the real lockfile, the real test tree and the real build outputs
  // are copied into *every* lab, so each hostile case attacks the repository's own
  // bytes rather than a literal written by the test.
  const root = git ? gitRepo("boss-evolution-lab-").root : tempDir("boss-evolution-lab-");
  for (const file of [
    ...ROOT_TRUST_SURFACE_PATTERNS.filter((pattern) => !pattern.includes("*")),
    ...ROOT_TRUST_SURFACE_EXTRA_PATHS,
    "tests/acceptance/prestart-adversarial.test.ts",
    "tests/helpers/acceptance-report.ts"
  ]) {
    copyRealFile(file, root);
  }
  copyRealBuild(root);
  writeFixtureFile(root, "src/app/main.ts", "export const main = 1;\n");
  let identity: { commit_sha: string; tree_sha: string };
  if (git) {
    const head = commit(root, "evolution lab fixture");
    identity = { commit_sha: head, tree_sha: revParse(root, "HEAD^{tree}") };
  } else {
    identity = { commit_sha: "c".repeat(40), tree_sha: "e".repeat(40) };
  }

  const artifacts = acceptanceDirectory(root);
  const outcome = startAcceptanceSession({
    root,
    artifacts,
    certify: true,
    clean: true,
    sessionId: options.sessionId ?? `session-lab-${path.basename(root).slice(-6)}`,
    commit: identity.commit_sha,
    tree: identity.tree_sha,
    workingTreeStatus: git ? undefined : "",
    now: () => new Date(LAB_INSTANT)
  });
  if (!outcome.ok || !outcome.session) throw new Error(`lab session failed: ${outcome.reason}`);
  /** Mutable: `restart()` opens the next real session on the same repository. */
  let session: AcceptanceSession = outcome.session;
  let runKey = identity;

  const reportFile = (gate: string): string => reportPath(artifacts, contractOf(gate).report_file);
  const attestationFile = (gate: string): string => attestationPath(artifacts, gate);
  // Seeding the fixture is not an attack; the public mutators count as one.
  const seedReport = (gate: string, report: unknown): void => {
    const target = reportFile(gate);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  };
  const writeReport = (gate: string, report: unknown): void => {
    bumpMutation();
    seedReport(gate, report);
  };
  const seedAttest = (gate: string, attestedAt: string): void => {
    const contract = contractOf(gate);
    const report = readJsonFile(reportFile(gate));
    const validation = gate === DESKTOP_BLACK_BOX_CONTRACT.gate
      ? validateDesktopBlackBoxReport({ contract, report })
      : validateGateReport({ gate, contract, report });
    const attestation = buildGateAttestation({
      gate,
      contract,
      session,
      source_sha256: sha256File(reportFile(gate)),
      validation,
      attested_at: attestedAt
    });
    const target = attestationFile(gate);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${canonicalJson(attestation)}\n`, "utf8");
  };
  const attest = (gate: string, attestedAt = labTime(1000)): void => {
    bumpMutation();
    seedAttest(gate, attestedAt);
  };

  const seedAll = (): void => {
    // The sixteen delivery gates, then the desktop black box.
    for (const contract of ACCEPTANCE_GATE_CONTRACTS) {
      seedReport(contract.gate, pinInstant(cleanGateReport(contract)));
      seedAttest(contract.gate, labTime(1000));
    }
    seedReport(DESKTOP_BLACK_BOX_CONTRACT.gate, pinInstant(desktopBlackBoxReport()));
    seedAttest(DESKTOP_BLACK_BOX_CONTRACT.gate, labTime(1000));
    // The trust-boundary suites are attested exactly like the gates (§5.6/§8.7).
    if (options.supporting !== false) {
      for (const contract of SUPPORTING_ALL) {
        seedReport(contract.gate, pinInstant(cleanGateReport(contract)));
        seedAttest(contract.gate, labTime(1000));
      }
    }
    writeOwnerLedger(artifacts, emptyOwnerLedger(session));
  };

  const buildManifestPath = path.join(artifacts, BUILD_MANIFEST_FILE);
  const certificatePath = path.join(artifacts, CERTIFICATE_FILE);
  const auditRecordPath = path.join(artifacts, "bootstrap-completion.json");
  const contractSnapshotPath = path.join(artifacts, CONTRACT_SNAPSHOT_FILE);
  const testManifestPath = path.join(artifacts, TEST_MANIFEST_FILE);
  const dependencyPath = path.join(artifacts, DEPENDENCY_FILE);

  let buildFiles: string[] = [];
  let startSurface: SurfaceHashes = {};
  let startTests: TestManifest = testManifestOf(root, []);
  let startSnapshot: ContractSnapshot = contractSnapshotOf([]);
  let startDependency: DependencyIdentity = dependencyIdentityOf(root);

  function buildManifest(overrides: Partial<BuildManifest> = {}): BuildManifest {
    const manifest = { ...buildManifestOf(root, buildFiles, runKey), ...overrides };
    writeJsonFile(buildManifestPath, manifest);
    return manifest;
  }

  function evaluate(): TrustedBootstrapAudit {
    return createBootstrapAuditor({ root, artifacts, now: () => new Date(labTime(1500)) }).evaluate().audit;
  }

  /**
   * §8.4/§5.6: the trust-boundary suites are attested exactly like the gates, so the
   * certificate's source manifest carries them too — with their real on-disk hashes and
   * the verdict of the real validators.
   */
  function supportingSources(): CertificateSourceRecord[] {
    return SUPPORTING_ALL.map((contract) => {
      const file = reportPath(artifacts, contract.report_file);
      const reportSha = sha256File(file);
      const report = readJsonFile(file);
      const record: CertificateSourceRecord = {
        gate: contract.gate,
        kind: "supporting",
        report_file: contract.report_file,
        report_sha256: reportSha,
        attestation_file: path.posix.join("attestations", `${contract.gate}.json`),
        attestation_sha256: sha256File(attestationPath(artifacts, contract.gate)),
        verdict: "FAIL"
      };
      const problems = [
        ...validateGateReport({ gate: contract.gate, contract, report }).problems,
        ...verifyGateAttestation({
          gate: contract.gate,
          contract,
          session,
          attestation: readJsonFile(attestationPath(artifacts, contract.gate)),
          report,
          source_sha256: reportSha
        })
      ];
      return { ...record, verdict: reportSha !== "" && problems.length === 0 ? "PASS" : "FAIL" };
    });
  }

  /** §9/§11/§12: the run's opening snapshots, taken once per session. */
  function snapshotRun(): void {
    buildFiles = labBuildFiles(root);
    startSurface = hashFiles(root, [...rootTrustSurfaceFiles(root), ...(options.freeze ?? [])]);
    startTests = testManifestOf(root, listFiles(root, "tests"));
    startSnapshot = contractSnapshotOf([...ACCEPTANCE_GATE_CONTRACTS, DESKTOP_BLACK_BOX_CONTRACT, ...SUPPORTING_ALL]);
    startDependency = dependencyIdentityOf(root);
    writeJsonFile(contractSnapshotPath, startSnapshot);
    writeJsonFile(testManifestPath, startTests);
    writeJsonFile(dependencyPath, startDependency);
    buildManifest();
    // §8.4: the root audit record is written when the run audits, so the record on
    // disk can later be compared against a fresh audit (what AD-46/MM-06 attack).
    evaluate();
  }

  seedAll();
  snapshotRun();

  function verifyAll(graduateOptions: GraduateOptions = {}): { problems: AttackProblem[]; audit: TrustedBootstrapAudit; reasons: string[] } {
    const problems: AttackProblem[] = [];
    const reasons: string[] = [];
    const contracts = graduateOptions.contracts ?? [...ACCEPTANCE_GATE_CONTRACTS, DESKTOP_BLACK_BOX_CONTRACT, ...SUPPORTING_ALL];

    // 1. the session manifest (production reader + production validator).
    const inspection = inspectSession(artifacts);
    if (!inspection.session) problems.push(...fromTrustProblems(inspection.problems));
    else problems.push(...fromTrustProblems(sessionProblems(inspection.session)));
    if (sha256File(sessionPath(artifacts)) === "") problems.push(problem("SESSION_FILE_HASH_MISSING", SESSION_FILE));
    // §5.2: every later step binds the session that is *on disk*, never a caller's copy.
    const active = inspection.session ?? session;

    // 2. §5/§6 the graduation-time identity lock, exactly as the command applies it.
    const identity = graduateOptions.identity ?? (git
      ? readGitIdentity(root)
      : { commit_sha: session.commit_sha, tree_sha: session.tree_sha ?? "", worktree_clean: true, index_clean: true, status: "" });
    if (identity.commit_sha !== active.commit_sha) {
      problems.push(problem(TRUST_CODES.CURRENT_HEAD_MISMATCH, `${identity.commit_sha || "unknown"}!=${active.commit_sha}`));
    }
    if (active.tree_sha) {
      if (identity.tree_sha !== active.tree_sha) problems.push(problem(TRUST_CODES.CURRENT_TREE_MISMATCH, `${identity.tree_sha || "unknown"}!=${active.tree_sha}`));
    } else {
      problems.push(problem(TRUST_CODES.SESSION_TREE_MISSING));
    }
    if (!identity.worktree_clean) problems.push(problem(TRUST_CODES.WORKTREE_DIRTY_AT_GRADUATION));
    if (!identity.index_clean) problems.push(problem(TRUST_CODES.INDEX_DIRTY_AT_GRADUATION));

    // 3. §3/§9 the surface + source freeze: nothing changed, nothing appeared.
    problems.push(...surfaceProblems(startSurface, hashFiles(root, Object.keys(startSurface))));
    for (const file of rootTrustSurfaceFiles(root)) {
      if (!(file in startSurface)) problems.push(problem("ROOT_TRUST_SURFACE_ADDED", file));
    }

    // 4. §12 the test inventory lock.
    problems.push(...testManifestProblems(readJsonFile(path.join(artifacts, TEST_MANIFEST_FILE)), root));

    // 5. §11 the contract snapshot.
    problems.push(...contractSnapshotProblems(readJsonFile(path.join(artifacts, CONTRACT_SNAPSHOT_FILE)), contracts));

    // 6. §7/§8 the build identity.
    problems.push(...buildIdentityProblems(readJsonFile(buildManifestPath), root, { commit_sha: session.commit_sha, tree_sha: session.tree_sha ?? "" }));

    // 7. §10 the dependency identity recorded when the session started.
    problems.push(...dependencyProblems(readJsonFile(path.join(artifacts, DEPENDENCY_FILE)), root));

    // 8. the real host root audit: sixteen gates, the black box, the ledger, the session.
    //    The §8.4 record on disk is read first: `evaluate()` rewrites it, so a
    //    comparison taken afterwards could never fail.
    const storedRecord = readJsonFile(auditRecordPath);
    const audit = evaluate();
    problems.push(...bootstrapRecordProblems(storedRecord, audit));
    for (const source of audit.sources) problems.push(...fromTrustProblems(source.problems));
    if (audit.owner_interventions > 0) problems.push(problem("OWNER_INTERVENTION_PRESENT", String(audit.owner_interventions)));
    if (!audit.completion.complete) problems.push(problem("CAPABILITY_INCOMPLETE", String(audit.capabilities.passed)));
    reasons.push(...audit.reasons);

    // 9. the trust-boundary suites, validated exactly like the gates.
    for (const contract of contracts) {
      if (contract.gate === DESKTOP_BLACK_BOX_CONTRACT.gate) continue;
      if (ACCEPTANCE_GATE_CONTRACTS.some((entry) => entry.gate === contract.gate)) continue;
      const file = reportPath(artifacts, contract.report_file);
      const reportSha = sha256File(file);
      if (reportSha === "") problems.push(problem(TRUST_CODES.REPORT_FILE_MISSING, contract.gate));
      const report = readJsonFile(file);
      const validation = validateGateReport({ gate: contract.gate, contract, report });
      problems.push(...fromTrustProblems(validation.problems));
      problems.push(...fromTrustProblems(verifyGateAttestation({
        gate: contract.gate,
        contract,
        session: active,
        attestation: readJsonFile(attestationPath(artifacts, contract.gate)),
        report,
        source_sha256: reportSha
      })));
    }

    // 10. §20 AD-45: every timestamp the contract binds must fall inside this run.
    for (const contract of contracts) {
      const report = readJsonFile(reportPath(artifacts, contract.report_file)) as { generatedAt?: unknown } | undefined;
      if (report && typeof report.generatedAt === "string") {
        const at = Date.parse(report.generatedAt);
        if (!Number.isFinite(at) || at < WINDOW_START || at > WINDOW_END) {
          problems.push(problem("REPORT_TIME_OUTSIDE_RUN", `${contract.gate}=${report.generatedAt}`));
        }
      }
      const attestation = readJsonFile(attestationPath(artifacts, contract.gate)) as { attested_at?: unknown } | undefined;
      if (attestation && typeof attestation.attested_at === "string") {
        const at = Date.parse(attestation.attested_at);
        if (!Number.isFinite(at) || at < WINDOW_START || at > WINDOW_END) {
          problems.push(problem("ATTESTATION_TIME_OUTSIDE_RUN", `${contract.gate}=${attestation.attested_at}`));
        }
      }
    }

    // 11. §8.4 manifest accounting: every contracted source present, nothing unknown.
    for (const contract of contracts) {
      if (sha256File(reportPath(artifacts, contract.report_file)) === "") problems.push(problem("REQUIRED_SOURCE_MISSING", contract.gate));
    }
    problems.push(...unknownEvidenceSources(artifacts, contracts));

    // 12. AD-37: no evidence path may be a link into another tree.
    problems.push(...evidenceLinkProblems(artifacts));

    return { problems, audit, reasons };
  }

  function certificate(overrides: Partial<EvolutionCertificate> = {}): EvolutionCertificate {
    const derived = verifyAll();
    const audit = derived.audit;
    const state = derived.problems.length ? INCOMPLETE_STATE : CERTIFIED_STATE;
    const body = {
      schemaVersion: 1,
      state,
      run_id: `run-${session.session_id}`,
      trust_epoch: 3,
      root_contract_version: "boss-root-trust-3",
      session_id: session.session_id,
      baseline_commit: session.commit_sha,
      candidate_commit: session.commit_sha,
      candidate_tree: session.tree_sha ?? "",
      source_manifest_hash: surfaceManifestHash(hashFiles(root, Object.keys(startSurface))),
      build_manifest_hash: sha256File(buildManifestPath),
      dependency_lock_hash: sha256File(path.join(artifacts, DEPENDENCY_FILE)),
      contract_snapshot_hash: sha256File(path.join(artifacts, CONTRACT_SNAPSHOT_FILE)),
      test_manifest_hash: sha256File(path.join(artifacts, TEST_MANIFEST_FILE)),
      bootstrap_root_hash: audit.root_hash,
      dependency_identity: dependencyIdentityOf(root),
      gates: { passed: audit.gates_passed, required: audit.gates_required },
      desktop: {
        contract_version: audit.desktop.contract,
        verified_claims: audit.desktop.verified_claims,
        required_claims: audit.desktop.required_claims
      },
      capabilities: { established: audit.capabilities.passed, required: audit.capabilities.required },
      owner_interventions: audit.owner_interventions,
      adversarial: { passed: true, false_positive_cases: 0 },
      fuzz: { cases: 6, mutations: 0, passes: 0 },
      reproducible: true,
      validator_a: "bootstrap-completion",
      validator_b: "prestart-attestation",
      graduate_identity: {
        commit_sha: git ? readGitIdentity(root).commit_sha : session.commit_sha,
        tree_sha: git ? readGitIdentity(root).tree_sha : session.tree_sha ?? "",
        worktree_clean: git ? readGitIdentity(root).worktree_clean : true,
        index_clean: git ? readGitIdentity(root).index_clean : true,
        checked_at: labTime(1400)
      },
      sources: [
        ...audit.sources.map((source) => ({
          gate: source.gate,
          kind: source.kind,
          report_file: source.report_file,
          report_sha256: source.report_sha256,
          attestation_file: source.attestation_file,
          attestation_sha256: source.attestation_sha256,
          verdict: source.verdict
        })),
        ...supportingSources()
      ],
      problems: renderProblems(derived.problems),
      certified_at: labTime(2000),
      ...overrides
    } as Omit<EvolutionCertificate, "root_hash">;
    const record: EvolutionCertificate = { ...body, root_hash: certificateRootHash(body as EvolutionCertificate) };
    writeFileAtomicSync(certificatePath, `${canonicalJson(record)}\n`);
    return record;
  }

  function verifyCertificate(graduateOptions: GraduateOptions = {}): AttackProblem[] {
    const problems: AttackProblem[] = [];
    const stored = readJsonFile(certificatePath);
    if (stored === null || stored === undefined || typeof stored !== "object" || Array.isArray(stored)) {
      return [problem("CERTIFICATE_MISSING", CERTIFICATE_FILE)];
    }
    const record = stored as EvolutionCertificate;
    const { problems: freshProblems, audit } = verifyAll(graduateOptions);
    const freshState = freshProblems.length ? INCOMPLETE_STATE : CERTIFIED_STATE;

    // §76: the state field is not evidence — it is re-derived, never read.
    if (record.state !== freshState) problems.push(problem("CERTIFICATE_STATE_NOT_REDERIVED", `${String(record.state)}!=${freshState}`));
    if (record.root_hash !== certificateRootHash(record)) {
      problems.push(problem("CERTIFICATE_ROOT_HASH_MISMATCH", `${String(record.root_hash).slice(0, 12)}…!=${certificateRootHash(record).slice(0, 12)}…`));
    }
    // §77: the certificate binds one session, commit, tree and run.
    const identitySession = inspectSession(artifacts).session ?? session;
    if (record.session_id !== identitySession.session_id) problems.push(problem("CERTIFICATE_SESSION_MISMATCH", `${String(record.session_id)}!=${identitySession.session_id}`));
    if (record.candidate_commit !== identitySession.commit_sha) problems.push(problem("CERTIFICATE_COMMIT_MISMATCH", `${String(record.candidate_commit)}!=${identitySession.commit_sha}`));
    if (record.candidate_tree !== (identitySession.tree_sha ?? "")) problems.push(problem("CERTIFICATE_TREE_MISMATCH", `${String(record.candidate_tree)}!=${identitySession.tree_sha ?? ""}`));
    if (record.run_id !== `run-${identitySession.session_id}`) problems.push(problem("CERTIFICATE_RUN_ID_MISMATCH", String(record.run_id)));
    if (record.baseline_commit !== identitySession.commit_sha) problems.push(problem("STALE_BASELINE", `${String(record.baseline_commit)}!=${identitySession.commit_sha}`));

    const identity = graduateOptions.identity ?? (git
      ? readGitIdentity(root)
      : { commit_sha: session.commit_sha, tree_sha: session.tree_sha ?? "", worktree_clean: true, index_clean: true, status: "" });
    // §20 AD-48/AD-49: the *current* HEAD and tree must be the certified ones.
    if (record.candidate_commit !== identity.commit_sha) {
      problems.push(problem("CERTIFICATE_COMMIT_MISMATCH", `${String(record.candidate_commit).slice(0, 8)}!=${identity.commit_sha.slice(0, 8)}`));
    }
    if (record.candidate_tree !== identity.tree_sha) {
      problems.push(problem("CERTIFICATE_TREE_MISMATCH", `${String(record.candidate_tree).slice(0, 8)}!=${identity.tree_sha.slice(0, 8)}`));
    }
    const claimed = record.graduate_identity ?? { commit_sha: "", tree_sha: "", worktree_clean: false, index_clean: false, checked_at: "" };
    if (claimed.commit_sha !== identity.commit_sha || claimed.tree_sha !== identity.tree_sha
      || claimed.worktree_clean !== identity.worktree_clean || claimed.index_clean !== identity.index_clean) {
      problems.push(problem("CERTIFICATE_IDENTITY_MISMATCH", `${String(claimed.commit_sha).slice(0, 8)}/${claimed.worktree_clean}!=${identity.commit_sha.slice(0, 8)}/${identity.worktree_clean}`));
    }

    // §8.4 the source manifest: unique, and complete for every contracted gate.
    const sources = Array.isArray(record.sources) ? record.sources : [];
    const seen = new Set<string>();
    for (const source of sources) {
      if (seen.has(source.gate)) problems.push(problem("DUPLICATE_EVIDENCE_SOURCE", source.gate));
      seen.add(source.gate);
    }
    for (const contract of graduateOptions.contracts ?? [...ACCEPTANCE_GATE_CONTRACTS, DESKTOP_BLACK_BOX_CONTRACT, ...SUPPORTING_ALL]) {
      if (!seen.has(contract.gate)) problems.push(problem("REQUIRED_SOURCE_MISSING", contract.gate));
    }
    for (const source of sources) {
      const current = sha256File(reportPath(artifacts, source.report_file));
      if (current === "") problems.push(problem("REQUIRED_SOURCE_MISSING", source.gate));
      else if (current !== source.report_sha256) problems.push(problem(TRUST_CODES.SOURCE_HASH_MISMATCH, `${source.gate}:${source.report_file}`));
      if (source.attestation_file) {
        const currentAttestation = sha256File(path.join(artifacts, ...source.attestation_file.split("/")));
        if (currentAttestation !== source.attestation_sha256) problems.push(problem(TRUST_CODES.ATTESTATION_HASH_MISMATCH, source.gate));
      }
    }

    // §7/§10: the build and dependency identities the certificate froze.
    if (record.build_manifest_hash !== sha256File(buildManifestPath)) problems.push(problem("CERTIFICATE_BUILD_HASH_MISMATCH", String(record.build_manifest_hash)));
    if (record.dependency_lock_hash !== sha256File(path.join(artifacts, DEPENDENCY_FILE))) {
      problems.push(problem("CERTIFICATE_DEPENDENCY_HASH_MISMATCH", String(record.dependency_lock_hash)));
    }
    if (record.contract_snapshot_hash !== sha256File(path.join(artifacts, CONTRACT_SNAPSHOT_FILE))) {
      problems.push(problem("CERTIFICATE_CONTRACT_HASH_MISMATCH", String(record.contract_snapshot_hash)));
    }
    if (record.test_manifest_hash !== sha256File(path.join(artifacts, TEST_MANIFEST_FILE))) {
      problems.push(problem("CERTIFICATE_TEST_HASH_MISMATCH", String(record.test_manifest_hash)));
    }
    if (record.source_manifest_hash !== surfaceManifestHash(hashFiles(root, Object.keys(startSurface)))) {
      problems.push(problem("CERTIFICATE_SOURCE_MANIFEST_MISMATCH", String(record.source_manifest_hash)));
    }
    problems.push(...dependencyProblems(readJsonFile(path.join(artifacts, DEPENDENCY_FILE)), root));
    // §10: the identity the certificate froze must still describe this workspace.
    problems.push(...dependencyProblems(record.dependency_identity, root));
    // §8: the audit the certificate was derived from must still be the audit on disk.
    if (record.bootstrap_root_hash !== audit.root_hash) {
      problems.push(problem("CERTIFICATE_BOOTSTRAP_HASH_MISMATCH", `${String(record.bootstrap_root_hash).slice(0, 12)}…!=${audit.root_hash.slice(0, 12)}…`));
    }
    if (record.owner_interventions !== audit.owner_interventions) {
      problems.push(problem("CERTIFICATE_OWNER_COUNT_MISMATCH", `${record.owner_interventions}!=${audit.owner_interventions}`));
    }
    if (record.gates.required !== audit.gates_required || record.gates.passed !== audit.gates_passed) {
      problems.push(problem("CERTIFICATE_GATE_COUNT_MISMATCH", `${record.gates.passed}/${record.gates.required}`));
    }
    return problems;
  }

  function graduate(graduateOptions: GraduateOptions = {}): GraduationVerdict {
    const { problems, audit, reasons } = verifyAll(graduateOptions);
    const all = [...problems];
    if (graduateOptions.skipCertificate !== true) all.push(...verifyCertificate(graduateOptions));
    const state = all.length ? INCOMPLETE_STATE : CERTIFIED_STATE;
    return {
      state,
      problems: all,
      codes: all.map((entry) => entry.code),
      reasons: [...reasons, ...renderProblems(all)],
      audit_root_hash: audit.root_hash,
      certificate_root_hash: sha256File(certificatePath),
      audit
    };
  }

  /**
   * §77: the next run on the same repository. The session is re-opened through the
   * production `startAcceptanceSession` (which quarantines the previous run's
   * transient evidence into `history/`), and the opening snapshots are re-taken.
   */
  function restart(sessionSuffix = "next"): AcceptanceSession {
    const nextIdentity = git
      ? { commit_sha: readGitIdentity(root).commit_sha, tree_sha: readGitIdentity(root).tree_sha }
      : { commit_sha: session.commit_sha, tree_sha: session.tree_sha ?? "" };
    const next = startAcceptanceSession({
      root,
      artifacts,
      certify: true,
      clean: true,
      sessionId: `${session.session_id}-${sessionSuffix}`,
      commit: nextIdentity.commit_sha,
      tree: nextIdentity.tree_sha,
      workingTreeStatus: git ? undefined : "",
      now: () => new Date(LAB_INSTANT)
    });
    if (!next.ok || !next.session) throw new Error(`lab restart failed: ${next.reason}`);
    session = next.session;
    runKey = nextIdentity;
    seedAll();
    snapshotRun();
    return session;
  }

  return {
    root,
    artifacts,
    git,
    get session() { return session; },
    gates: ACCEPTANCE_GATE_CONTRACTS,
    reportFile,
    attestationFile,
    readReport: (gate) => readJsonFile(reportFile(gate)),
    writeReport,
    attest,
    readAttestation: (gate) => readJsonFile(attestationFile(gate)) as GateAttestation | undefined,
    writeLedger: (ledger) => { bumpMutation(); writeOwnerLedger(artifacts, ledger); },
    readLedger: () => readJsonFile(ownerLedgerPath(artifacts)) as OwnerInterventionLedger | undefined,
    get startSurface() { return startSurface; },
    get startTests() { return startTests; },
    get startSnapshot() { return startSnapshot; },
    get startDependency() { return startDependency; },
    get buildFiles() { return buildFiles; },
    buildManifest,
    evaluate,
    supportingSources,
    certificate,
    readCertificate: () => readJsonFile(certificatePath) as EvolutionCertificate | undefined,
    graduate,
    restart,
    auditRecordPath,
    certificatePath,
    contractSnapshotPath,
    testManifestPath,
    buildManifestPath,
    dependencyPath,
    labTime
  };
}

/** §8.4: everything in the evidence namespace must be accounted for. A file nobody
 * contracted is an unknown evidence source, not a harmless extra. */
export function unknownEvidenceSources(artifacts: string, contracts: readonly AcceptanceGateContract[]): AttackProblem[] {
  const problems: AttackProblem[] = [];
  const accounted = new Set<string>([
    SESSION_FILE,
    OWNER_LEDGER_FILE,
    "bootstrap-completion.json",
    CONTRACT_SNAPSHOT_FILE,
    TEST_MANIFEST_FILE,
    BUILD_MANIFEST_FILE,
    DEPENDENCY_FILE,
    CERTIFICATE_FILE,
    `${CERTIFICATE_FILE.replace(/\.json$/, "")}.md`
  ]);
  for (const contract of contracts) {
    accounted.add(contract.report_file);
    accounted.add(`attestations/${contract.gate}.json`);
  }
  const check = (directory: string, prefix: string): void => {
    const absolute = path.join(artifacts, directory);
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      const relative = `${prefix}${entry.name}`;
      if (!accounted.has(relative)) problems.push(problem("UNKNOWN_EVIDENCE_SOURCE", relative));
    }
  };
  check("", "");
  check("attestations", "attestations/");
  return problems;
}

/* ------------------------------------------------------------------ *
 * Real-file copies
 * ------------------------------------------------------------------ */

/** The repository this suite is attacking. */
export function repositoryRoot(): string {
  return process.cwd();
}

function copyRealFile(relative: string, destination: string): void {
  const source = path.join(repositoryRoot(), ...relative.split("/"));
  if (!fs.existsSync(source)) return;
  const target = path.join(destination, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

/**
 * §7: the real build outputs the graduation command loads. When the checkout has no
 * `dist-electron` build the lab copies the real sources instead, so the build-identity
 * case still attacks real bytes on disk rather than a literal.
 */
function copyRealBuild(root: string): void {
  for (const module of GRADUATION_BUILD_MODULES) {
    const built = path.join(repositoryRoot(), ...module.split("/"));
    if (fs.existsSync(built)) copyRealFile(module, root);
  }
  if (!fs.existsSync(path.join(root, "dist-electron"))) {
    for (const source of [
      "src/shared/acceptance-contracts.ts",
      "src/shared/acceptance-evidence.ts",
      "electron/engineering/bootstrap-completion.ts",
      "electron/engineering/acceptance-session.ts",
      "electron/engineering/owner-intervention-ledger.ts",
      "electron/engineering/atomic-file.ts"
    ]) {
      copyRealFile(source, root);
    }
  }
}

/** Real build files present in the lab checkout, whatever shape they took. */
export function labBuildFiles(root: string): string[] {
  const built = GRADUATION_BUILD_MODULES.filter((file) => fs.existsSync(path.join(root, ...file.split("/"))));
  if (built.length) return built;
  return [
    "src/shared/acceptance-contracts.ts",
    "src/shared/acceptance-evidence.ts",
    "electron/engineering/bootstrap-completion.ts",
    "electron/engineering/acceptance-session.ts",
    "electron/engineering/owner-intervention-ledger.ts",
    "electron/engineering/atomic-file.ts"
  ].filter((file) => fs.existsSync(path.join(root, ...file.split("/"))));
}

export function writeJsonFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/* ------------------------------------------------------------------ *
 * Evidence path identity (§20 AD-37)
 * ------------------------------------------------------------------ */

/**
 * A redirected evidence path is refused whether or not the bytes behind it look
 * valid: the verifier must never *silently* follow a link into another tree.
 */
export function evidenceLinkProblems(artifacts: string): AttackProblem[] {
  const problems: AttackProblem[] = [];
  if (!fs.existsSync(artifacts)) return problems;
  const root = fs.realpathSync(artifacts);
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        problems.push(problem("EVIDENCE_PATH_REDIRECTED", path.relative(artifacts, absolute).split(path.sep).join("/")));
        let target = "";
        try { target = fs.realpathSync(absolute); } catch { target = ""; }
        if (target === "" || !target.startsWith(root)) {
          problems.push(problem("EVIDENCE_PATH_ESCAPE", `${path.relative(artifacts, absolute).split(path.sep).join("/")}->${target}`));
        }
      } else if (stat.isDirectory()) {
        walk(absolute);
      }
    }
  };
  walk(artifacts);
  return problems;
}

/* ------------------------------------------------------------------ *
 * §8.4 the bootstrap record (the root evidence manifest on disk)
 * ------------------------------------------------------------------ */

export interface BootstrapRecord {
  decision?: unknown;
  root_hash?: unknown;
  session_id?: unknown;
  audited_at?: unknown;
}

/**
 * The graduation command's own record check. The record is read *before* the audit
 * re-runs (the audit rewrites it), otherwise the comparison cannot fail.
 */
export function bootstrapRecordProblems(stored: unknown, audit: TrustedBootstrapAudit): AttackProblem[] {
  if (stored === null || stored === undefined || typeof stored !== "object" || Array.isArray(stored)) {
    return [problem(TRUST_CODES.BOOTSTRAP_RECORD_MISSING, "bootstrap-completion.json")];
  }
  const record = stored as BootstrapRecord;
  const problems: AttackProblem[] = [];
  if (record.root_hash !== audit.root_hash) problems.push(problem(TRUST_CODES.BOOTSTRAP_RECORD_ROOT_HASH_MISMATCH, `${String(record.root_hash).slice(0, 12)}…!=${audit.root_hash.slice(0, 12)}…`));
  if (record.decision !== audit.decision) problems.push(problem(TRUST_CODES.BOOTSTRAP_RECORD_DECISION_MISMATCH, String(record.decision)));
  if (record.session_id !== audit.session_id) problems.push(problem(TRUST_CODES.BOOTSTRAP_RECORD_SESSION_MISMATCH, String(record.session_id)));
  return problems;
}

/** §47: the certificate's source manifest, built from a real audit. */
export function sourcesFromAudit(audit: TrustedBootstrapAudit): CertificateSourceRecord[] {
  return audit.sources.map((source) => ({
    gate: source.gate,
    kind: source.kind,
    report_file: source.report_file,
    report_sha256: source.report_sha256,
    attestation_file: source.attestation_file,
    attestation_sha256: source.attestation_sha256,
    verdict: source.verdict
  }));
}

/** A fixture report with a chosen timestamp, so §20 AD-45 can bind it. */
export function reportWithInstant(contract: AcceptanceGateContract, generatedAt = LAB_INSTANT) {
  const report = cleanGateReport(contract);
  report.generatedAt = generatedAt;
  return report;
}

/* ------------------------------------------------------------------ *
 * §20 mutation bookkeeping (the report's mutation_count)
 * ------------------------------------------------------------------ */

let mutations = 0;
let fuzzMutations = 0;

export function bumpMutation(count = 1): void {
  mutations += count;
}

/** §20/§22: real on-disk mutations applied by the hostile cases. */
export function mutationCount(): number {
  return mutations;
}

/** §23: mutated inputs judged by the fuzz layer. */
export function fuzzMutationCount(): number {
  return fuzzMutations;
}

/** Flips one byte inside the first string value of a JSON file. */
export function flipOneValueByte(file: string): { before: string; after: string; index: number } {
  const text = fs.readFileSync(file, "utf8");
  const match = /:\s*"/.exec(text);
  const start = match ? match.index + match[0].length : 0;
  let index = start + 1;
  while (index < text.length && (text[index] === "\\" || text[index] === '"')) index += 1;
  if (index >= text.length) index = Math.floor(text.length / 2);
  const code = text.charCodeAt(index);
  const replacement = String.fromCharCode(code === 0x7a ? 0x79 : code + 1);
  const after = text.slice(0, index) + replacement + text.slice(index + 1);
  bumpMutation();
  fs.writeFileSync(file, after, "utf8");
  return { before: text, after, index };
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/** Flips one byte inside the first hex value that follows `marker`. */
export function flipByteAfter(file: string, marker: string): { before: string; after: string; index: number } {
  const text = fs.readFileSync(file, "utf8");
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`flipByteAfter: marker ${marker} not found in ${file}`);
  let index = at + marker.length;
  while (index < text.length && !/[0-9a-fA-F]/.test(text[index])) index += 1;
  if (index >= text.length) throw new Error(`flipByteAfter: no value after ${marker}`);
  const code = text.charCodeAt(index);
  const replacement = String.fromCharCode(code === 0x61 ? 0x62 : code + 1);
  const after = text.slice(0, index) + replacement + text.slice(index + 1);
  bumpMutation();
  fs.writeFileSync(file, after, "utf8");
  return { before: text, after, index };
}

/* ------------------------------------------------------------------ *
 * §23 fuzz layer
 * ------------------------------------------------------------------ */

/** A deterministic linear congruential generator (Numerical Recipes constants). */
export class Lcg {
  private state: number;
  constructor(readonly seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  int(bound: number): number {
    return Math.floor(this.next() * bound) % Math.max(1, bound);
  }
  pick<T>(values: readonly T[]): T {
    return values[this.int(values.length)];
  }
}

export const FUZZ_SEED = 20260601;
export const FUZZ_MUTATIONS_PER_CASE = 240;

/** §23's mutation classes. */
export const FUZZ_OPERATIONS: readonly string[] = [
  "field_deletion",
  "field_insertion",
  "type_mutation",
  "array_shuffle",
  "duplication",
  "null",
  "huge_number",
  "unknown_enum",
  "unicode",
  "truncation"
];

interface Node { parent: unknown; key: string | number; value: unknown }

function collectNodes(value: unknown, parent: unknown, key: string | number, out: Node[]): void {
  out.push({ parent, key, value });
  if (Array.isArray(value)) value.forEach((entry, index) => collectNodes(entry, value, index, out));
  else if (value !== null && typeof value === "object") {
    for (const [name, entry] of Object.entries(value as Record<string, unknown>)) collectNodes(entry, value, name, out);
  }
}

function splittableStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => splittableStrings(entry, out));
  else if (value !== null && typeof value === "object") for (const entry of Object.values(value as Record<string, unknown>)) splittableStrings(entry, out);
}

function setNode(node: Node, value: unknown): void {
  if (Array.isArray(node.parent)) (node.parent as unknown[])[node.key as number] = value;
  else if (node.parent !== null && typeof node.parent === "object") (node.parent as Record<string, unknown>)[node.key as string] = value;
}

function deleteNode(node: Node): boolean {
  if (Array.isArray(node.parent)) {
    (node.parent as unknown[]).splice(node.key as number, 1);
    return true;
  }
  if (node.parent !== null && typeof node.parent === "object") {
    delete (node.parent as Record<string, unknown>)[node.key as string];
    return true;
  }
  return false;
}

const UNICODE_ATTACKS = ["\u200b", "\uff33\uff45\uff53\uff53\uff49\uff4f\uff4e", "\u202e", "𝔰ession", "\u0000", "PASS\u200b", "\uff10\uff11"];
const UNKNOWN_ENUMS = ["pass", "PASSED", "OK", "TRUE", "SUCCESS", "NotRun", "✔", ""];

/**
 * One mutated serialisation of `text`, plus the operation that produced it. The
 * function guarantees the result differs from the input, so a "pass" can never be
 * explained by a mutation that did not land.
 */
export function mutateJsonText(text: string, rng: Lcg): { text: string; operation: string } {
  for (let attempt = 0; attempt < 8; attempt++) {
    const operation = rng.pick(FUZZ_OPERATIONS);
    const candidate = applyOperation(text, operation, rng);
    if (candidate !== null && candidate !== text) return { text: candidate, operation };
  }
  // Last resort: truncation always lands.
  const cut = Math.max(1, Math.floor(text.length / 2));
  return { text: text.slice(0, cut), operation: "truncation" };
}

function applyOperation(text: string, operation: string, rng: Lcg): string | null {
  if (operation === "truncation") {
    const points = Array.from(text);
    if (points.length < 4) return null;
    const cut = 1 + rng.int(points.length - 1);
    return points.slice(0, cut).join("");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A non-JSON baseline can only be truncated; every caller passes real JSON.
    return null;
  }
  const nodes: Node[] = [];
  collectNodes(parsed, null, "", nodes);
  const objectNodes = nodes.filter((node) => node.parent !== null && typeof node.parent === "object" && !Array.isArray(node.parent));
  const arrayNodes = nodes.filter((node) => Array.isArray(node.value));
  const plainObjects = nodes.filter((node) => node.value !== null && typeof node.value === "object" && !Array.isArray(node.value));
  const switchable = nodes.filter((node) => node.parent !== null);
  const strings: string[] = [];
  splittableStrings(parsed, strings);

  switch (operation) {
    case "field_deletion": {
      if (rng.next() < 0.5 && arrayNodes.length) {
        const target = arrayNodes[rng.int(arrayNodes.length)].value as unknown[];
        if (target.length > 1) target.splice(rng.int(target.length), 1);
        else return null;
      } else if (objectNodes.length) {
        const candidates = objectNodes.filter((node) => node.key !== "");
        if (!candidates.length) return null;
        deleteNode(candidates[rng.int(candidates.length)]);
      } else return null;
      break;
    }
    case "field_insertion": {
      if (rng.next() < 0.5 && arrayNodes.length) {
        (arrayNodes[rng.int(arrayNodes.length)].value as unknown[]).push(rng.pick([1, "extra", null, { injected: true }]));
      } else if (plainObjects.length) {
        const target = plainObjects[rng.int(plainObjects.length)].value as Record<string, unknown>;
        target[`injected_${rng.int(1000)}`] = rng.pick([1, "extra", null, [1, 2], { deep: true }]);
      } else return null;
      break;
    }
    case "type_mutation": {
      if (!switchable.length) return null;
      const node = switchable[rng.int(switchable.length)];
      const value = node.value;
      const replacement = typeof value === "string" ? rng.pick([0, true, null, [], {}, 42])
        : typeof value === "number" ? rng.pick(["mutated", false, [], {}])
          : typeof value === "boolean" ? rng.pick(["true", 1, [], {}])
            : Array.isArray(value) ? rng.pick([{}, "array", 0])
              : rng.pick(["object", [], 1]);
      setNode(node, replacement);
      break;
    }
    case "array_shuffle": {
      if (!arrayNodes.length) return null;
      const target = arrayNodes[rng.int(arrayNodes.length)].value as unknown[];
      if (target.length < 2) return null;
      for (let index = target.length - 1; index > 0; index--) {
        const swap = rng.int(index + 1);
        [target[index], target[swap]] = [target[swap], target[index]];
      }
      break;
    }
    case "duplication": {
      if (arrayNodes.length && rng.next() < 0.5) {
        const target = arrayNodes[rng.int(arrayNodes.length)].value as unknown[];
        if (!target.length) return null;
        target.push(JSON.parse(JSON.stringify(target[rng.int(target.length)])));
      } else if (objectNodes.length) {
        const candidates = objectNodes.filter((node) => node.key !== "");
        if (!candidates.length) return null;
        const node = candidates[rng.int(candidates.length)];
        (node.parent as Record<string, unknown>)[`${String(node.key)}_copy`] = JSON.parse(JSON.stringify(node.value));
      } else return null;
      break;
    }
    case "null": {
      if (!switchable.length) return null;
      setNode(switchable[rng.int(switchable.length)], null);
      break;
    }
    case "huge_number": {
      if (!switchable.length) return null;
      setNode(switchable[rng.int(switchable.length)], rng.pick([1e308, Number.MAX_SAFE_INTEGER * 2, -1e308, 1e-308]));
      break;
    }
    case "unknown_enum": {
      if (strings.length) {
        const node = switchable.filter((entry) => typeof entry.value === "string");
        if (!node.length) return null;
        setNode(node[rng.int(node.length)], rng.pick(UNKNOWN_ENUMS));
      } else return null;
      break;
    }
    case "unicode": {
      if (strings.length) {
        const node = switchable.filter((entry) => typeof entry.value === "string");
        if (!node.length) return null;
        const chosen = node[rng.int(node.length)];
        setNode(chosen, `${String(chosen.value)}${rng.pick(UNICODE_ATTACKS)}`);
      } else return null;
      break;
    }
    default:
      return null;
  }
  return JSON.stringify(parsed);
}

export interface FuzzOutcome {
  refused: boolean;
  /** "validator" | "provenance" | "parse" | "policy" — which real check refused it. */
  by: string;
  codes: string[];
}

export interface FuzzReport {
  case: string;
  mutations: number;
  refused: number;
  passes: string[];
  crashes: number;
  crash_messages: string[];
  by: Record<string, number>;
  operations: Record<string, number>;
  host_checks: number;
}

/**
 * §23: run mutated inputs through a real judge and record only what happened. A judge
 * that throws is recorded as a crash — never as a pass — and the crash set must be
 * empty for the suite to accept the case.
 */
export function runFuzz(options: {
  id: string;
  baseline: string;
  judge: (mutated: string, operation: string) => FuzzOutcome;
  count?: number;
  seed?: number;
}): FuzzReport {
  const rng = new Lcg(options.seed ?? FUZZ_SEED);
  const count = options.count ?? FUZZ_MUTATIONS_PER_CASE;
  const report: FuzzReport = { case: options.id, mutations: 0, refused: 0, passes: [], crashes: 0, crash_messages: [], by: {}, operations: {}, host_checks: 0 };
  for (let index = 0; index < count; index++) {
    const mutated = mutateJsonText(options.baseline, rng);
    report.mutations += 1;
    fuzzMutations += 1;
    report.operations[mutated.operation] = (report.operations[mutated.operation] ?? 0) + 1;
    try {
      const outcome = options.judge(mutated.text, mutated.operation);
      if (outcome.refused) {
        report.refused += 1;
        report.by[outcome.by] = (report.by[outcome.by] ?? 0) + 1;
      } else {
        report.passes.push(`${index}:${mutated.operation}:${outcome.codes.join(",")}`);
      }
    } catch (error) {
      // An exception is a refusal (fail closed) and is counted separately: it may
      // never be treated as a pass, and it may never escape this function.
      report.crashes += 1;
      report.refused += 1;
      report.by.crash = (report.by.crash ?? 0) + 1;
      if (report.crash_messages.length < 3) {
        report.crash_messages.push(`${mutated.operation}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return report;
}

/* ------------------------------------------------------------------ *
 * §20 AD-42: the CI workflow is part of the attestation chain
 * ------------------------------------------------------------------ */

export interface CiCoverage {
  run_steps: string[];
  attested_gates: string[];
  covered: string[];
  missing: AttackProblem[];
  uncovered_supporting: string[];
}

/**
 * §42: which scripts actually write which gate's report. A gate is "run" by a step that
 * names the gate (or its `acceptance:<name>` alias) *or* by a step that invokes a script
 * which writes that gate's report file — the evolution battery writes
 * `evolution-trial.json` for the `acceptance-evolution-trial` gate, so an alias check
 * alone would miss it.
 */
export function gateProducers(): Record<string, string[]> {
  const directory = path.join(repositoryRoot(), "scripts");
  let scripts: string[] = [];
  try {
    scripts = fs.readdirSync(directory).filter((name) => /\.(cjs|mjs|js)$/.test(name));
  } catch {
    return {};
  }
  const contents = new Map(scripts.map((name) => [name, fs.readFileSync(path.join(directory, name), "utf8")]));
  const producers: Record<string, string[]> = {};
  for (const contract of ALL_ACCEPTANCE_CONTRACTS) {
    producers[contract.gate] = scripts.filter((name) => {
      // The graduation command and the certificate verifier read evidence; they do not
      // produce it, so they may never stand in for the step that runs a suite.
      if (/prestart|evolution-certificate|autonomous-evolution\.cjs$/.test(name)) return false;
      return (contents.get(name) ?? "").includes(contract.report_file);
    });
  }
  return producers;
}

/**
 * Parses the real workflow text. A gate is covered when a `run:` step actually
 * executes its suite; an `acceptance:attest -- <gate>` step without a producing run
 * step is a trust suite that CI claims but never runs.
 */
export function ciCoverage(workflow: string, gates: readonly string[], supporting: readonly string[] = []): CiCoverage {
  const runSteps = workflow.split(/\r?\n/).map((line) => /^\s*-\s*run:\s*(.+?)\s*$/.exec(line)?.[1]).filter((entry): entry is string => typeof entry === "string");
  const attested = workflow.split(/\r?\n/)
    .map((line) => /acceptance:attest\s+--\s+([A-Za-z0-9-]+)/.exec(line)?.[1])
    .filter((entry): entry is string => typeof entry === "string");
  // An `acceptance:attest -- <gate>` step records a verdict; it does not run the suite,
  // so it can never stand in for the step that produces the report.
  const producing = runSteps.filter((step) => !step.includes("acceptance:attest"));
  const producers = gateProducers();
  const covered = (gate: string): boolean => producing.some((step) => mentionsGate(step, gate)
    || (producers[gate] ?? []).some((script) => stepMentionsScript(step, script)));
  const solved = gates.filter((gate) => covered(gate));
  const missing = gates.filter((gate) => !solved.includes(gate)).map((gate) => problem("CI_RUN_STEP_MISSING", gate));
  for (const gate of attested) {
    if (gates.includes(gate)) continue;
    if (!covered(gate)) missing.push(problem("CI_RUN_STEP_MISSING", gate));
  }
  return {
    run_steps: runSteps,
    attested_gates: attested,
    covered: solved,
    missing,
    uncovered_supporting: supporting.filter((gate) => !covered(gate))
  };
}

function mentionsGate(step: string, gate: string): boolean {
  const alias = gate.replace(/^acceptance-/, "acceptance:");
  return step.includes(gate) || step.includes(alias);
}

/** A step may invoke a producer script by file name or by its `pnpm run acceptance:x` alias. */
function stepMentionsScript(step: string, script: string): boolean {
  const bare = script.replace(/\.(cjs|mjs|js)$/, "");
  const alias = bare.replace(/^acceptance-/, "acceptance:");
  return step.includes(script) || step.includes(bare) || step.includes(alias);
}

/** The runs `ci.yml` must keep for the gates the suite attests. */
export function ciRequiredGates(): string[] {
  return [...ACCEPTANCE_GATE_CONTRACTS.map((contract) => contract.gate), DESKTOP_BLACK_BOX_CONTRACT.gate];
}

/**
 * §21/§42: proves the mirrored graduation steps still exist verbatim in the real
 * command, so this suite cannot drift away from the thing it attacks.
 */
export function assertScriptMirrors(scriptPath: string): AttackProblem[] {
  const source = fs.readFileSync(scriptPath, "utf8");
  const required = [
    "CURRENT_HEAD_MISMATCH",
    "CURRENT_TREE_MISMATCH",
    "WORKTREE_DIRTY_AT_GRADUATION",
    "INDEX_DIRTY_AT_GRADUATION",
    "BOOTSTRAP_RECORD_ROOT_HASH_MISMATCH",
    "PRESTART_ATTESTATION",
    "writeFileAtomicSync",
    "hashOnceStable",
    "false_positive_cases"
  ];
  return required.filter((marker) => !source.includes(marker)).map((marker) => problem("SCRIPT_MIRROR_STALE", marker));
}

/** §178/§79: a promotion whose baseline moved must re-verify against the new main. */
export function staleBaselineProblems(certificate: { baseline_commit?: unknown; candidate_commit?: unknown }, currentMain: string): AttackProblem[] {
  const problems: AttackProblem[] = [];
  const baseline = typeof certificate.baseline_commit === "string" ? certificate.baseline_commit : "";
  // §79 through the evolution trust module's own verdict, never a re-typed rule.
  const verdict = assessBaseline({ certificateBaselineCommit: baseline, currentMainCommit: currentMain });
  if (verdict.verdict === "STALE_BASELINE") problems.push(problem(verdict.code, `${baseline.slice(0, 8)}!=${currentMain.slice(0, 8)}`));
  if (certificate.candidate_commit === currentMain) problems.push(problem("NOT_A_CANDIDATE", "the candidate is already main"));
  return problems;
}

/**
 * §77: the five bindings a certificate must carry. Replayed evidence must fail at least
 * one of session / commit / tree / build hash / run id.
 */
export function replayProblems(certificate: unknown, current: unknown): { replayed: boolean; mismatches: string[] } {
  return replayAttackVerdict({
    certificate: (certificate ?? null) as Partial<Record<"session_id" | "commit" | "tree" | "build_hash" | "run_id", string>> | null,
    current: (current ?? null) as Partial<Record<"session_id" | "commit" | "tree" | "build_hash" | "run_id", string>> | null
  });
}

/** The §77 binding tuple of a run, read from the lab's own artifacts. */
export function replayBindingOf(lab: { session: { session_id: string; commit_sha: string; tree_sha?: string }; readCertificate(): unknown }): Record<string, string> {
  const certificate = lab.readCertificate() as { run_id?: string; build_manifest_hash?: string } | undefined;
  return {
    session_id: lab.session.session_id,
    commit: lab.session.commit_sha,
    tree: lab.session.tree_sha ?? "",
    build_hash: typeof certificate?.build_manifest_hash === "string" ? certificate.build_manifest_hash : "",
    run_id: typeof certificate?.run_id === "string" ? certificate.run_id : ""
  };
}

/* ------------------------------------------------------------------ *
 * Honesty notes for the report
 * ------------------------------------------------------------------ */

export interface HarnessNotes {
  scriptMirror: string[];
  missing_modules: string[];
  helper_bound_checks: string[];
  independent_verifier: string;
  contract_note: string;
}

export function evolutionHarnessNotes(): HarnessNotes {
  const missing: string[] = [];
  for (const candidate of [
    "src/shared/autonomous-evolution-trust.ts",
    "src/shared/autonomous-evolution-identity.ts",
    "scripts/acceptance-evolution-certificate.cjs",
    "electron/engineering/autonomous-evolution-runner.ts"
  ]) {
    if (!fs.existsSync(path.join(repositoryRoot(), ...candidate.split("/")))) missing.push(candidate);
  }
  return {
    scriptMirror: [
      "scripts/acceptance-prestart.cjs is not importable (it self-executes), so the graduation step order and its identity comparison are mirrored here over the same production readers (readGitIdentity, inspectSession, createBootstrapAuditor, verifyGateAttestation).",
      "assertScriptMirrors() fails the suite if the real command stops containing those codes and markers."
    ],
    missing_modules: missing,
    helper_bound_checks: [
      "ROOT_TRUST_SURFACE_CHANGED / ROOT_TRUST_SURFACE_MISSING / ROOT_TRUST_SURFACE_ADDED — §3 surface manifest re-derivation over real file hashes; the surface list itself is imported from src/shared/autonomous-evolution-trust.ts (PLAN_SECTION_3_ROOT_TRUST_PATHS ∪ ROOT_TRUST_SURFACE_PATHS), not re-typed.",
      "CONTRACT_SNAPSHOT_* / CONTRACT_REQUIRED_IDS_CHANGED — §11 snapshot re-derivation (hardened against mutated snapshots: a retyped or missing gate entry is a code, never an exception — the §23 fuzz layer found the naive version throwing on {\"gates\":[null]}).",
      "TEST_FILE_* / TEST_MANIFEST_HASH_MISMATCH — §12 test inventory lock over real files.",
      "BUILD_* — §7/§8 build artifact identity over the real build artifacts and real SHA-256.",
      "DEPENDENCY_IDENTITY_MISMATCH / LOCKFILE_CHANGED — §10 dependency identity.",
      "UNKNOWN_EVIDENCE_SOURCE / REQUIRED_SOURCE_MISSING / DUPLICATE_EVIDENCE_SOURCE — §8.4 manifest accounting over the real evidence directory.",
      "EVIDENCE_PATH_REDIRECTED / EVIDENCE_PATH_ESCAPE — AD-37 lstat/realpath checks over the evidence namespace.",
      "ATTESTATION_TIME_OUTSIDE_RUN / REPORT_TIME_OUTSIDE_RUN — AD-45 binds attestation.attested_at and report.generatedAt to the run window [session.started_at, session.started_at+1h]; the checkpoint-2 audit alone does not bind freshness.",
      "CERTIFICATE_* — §47 certificate re-derivation: the state and root_hash fields are never trusted, the digest is recomputed from the record's own body with the production canonicalSha256, and the audit record/baseline/dependency bindings are re-checked.",
      "STALE_BASELINE and the §77 replay verdict come from src/shared/autonomous-evolution-trust.ts itself (assessBaseline, replayAttackVerdict), not from a re-typed rule."
    ],
    independent_verifier:
      "scripts/acceptance-evolution-certificate.cjs (Validator B, §17/§76) verifies the *Prestart* certificate shape (prestart-attestation.json: state/bootstrap/session_id/commit_sha/tree_sha/graduate_identity/sources). This lab builds the §47 *evolution* certificate (autonomous-evolution-attestation.json), so the AD-30/31/46/50 refusals are re-derivations taken in the lab, not Validator B runs. Wiring Validator B into these cases needs a Prestart-shaped certificate fixture and is the recommended Phase F follow-up.",
    contract_note:
      "Every refusal is a structured code; the report carries no prose-based decision. Real production codes (TRUST_CODES, OWNER_LEDGER_CODES) and the lab's binding codes are both reported so a reader can tell which layer refused."
  };
}

/** Convenience for a real git commit inside a lab repository. */
export function commitIn(root: string, message: string): string {
  return commit(root, message);
}

export function headOf(root: string): string {
  return revParse(root, "HEAD");
}

export function treeOf(root: string): string {
  return revParse(root, "HEAD^{tree}");
}

/** Rewrites a ledger whose bytes are bound to another session (§2.3). */
export function foreignLedger(session: { session_id: string; commit_sha: string }): OwnerInterventionLedger {
  const body = {
    schemaVersion: 1 as const,
    session_id: session.session_id,
    commit_sha: session.commit_sha,
    events: [],
    count: 0
  };
  return { ...body, ledger_hash: ownerLedgerHashOf(body) };
}

export { verifyOwnerLedger, emptyOwnerLedger, canonicalJson, canonicalSha256, sha256File };
