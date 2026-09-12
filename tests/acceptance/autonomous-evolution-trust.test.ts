/**
 * Update-Plan/self-evlo.md §2, §3, §4, §14, §16, §28–§34, §49–§52, §75, §77, §79, §91
 * (Phase C, TE-01..TE-12) — the autonomous self-modification boundary.
 *
 * Every scenario is driven by real files, real git repositories and real SHA-256 digests:
 * the boundary is asked about the repository this suite runs in, and a candidate diff is a
 * genuine `git commit`, not a fixture's opinion. No production module knows a test exists.
 *
 * Generation mode: `BOSS_GENERATE_EVOLUTION_TRUST=1` re-blesses the committed
 * `trust-policy/root-trust-surface.json` and `trust-policy/trust-epoch.json` from the
 * module's own generators (see `writeTrustPolicyData`). A normal run only verifies them —
 * the acceptance suite is the only writer, so a hand edit of either side is refused.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AcceptanceRun, acceptanceArtifacts } from "../helpers/acceptance-report";
import { cleanupFixtures, commit, gitRepo, revParse, tempDir, write } from "../helpers/root-fixtures";
import { CAPABILITY_GATES, contractedGates } from "../../src/shared/acceptance-contracts";
import { assessProtectedPaths, isProtectedPath } from "../../src/shared/root-authority/protected-surface";
import type { TrustProblem } from "../../src/shared/trust-problems";
import {
  AUTONOMOUS_BRANCH_PREFIX,
  CAPABILITY_STATES,
  DEFAULT_EVOLUTION_BUDGET,
  EVOLUTION_ALL_STATES,
  EVOLUTION_ARTIFACTS_ROOT,
  EVOLUTION_FAILURE_STATES,
  EVOLUTION_RUN_STATES,
  EVOLUTION_TRANSITIONS,
  EVOLUTION_TRUST_CODES,
  NEVER_FORCE_PUSHED_BRANCHES,
  PLAN_SECTION_3_ROOT_TRUST_PATHS,
  PROMOTION_EDGE,
  REPLAY_BINDING_FIELDS,
  REQUIREMENT_RETIREMENTS_FILENAME,
  ROOT_CONTRACT_VERSION_PREFIX,
  ROOT_TRUST_SURFACE_EXTENSIONS,
  ROOT_TRUST_SURFACE_FILENAME,
  ROOT_TRUST_SURFACE_PATHS,
  TRUST_EPOCH_FILENAME,
  advanceRunState,
  advanceTrustEpoch,
  assertCandidateImmutable,
  assertRunStateAdvance,
  assessBaseline,
  assessBudget,
  assessCapabilityRegistry,
  assessRootTrustChange,
  assessScope,
  autonomousBranchFor,
  canAdvance,
  capabilityEvidenceGraph,
  classifySurface,
  containmentPath,
  declaredRootTrustSurface,
  epochHashOf,
  forcePushDecision,
  isValidRunId,
  judgeSelfCertification,
  namespaceFor,
  parseTrustEpochFile,
  replayAttackVerdict,
  rollbackPlan,
  rootSurfaceManifest,
  rootSurfaceManifestText,
  rootTrustSurfaceFiles,
  trustEpochFile,
  verifyTrustEpoch,
  verifyTrustEpochFile,
  type CapabilityRegistry,
  type CapabilityState,
  type EvolutionScope,
  type ReplayBinding,
  type RootSurfaceFile,
  type SurfaceClass
} from "../../src/shared/autonomous-evolution-trust";

const run = new AcceptanceRun("AUTONOMOUS_EVOLUTION_TRUST");
const REPORT_DIR = acceptanceArtifacts();
const REPO_ROOT = process.cwd();

const COMMITTED_SURFACE = path.join(REPO_ROOT, ROOT_TRUST_SURFACE_FILENAME);
const COMMITTED_EPOCH = path.join(REPO_ROOT, TRUST_EPOCH_FILENAME);
const COMMITTED_RETIREMENTS = path.join(REPO_ROOT, REQUIREMENT_RETIREMENTS_FILENAME);

/* -------------------------------------------------------------------------- */
/* real-file helpers                                                           */
/* -------------------------------------------------------------------------- */

function sha256Of(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeJson(file: string, value: unknown): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

/** Every file git knows about (tracked + untracked, ignored excluded), digested. */
function gitInventory(root: string): RootSurfaceFile[] {
  const listing = execFileSync("git", ["ls-files", "-z", "-c", "-o", "--exclude-standard"], { cwd: root, stdio: "pipe" }).toString("utf8");
  const files: RootSurfaceFile[] = [];
  for (const relative of listing.split("\0")) {
    if (!relative) continue;
    const absolute = path.join(root, ...relative.split("/"));
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    files.push({ path: relative, sha256: sha256Of(fs.readFileSync(absolute)) });
  }
  return files;
}

/** Every file of a plain directory tree (temp fixtures that are not git repositories). */
function treeInventory(root: string): RootSurfaceFile[] {
  const files: RootSurfaceFile[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) files.push({ path: relative, sha256: sha256Of(fs.readFileSync(absolute)) });
    }
  };
  walk(root, "");
  return files;
}

/** A copy of an inventory with one path's digest replaced — a simulated edit. */
function withDigest(files: readonly RootSurfaceFile[], target: string, digest: string): RootSurfaceFile[] {
  return files.map((file) => (file.path === target ? { path: file.path, sha256: digest } : file));
}

/** §4: the surface hash a run would compute for this inventory. */
function surfaceAggregate(files: readonly RootSurfaceFile[]): string {
  return rootSurfaceManifest(rootTrustSurfaceFiles(files)).aggregate_hash;
}

function codesOf(problems: readonly TrustProblem[]): string[] {
  return problems.map((problem) => problem.code);
}

function hasCode(problems: readonly TrustProblem[], code: string): boolean {
  return problems.some((problem) => problem.code === code);
}

interface SurfaceDeclaration {
  schema_version: number;
  unit: string;
  machine_generated: boolean;
  declared: { paths: string[]; count: number; boundary_hash: string };
}

/* -------------------------------------------------------------------------- */
/* generation mode — the only writer of the committed trust-policy data        */
/* -------------------------------------------------------------------------- */

function writeTrustPolicyData(): void {
  writeJson(COMMITTED_SURFACE, declaredRootTrustSurface());
  // The genesis epoch records the surface hash of the surface it was born with. Any later
  // Root Trust change invalidates it and requires `advanceTrustEpoch` — never a hand edit.
  const genesis = advanceTrustEpoch({
    previous: null,
    rootSurfaceHash: surfaceAggregate(gitInventory(REPO_ROOT)),
    createdAt: new Date().toISOString()
  });
  writeJson(COMMITTED_EPOCH, trustEpochFile(genesis));
}

if (process.env.BOSS_GENERATE_EVOLUTION_TRUST === "1") writeTrustPolicyData();

/* -------------------------------------------------------------------------- */

describe("Phase C self-evlo §2/§3/§4/§14/§28–§34/§49–§52/§75/§77/§79/§91", () => {
  it("TE-01 the Root Trust Surface list covers every path §3 names and nothing else", async () => {
    await run.scenario("TE-01", "§3 root trust surface list", (item) => {
      for (const planPath of PLAN_SECTION_3_ROOT_TRUST_PATHS) {
        item.check(`${planPath} is declared`, true, ROOT_TRUST_SURFACE_PATHS.includes(planPath));
        item.check(`${planPath} classifies as ROOT_TRUST_SURFACE`, "ROOT_TRUST_SURFACE", classifySurface(planPath));
      }
      for (const extension of ROOT_TRUST_SURFACE_EXTENSIONS) {
        item.check(`${extension} is declared`, true, ROOT_TRUST_SURFACE_PATHS.includes(extension));
        item.check(`${extension} is classifiable`, true, classifySurface(extension) === "ROOT_TRUST_SURFACE");
      }
      item.check(
        "the boundary is the plan list plus the Phase C extensions",
        PLAN_SECTION_3_ROOT_TRUST_PATHS.length + ROOT_TRUST_SURFACE_EXTENSIONS.length,
        ROOT_TRUST_SURFACE_PATHS.length
      );

      // "and nothing else does": real repository paths that are not Root Trust.
      const notRootTrust = [
        "README.md",
        "package.json",
        ".github/CODEOWNERS",
        "src/renderer/main.tsx",
        "src/shared/hash.ts",
        "src/shared/acceptance-hub.ts",
        "electron/main.ts",
        "electron/self-evolution/runner.ts",
        "electron/stable-candidate/supervisor.ts",
        "electron/promotion-gate/controller.ts",
        "scripts/benchmark.cjs",
        "scripts/acceptance-soak.cjs",
        "tests/unit/hash.test.ts",
        "tests/helpers/root-fixtures.ts"
      ];
      for (const other of notRootTrust) {
        item.check(`${other} is not root trust`, false, classifySurface(other) === "ROOT_TRUST_SURFACE");
      }

      // The three committed trust-policy data files are inside the boundary.
      for (const dataFile of [ROOT_TRUST_SURFACE_FILENAME, TRUST_EPOCH_FILENAME, REQUIREMENT_RETIREMENTS_FILENAME]) {
        item.check(`${dataFile} is root trust`, "ROOT_TRUST_SURFACE", classifySurface(dataFile));
        item.check(`${dataFile} is committed data`, true, fs.existsSync(path.join(REPO_ROOT, dataFile)));
      }
      item.check("the retirement record starts empty (§13)", "[]", JSON.stringify(readJson(COMMITTED_RETIREMENTS)));

      // The new boundary refines the existing Owner-review guard where they overlap.
      item.check("the host guard already protects scripts/acceptance-*.cjs", true, isProtectedPath("scripts/acceptance-attest.cjs"));
      item.check("and .github/workflows", true, isProtectedPath(".github/workflows/ci.yml"));
      item.check("while trust-policy data is new ground for it", 0, assessProtectedPaths(["trust-policy/trust-epoch.json"]).hits.length);
      item.cite("ROOT_TRUST_SURFACE_PATHS");
    });
  });

  it("TE-02 representative repository paths classify into the four §2 tiers", async () => {
    await run.scenario("TE-02", "§2 surface classification", (item) => {
      const cases: [string, SurfaceClass][] = [
        ["src/app/main.ts", "PRODUCT_SURFACE"],
        ["src/renderer/main.tsx", "PRODUCT_SURFACE"],
        ["src/shared/hash.ts", "PRODUCT_SURFACE"],
        ["electron/main.ts", "PRODUCT_SURFACE"],
        ["package.json", "PRODUCT_SURFACE"],
        ["electron/self-evolution/runner.ts", "EVOLUTION_ENGINE"],
        ["electron/stable-candidate/supervisor.ts", "EVOLUTION_ENGINE"],
        ["electron/promotion-gate/controller.ts", "EVOLUTION_ENGINE"],
        ["src/shared/autonomous-evolution-identity.ts", "ROOT_TRUST_SURFACE"],
        ["electron/engineering/autonomous-evolution-identity.ts", "ROOT_TRUST_SURFACE"],
        ["electron/self-evolution/autonomous-evolution-runner.ts", "ROOT_TRUST_SURFACE"],
        ["src/shared/acceptance-contracts.ts", "ROOT_TRUST_SURFACE"],
        ["src/shared/acceptance-evidence.ts", "ROOT_TRUST_SURFACE"],
        ["src/shared/bootstrap-audit.ts", "ROOT_TRUST_SURFACE"],
        ["src/shared/owner-intervention.ts", "ROOT_TRUST_SURFACE"],
        ["src/shared/acceptance-hub.ts", "VERIFICATION_SURFACE"],
        ["scripts/acceptance-attest.cjs", "ROOT_TRUST_SURFACE"],
        ["scripts/acceptance-soak.cjs", "VERIFICATION_SURFACE"],
        ["scripts/acceptance-autonomous-evolution.cjs", "ROOT_TRUST_SURFACE"],
        [".github/workflows/ci.yml", "ROOT_TRUST_SURFACE"],
        [".github/CODEOWNERS", "VERIFICATION_SURFACE"],
        ["tests/acceptance/theme-engine.test.ts", "ROOT_TRUST_SURFACE"],
        ["tests/helpers/trusted-evidence.ts", "ROOT_TRUST_SURFACE"],
        ["tests/helpers/root-fixtures.ts", "VERIFICATION_SURFACE"],
        ["electron/engineering/acceptance-session.ts", "ROOT_TRUST_SURFACE"]
      ];
      for (const [file, expected] of cases) item.check(`${file} → ${expected}`, expected, classifySurface(file));

      // The interesting cases are real paths, not invented ones.
      const realPaths = [
        "src/renderer/main.tsx",
        "src/shared/hash.ts",
        "src/shared/acceptance-contracts.ts",
        "src/shared/acceptance-hub.ts",
        "electron/main.ts",
        "electron/engineering/acceptance-session.ts",
        "scripts/acceptance-attest.cjs",
        "scripts/acceptance-soak.cjs",
        ".github/workflows/ci.yml",
        ".github/CODEOWNERS",
        "tests/acceptance/theme-engine.test.ts",
        "tests/helpers/root-fixtures.ts"
      ];
      item.check("every representative path exists in this repository", 0, realPaths.filter((file) => !fs.existsSync(path.join(REPO_ROOT, file))).length);

      // Normalization and containment: the two things the host guard also refuses to guess.
      item.check("Windows separators normalize", "ROOT_TRUST_SURFACE", classifySurface("src\\shared\\acceptance-contracts.ts"));
      item.check("case-insensitive like the host guard", "ROOT_TRUST_SURFACE", classifySurface("SRC/SHARED/ACCEPTANCE-CONTRACTS.TS"));
      item.check("an escape cannot be a root trust path", "PRODUCT_SURFACE", classifySurface("../../etc/passwd"));
      item.check("an absolute path cannot be a root trust path", "PRODUCT_SURFACE", classifySurface("C:/outside/acceptance-contracts.ts"));
      item.cite("classifySurface");
    });
  });

  it("TE-03 a real candidate diff is classified as ROOT_TRUST_CHANGE or not", async () => {
    await run.scenario("TE-03", "§3/§51 root trust change detection", (item) => {
      const repo = gitRepo("boss-te-diff-");
      write(repo.root, "src/shared/acceptance-contracts.ts", "export const contract = 1;\n");
      write(repo.root, "scripts/acceptance-attest.cjs", "module.exports = {};\n");
      write(repo.root, "src/app/main.ts", "export const main = 1;\n");
      const baselineCommit = commit(repo.root, "baseline");
      const baseline = gitInventory(repo.root);

      write(repo.root, "src/shared/acceptance-contracts.ts", "export const contract = 2;\n");
      write(repo.root, "trust-policy/new-policy.json", "{\n  \"policy\": 1\n}\n");
      fs.rmSync(path.join(repo.root, "scripts", "acceptance-attest.cjs"));
      write(repo.root, "src/app/main.ts", "export const main = 2;\n");
      const candidateCommit = commit(repo.root, "candidate");
      const candidate = gitInventory(repo.root);
      const assessment = assessRootTrustChange({ baseline, candidate });

      const gitChanged = execFileSync("git", ["diff", "--name-only", baselineCommit, candidateCommit], { cwd: repo.root, stdio: "pipe" })
        .toString("utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .sort();
      item.check("the assessed diff is the repository's real diff", JSON.stringify(gitChanged), JSON.stringify(assessment.changed.map((change) => change.path).sort()));
      item.check("a root trust change is detected", "ROOT_TRUST_CHANGE", assessment.verdict);
      item.check("rootTrustTouched is true", true, assessment.rootTrustTouched);
      const kindOf = (file: string): string | undefined => assessment.changed.find((change) => change.path === file)?.kind;
      item.check("the edited contract is MODIFIED", "MODIFIED", kindOf("src/shared/acceptance-contracts.ts"));
      item.check("the new trust-policy file is ADDED", "ADDED", kindOf("trust-policy/new-policy.json"));
      item.check("the deleted attest script is REMOVED", "REMOVED", kindOf("scripts/acceptance-attest.cjs"));
      item.check("the product file is still reported", "MODIFIED", kindOf("src/app/main.ts"));
      item.check("and classified PRODUCT_SURFACE", "PRODUCT_SURFACE", assessment.changed.find((change) => change.path === "src/app/main.ts")?.surface);
      item.check("the surface hash moved", false, assessment.sha256_after === assessment.sha256_before);

      const productOnly = assessRootTrustChange({ baseline: candidate, candidate: withDigest(candidate, "src/app/main.ts", "f".repeat(64)) });
      item.check("a product-only diff is not a root trust change", "ROOT_TRUST_UNCHANGED", productOnly.verdict);
      item.check("rootTrustTouched stays false", false, productOnly.rootTrustTouched);
      item.check("and the root surface hash is unchanged", productOnly.sha256_before, productOnly.sha256_after);
      item.check("while the product path is still listed", "src/app/main.ts", productOnly.changed[0]?.path);
      item.cite("assessRootTrustChange");
    });
  });

  it("TE-04 the machine-generated manifest is stable and byte-sensitive", async () => {
    await run.scenario("TE-04", "§3 machine-generated manifest", (item) => {
      const declaration = readJson(COMMITTED_SURFACE) as SurfaceDeclaration;
      const generated = declaredRootTrustSurface();
      item.check("the committed file is the generated declaration", JSON.stringify(generated.declared), JSON.stringify(declaration.declared));
      item.check("it is marked machine-generated", true, declaration.machine_generated === true);
      item.check("unit", "AUTONOMOUS_EVOLUTION_TRUST", declaration.unit);
      item.check("schema version", 1, declaration.schema_version);
      item.check("count matches the declared paths", declaration.declared.paths.length, declaration.declared.count);

      const dir = tempDir("boss-te-manifest-");
      write(dir, "src/shared/acceptance-contracts.ts", "export const version = 1;\n");
      write(dir, "src/shared/acceptance-evidence.ts", "export const evidence = 1;\n");
      write(dir, "src/app/main.ts", "export const main = 1;\n");
      const surface = rootTrustSurfaceFiles(treeInventory(dir));
      item.check("only root trust files enter the surface", 2, surface.length);
      const manifest = rootSurfaceManifest(surface);
      item.check("count", 2, manifest.count);
      item.check("paths are sorted", "src/shared/acceptance-contracts.ts,src/shared/acceptance-evidence.ts", manifest.paths.join(","));
      item.check("the aggregate is the hash of the canonical text", sha256Of(rootSurfaceManifestText(manifest.entries)), manifest.aggregate_hash);
      const reordered = rootSurfaceManifest([...surface].reverse());
      item.check("stable under input order", manifest.aggregate_hash, reordered.aggregate_hash);
      item.check("stable under repeated generation", manifest.aggregate_hash, rootSurfaceManifest(surface).aggregate_hash);

      const before = manifest.entries.find((entry) => entry.path === "src/shared/acceptance-contracts.ts")?.sha256;
      write(dir, "src/shared/acceptance-contracts.ts", "export const version = 2;\n");
      const after = rootSurfaceManifest(rootTrustSurfaceFiles(treeInventory(dir)));
      item.check("one byte changes the file digest", false, after.entries.find((entry) => entry.path === "src/shared/acceptance-contracts.ts")?.sha256 === before);
      item.check("and the aggregate hash", false, after.aggregate_hash === manifest.aggregate_hash);
      item.check("while the path set is unchanged", JSON.stringify(manifest.paths), JSON.stringify(after.paths));
      item.cite(ROOT_TRUST_SURFACE_FILENAME);
    });
  });

  it("TE-05 a real trust-epoch file round-trips and refuses tampering", async () => {
    await run.scenario("TE-05", "§4 trust epoch file", (item) => {
      const liveSurface = surfaceAggregate(gitInventory(REPO_ROOT));
      const epochFile = path.join(tempDir("boss-te-epoch-"), TRUST_EPOCH_FILENAME);
      const record = advanceTrustEpoch({ previous: null, rootSurfaceHash: liveSurface, createdAt: "2026-01-01T00:00:00.000Z" });
      writeJson(epochFile, trustEpochFile(record));

      item.check("the epoch file is a real file", true, fs.existsSync(epochFile));
      item.check("a real epoch file parses", 0, parseTrustEpochFile(readJson(epochFile)).problems.length);
      item.check("and verifies against its surface", 0, verifyTrustEpochFile({ value: readJson(epochFile), rootSurfaceHash: liveSurface }).length);

      writeJson(epochFile, { ...(readJson(epochFile) as Record<string, unknown>), epoch_hash: "0".repeat(64) });
      item.check("a tampered stored digest is refused", true, hasCode(parseTrustEpochFile(readJson(epochFile)).problems, EVOLUTION_TRUST_CODES.TRUST_EPOCH_HASH_MISMATCH));

      writeJson(epochFile, { ...trustEpochFile(record), record: { ...record, root_surface_hash: "a".repeat(64) } });
      item.check("a tampered record is refused", true, hasCode(parseTrustEpochFile(readJson(epochFile)).problems, EVOLUTION_TRUST_CODES.TRUST_EPOCH_HASH_MISMATCH));

      writeJson(epochFile, trustEpochFile(record));
      item.check(
        "a wrong root-surface hash is refused",
        true,
        hasCode(verifyTrustEpochFile({ value: readJson(epochFile), rootSurfaceHash: "b".repeat(64) }), EVOLUTION_TRUST_CODES.TRUST_EPOCH_ROOT_SURFACE_MISMATCH)
      );
      item.check("a missing epoch is refused", EVOLUTION_TRUST_CODES.TRUST_EPOCH_MISSING, parseTrustEpochFile(undefined).problems[0]?.code);
      item.check(
        "an unsupported schema is refused",
        EVOLUTION_TRUST_CODES.TRUST_EPOCH_SCHEMA_UNSUPPORTED,
        parseTrustEpochFile({ schema_version: 99, record, epoch_hash: epochHashOf(record) }).problems[0]?.code
      );

      const committed = parseTrustEpochFile(readJson(COMMITTED_EPOCH));
      item.check("the committed epoch parses", 0, committed.problems.length);
      // self-evlo §4: an epoch only ever moves forward, and a moved epoch is chained to
      // its parent. Asserting the invariants (not the literal number) keeps this true
      // after a legitimate re-bless — which is exactly what an epoch advance is.
      const epochNumber = committed.file?.record.trust_epoch ?? 0;
      item.check("the epoch is a positive integer", true, Number.isInteger(epochNumber) && epochNumber >= 1);
      item.check(
        "a genesis epoch has no parent, an advanced one carries a digest",
        true,
        epochNumber === 1
          ? (committed.file?.record.parent_epoch_hash ?? "") === ""
          : /^[0-9a-f]{64}$/.test(committed.file?.record.parent_epoch_hash ?? "")
      );
      item.check("its contract version is the epoch's", `${ROOT_CONTRACT_VERSION_PREFIX}${epochNumber}`, committed.file?.record.root_contract_version);
      item.check("its stored digest covers the record", true, committed.file?.epoch_hash === epochHashOf(committed.file!.record));
      item.check(
        "it verifies against the surface it recorded",
        0,
        verifyTrustEpochFile({ value: readJson(COMMITTED_EPOCH), rootSurfaceHash: committed.file!.record.root_surface_hash }).length
      );
      const drifted = hasCode(verifyTrustEpochFile({ value: readJson(COMMITTED_EPOCH), rootSurfaceHash: liveSurface }), EVOLUTION_TRUST_CODES.TRUST_EPOCH_ROOT_SURFACE_MISMATCH);
      item.check(
        "a root trust change since the epoch demands a migration",
        true,
        drifted === (committed.file!.record.root_surface_hash !== liveSurface)
      );
      item.cite(TRUST_EPOCH_FILENAME);
    });
  });

  it("TE-06 advancing an epoch bumps the number, the version and the parent hash", async () => {
    await run.scenario("TE-06", "§4 trust epoch advancement", (item) => {
      const live = gitInventory(REPO_ROOT);
      const liveSurface = surfaceAggregate(live);
      const driftedSurface = surfaceAggregate(withDigest(live, "src/shared/acceptance-contracts.ts", "c".repeat(64)));
      item.check("the drifted surface is a different surface", false, driftedSurface === liveSurface);

      const previous = parseTrustEpochFile(readJson(COMMITTED_EPOCH)).file!.record;
      item.check("the drifted surface is not the epoch's surface", false, driftedSurface === previous.root_surface_hash);
      const next = advanceTrustEpoch({ previous, rootSurfaceHash: driftedSurface, createdAt: "2026-02-02T00:00:00.000Z" });

      item.check("the epoch number bumps", previous.trust_epoch + 1, next.trust_epoch);
      item.check("the contract version bumps with it", `${ROOT_CONTRACT_VERSION_PREFIX}${next.trust_epoch}`, next.root_contract_version);
      item.check("and the version is not the previous one", false, next.root_contract_version === previous.root_contract_version);
      item.check("the parent hash is the previous epoch's digest", epochHashOf(previous), next.parent_epoch_hash);
      item.check("the record carries the new surface", driftedSurface, next.root_surface_hash);
      item.check(
        "the new epoch verifies with its parent",
        0,
        verifyTrustEpoch({ record: next, rootSurfaceHash: driftedSurface, epochHash: epochHashOf(next), parent: previous }).length
      );
      item.check(
        "the old record no longer verifies against the new surface",
        true,
        hasCode(verifyTrustEpoch({ record: previous, rootSurfaceHash: driftedSurface }), EVOLUTION_TRUST_CODES.TRUST_EPOCH_ROOT_SURFACE_MISMATCH)
      );
      item.check(
        "a forged parent is refused",
        true,
        // The forgery must differ from the real previous record whatever the committed
        // epoch number happens to be (it advances on every Root Trust change).
        hasCode(verifyTrustEpoch({ record: next, rootSurfaceHash: driftedSurface, parent: { ...previous, trust_epoch: previous.trust_epoch + 99 } }), EVOLUTION_TRUST_CODES.TRUST_EPOCH_PARENT_MISMATCH)
      );
      item.check(
        "a tampered epoch digest is refused",
        true,
        hasCode(verifyTrustEpoch({ record: next, rootSurfaceHash: driftedSurface, epochHash: "0".repeat(64) }), EVOLUTION_TRUST_CODES.TRUST_EPOCH_HASH_MISMATCH)
      );

      let refused = false;
      try {
        advanceTrustEpoch({ previous, rootSurfaceHash: "not-a-hash", createdAt: "2026-02-02T00:00:00.000Z" });
      } catch {
        refused = true;
      }
      item.check("an epoch cannot be written with a malformed surface hash", true, refused);
      item.cite("advanceTrustEpoch");
    });
  });

  it("TE-07 self-certification is refused after a root trust change", async () => {
    await run.scenario("TE-07", "§4/§51/§75 self-certification refusal", (item) => {
      // §75: the candidate rewrites the acceptance verifier so that it always returns PASS.
      const repo = gitRepo("boss-te-selfcert-");
      write(repo.root, "src/shared/acceptance-evidence.ts", "export const verdict = () => \"PASS\";\n");
      write(repo.root, "src/app/main.ts", "export const main = 1;\n");
      commit(repo.root, "baseline");
      const baseline = gitInventory(repo.root);

      write(repo.root, "src/shared/acceptance-evidence.ts", "export const verdict = () => \"PASS\"; // always PASS\n");
      commit(repo.root, "self-corruption");
      const corruptedBase = gitInventory(repo.root);
      const corrupted = assessRootTrustChange({ baseline, candidate: corruptedBase });
      item.check("the self-corruption diff is a root trust change", "ROOT_TRUST_CHANGE", corrupted.verdict);
      item.check("rootTrustTouched", true, corrupted.rootTrustTouched);

      const epoch = advanceTrustEpoch({ previous: null, rootSurfaceHash: corrupted.sha256_before, createdAt: "2026-03-03T00:00:00.000Z" });
      const refusal = judgeSelfCertification({ epoch, rootTrustChange: corrupted, runId: "run-self-corruption" });
      item.check("self-certification is refused", false, refusal.allowed);
      item.check("with SELF_CERTIFICATION_FORBIDDEN", "SELF_CERTIFICATION_FORBIDDEN", refusal.code);
      item.check("and TRUST_EPOCH_MIGRATION", "TRUST_EPOCH_MIGRATION", refusal.required_action);
      item.check("the run state is ROOT_TRUST_CHANGED", "ROOT_TRUST_CHANGED", refusal.run_state);
      item.check("the reason names the run and the rewritten judge", true, refusal.reason.includes("run-self-corruption") && refusal.reason.includes("src/shared/acceptance-evidence.ts"));

      write(repo.root, "src/app/main.ts", "export const main = 2;\n");
      const productCommit = commit(repo.root, "product only");
      item.check("the product change is a real commit", productCommit, revParse(repo.root, "HEAD"));
      const stable = assessRootTrustChange({ baseline: corruptedBase, candidate: gitInventory(repo.root) });
      item.check("a product-only diff leaves the surface stable", "ROOT_TRUST_UNCHANGED", stable.verdict);
      const stableEpoch = advanceTrustEpoch({ previous: null, rootSurfaceHash: stable.sha256_before, createdAt: "2026-03-03T01:00:00.000Z" });
      const allowed = judgeSelfCertification({ epoch: stableEpoch, rootTrustChange: stable, runId: "run-product-only" });
      item.check("self-certification is allowed", true, allowed.allowed);
      item.check("with OK", "OK", allowed.code);
      item.check("and no required action", "NONE", allowed.required_action);
      item.check("the run state is ROOT_TRUST_STABLE", "ROOT_TRUST_STABLE", allowed.run_state);

      const noEpoch = judgeSelfCertification({ epoch: undefined, rootTrustChange: stable, runId: "run-no-epoch" });
      item.check("a run without an epoch may not certify either", false, noEpoch.allowed);
      item.check("and must migrate the epoch", "TRUST_EPOCH_MIGRATION", noEpoch.required_action);
      const wrongEpoch = judgeSelfCertification({ epoch: epoch, rootTrustChange: stable, runId: "run-wrong-epoch" });
      item.check("an epoch for another surface may not certify this one", false, wrongEpoch.allowed);
      item.cite("judgeSelfCertification");
    });
  });

  it("TE-08 capability monotonicity refuses silent capability loss", async () => {
    await run.scenario("TE-08", "§14 capability monotonicity", (item) => {
      const capabilities = Object.keys(CAPABILITY_GATES);
      item.check("the repository declares 13 capabilities (§91)", 13, capabilities.length);
      item.check("the four §14 states plus UNKNOWN are known", "ESTABLISHED,DEGRADED,REMOVED,NEW,UNKNOWN", CAPABILITY_STATES.join(","));
      const established: CapabilityRegistry = Object.fromEntries(capabilities.map((capability) => [capability, "ESTABLISHED" as CapabilityState]));

      const unchanged = assessCapabilityRegistry({ baseline: established, candidate: established });
      item.check("identical registries are UNCHANGED", "CAPABILITY_UNCHANGED", unchanged.verdict);
      item.check("with no transitions", 0, unchanged.transitions.length);

      const unknown = assessCapabilityRegistry({ baseline: established, candidate: { ...established, "review layers": "UNKNOWN" } });
      item.check("ESTABLISHED → UNKNOWN is breaking", "BREAKING_CAPABILITY_CHANGE", unknown.verdict);
      item.check("and the transition is marked breaking", true, unknown.transitions.find((transition) => transition.capability === "review layers")?.breaking);
      item.check("the from/to pair is recorded", "ESTABLISHED→UNKNOWN", unknown.transitions.map((transition) => `${transition.from}→${transition.to}`).join(","));

      const removedRegistry: Record<string, CapabilityState> = { ...established };
      delete removedRegistry["theme engine"];
      const removed = assessCapabilityRegistry({ baseline: established, candidate: removedRegistry });
      item.check("ESTABLISHED → REMOVED is breaking", "BREAKING_CAPABILITY_CHANGE", removed.verdict);
      item.check("a dropped key is REMOVED, not ignored", "REMOVED", removed.transitions.find((transition) => transition.capability === "theme engine")?.to);
      item.check("and the removed list names it", JSON.stringify(["theme engine"]), JSON.stringify(removed.removed));

      const grown = assessCapabilityRegistry({
        baseline: established,
        candidate: { ...established, "self-modification boundary": "ESTABLISHED" }
      });
      item.check("a new capability grows the registry", "CAPABILITY_GROWN", grown.verdict);
      const growth = grown.transitions.find((transition) => transition.capability === "self-modification boundary");
      item.check("its from state is NEW", "NEW", growth?.from);
      item.check("and it is not breaking", false, growth?.breaking);

      const degraded = assessCapabilityRegistry({ baseline: established, candidate: { ...established, "CI repair loop": "DEGRADED" } });
      item.check("ESTABLISHED → DEGRADED is a regression, not growth", "CAPABILITY_REGRESSION", degraded.verdict);
      item.check("and the degraded list names it", JSON.stringify(["CI repair loop"]), JSON.stringify(degraded.degraded));
      item.cite("assessCapabilityRegistry");
    });
  });

  it("TE-09 the capability evidence graph binds each capability to trusted gates", async () => {
    await run.scenario("TE-09", "§91 capability evidence graph", (item) => {
      const gates = [...new Set(Object.values(CAPABILITY_GATES).flat())].sort();
      const contracted = new Set(contractedGates());
      item.check("every capability gate is a contracted gate", 0, gates.filter((gate) => !contracted.has(gate)).length);

      const graph = capabilityEvidenceGraph({ trustedGates: gates });
      item.check("the graph covers all 13 capabilities", 13, graph.length);
      item.check("each capability is bound to at least one gate", 0, graph.filter((entry) => entry.gates.length === 0).length);
      item.check("all capabilities are established when every gate is trusted", 13, graph.filter((entry) => entry.established).length);
      item.check("with no missing evidence", 0, graph.reduce((total, entry) => total + entry.missing_evidence.length, 0));
      const theme = graph.find((entry) => entry.capability === "theme engine")!;
      item.check("the theme engine keeps its real gates", JSON.stringify(CAPABILITY_GATES["theme engine"]), JSON.stringify(theme.gates));

      const partial = capabilityEvidenceGraph({ trustedGates: gates.filter((gate) => gate !== "acceptance-verify") });
      const verification = partial.find((entry) => entry.capability === "verification engine")!;
      item.check("a missing trusted gate leaves its capability unestablished", false, verification.established);
      item.check("and missing_evidence names the gate", JSON.stringify(["acceptance-verify"]), JSON.stringify(verification.missing_evidence));
      item.check("the other twelve capabilities are unaffected", 12, partial.filter((entry) => entry.established).length);
      item.check("no trusted evidence establishes nothing", 0, capabilityEvidenceGraph({ trustedGates: [] }).filter((entry) => entry.established).length);
      item.cite("capabilityEvidenceGraph");
    });
  });

  it("TE-10 the run lifecycle refuses jumps and keeps certification apart from promotion", async () => {
    await run.scenario("TE-10", "§28–§34 run lifecycle", (item) => {
      item.check("ten forward states", 10, EVOLUTION_RUN_STATES.length);
      item.check("three explicit failure exits", "FAILED,ROLLED_BACK,BLOCKED_EXTERNAL", EVOLUTION_FAILURE_STATES.join(","));

      let forward = true;
      for (let index = 0; index + 1 < EVOLUTION_RUN_STATES.length; index++) {
        forward = forward && canAdvance(EVOLUTION_RUN_STATES[index], EVOLUTION_RUN_STATES[index + 1]);
      }
      item.check("the whole forward path is accepted", true, forward);
      item.check("IMPLEMENTING → CERTIFIED is refused", false, canAdvance("IMPLEMENTING", "CERTIFIED"));
      item.check("CREATED → CERTIFIED is refused", false, canAdvance("CREATED", "CERTIFIED"));
      item.check("CREATED → PROMOTED is refused", false, canAdvance("CREATED", "PROMOTED"));
      item.check("CERTIFIED → VERIFYING (backwards) is refused", false, canAdvance("CERTIFIED", "VERIFYING"));
      item.check("a terminal run cannot restart", false, canAdvance("FAILED", "PLANNED"));

      const jump = advanceRunState("IMPLEMENTING", "CERTIFIED");
      item.check("the jump returns a problem", EVOLUTION_TRUST_CODES.RUN_STATE_JUMP_REFUSED, codesOf(jump.problems)[0]);
      item.check("and does not move the run", false, jump.ok);
      item.check("an unknown state is refused", EVOLUTION_TRUST_CODES.RUN_STATE_UNKNOWN, codesOf(advanceRunState("CREATED", "TURBO").problems)[0]);
      item.check("an accepted step returns the next state", "BASELINE_VERIFIED", assertRunStateAdvance("CREATED", "BASELINE_VERIFIED"));
      let threw = false;
      try {
        assertRunStateAdvance("IMPLEMENTING", "CERTIFIED");
      } catch {
        threw = true;
      }
      item.check("the throwing variant refuses the same jump", true, threw);

      // §29: certification and promotion are separate steps.
      const intoPromoted = EVOLUTION_ALL_STATES.filter((state) => EVOLUTION_TRANSITIONS[state].includes("PROMOTED"));
      item.check("only CERTIFIED may promote", JSON.stringify(["CERTIFIED"]), JSON.stringify(intoPromoted));
      item.check("the promotion edge is declared", "CERTIFIED→PROMOTED", `${PROMOTION_EDGE.from}→${PROMOTION_EDGE.to}`);
      const certified = advanceRunState("CERTIFYING", "CERTIFIED");
      item.check("a certified run lands in CERTIFIED", "CERTIFIED", certified.to);
      item.check("which is not PROMOTED", false, certified.to === "PROMOTED");
      item.check("promotion is a separate, later step", true, canAdvance("CERTIFIED", "PROMOTED"));

      // §32 branch policy, §33 rollback contract, §34 containment.
      item.check("the candidate branch is boss/evolution/<run-id>", `${AUTONOMOUS_BRANCH_PREFIX}run-42`, autonomousBranchFor("run-42"));
      item.check("a run id that could escape the namespace is refused", false, isValidRunId("../etc"));
      let branchThrew = false;
      try {
        autonomousBranchFor("../etc");
      } catch {
        branchThrew = true;
      }
      item.check("and cannot be turned into a branch", true, branchThrew);
      item.check("containment is artifacts/evolution/history/<run-id>/", `${EVOLUTION_ARTIFACTS_ROOT}/history/run-42/`, containmentPath("run-42"));
      item.check("the run namespace is unique per run", "evolution-run-42", namespaceFor("run-42"));
      item.check("a new run gets a new namespace", false, namespaceFor("run-43") === namespaceFor("run-42"));

      const baselineCommit = "a".repeat(40);
      const baselineTree = "b".repeat(40);
      const clean = rollbackPlan({
        baselineCommit,
        baselineTree,
        branch: "boss/evolution/run-42",
        worktreeStatus: "",
        observedCommit: "c".repeat(40),
        observedTree: "d".repeat(40)
      });
      item.check("a clean failure can be rolled back", true, clean.ok);
      item.check("to the recorded baseline commit", baselineCommit, clean.plan.steps.find((step) => step.startsWith("git reset --hard"))?.split(" ").pop());
      item.check("and re-verifies HEAD and TREE", true, clean.plan.steps.some((step) => step.includes("HEAD^{tree}") && step.includes(baselineTree)));
      const dirty = rollbackPlan({
        baselineCommit,
        baselineTree,
        branch: "boss/evolution/run-42",
        worktreeStatus: " M src/app/main.ts",
        observedCommit: "c".repeat(40),
        observedTree: "d".repeat(40)
      });
      item.check("a dirty worktree is refused", EVOLUTION_TRUST_CODES.ROLLBACK_WORKTREE_DIRTY, codesOf(dirty.problems)[0]);
      item.check("and the plan contains it first", true, dirty.plan.steps[0].includes(`${EVOLUTION_ARTIFACTS_ROOT}/history/`));
      const missing = rollbackPlan({ baselineCommit: "", baselineTree: "", branch: "", worktreeStatus: "", observedCommit: "c".repeat(40), observedTree: "d".repeat(40) });
      item.check("a missing baseline cannot be rolled back to", EVOLUTION_TRUST_CODES.ROLLBACK_BASELINE_MISSING, codesOf(missing.problems)[0]);
      item.check("nothing to restore is a refusal", false, missing.ok);
      const atBaseline = rollbackPlan({
        baselineCommit,
        baselineTree,
        branch: "boss/evolution/run-42",
        worktreeStatus: "",
        observedCommit: baselineCommit,
        observedTree: baselineTree
      });
      item.check("an untouched run is already at its baseline", true, atBaseline.plan.already_at_baseline);
      item.cite("advanceRunState");
    });
  });

  it("TE-11 a changed candidate commit or tree is refused", async () => {
    await run.scenario("TE-11", "§30 immutable candidate", (item) => {
      const repo = gitRepo("boss-te-immutable-");
      const frozenCommit = revParse(repo.root, "HEAD");
      const frozenTree = revParse(repo.root, "HEAD^{tree}");
      item.check("the frozen candidate verifies", 0, assertCandidateImmutable({ candidateCommit: frozenCommit, candidateTree: frozenTree, observedCommit: frozenCommit, observedTree: frozenTree }).length);

      write(repo.root, "src/app/main.ts", "export const main = 1;\n");
      const movedCommit = commit(repo.root, "candidate moved");
      const movedTree = revParse(repo.root, "HEAD^{tree}");
      item.check("the candidate really moved", false, movedCommit === frozenCommit);
      const moved = assertCandidateImmutable({ candidateCommit: frozenCommit, candidateTree: frozenTree, observedCommit: movedCommit, observedTree: movedTree });
      item.check("a rewritten commit is CANDIDATE_COMMIT_CHANGED", EVOLUTION_TRUST_CODES.CANDIDATE_COMMIT_CHANGED, codesOf(moved)[0]);
      item.check("and its rewritten tree is CANDIDATE_TREE_CHANGED", EVOLUTION_TRUST_CODES.CANDIDATE_TREE_CHANGED, codesOf(moved)[1]);
      item.check(
        "a tree that moved under the same commit is refused",
        JSON.stringify([EVOLUTION_TRUST_CODES.CANDIDATE_TREE_CHANGED]),
        JSON.stringify(codesOf(assertCandidateImmutable({ candidateCommit: movedCommit, candidateTree: frozenTree, observedCommit: movedCommit, observedTree: movedTree })))
      );
      item.check(
        "a missing candidate identity is refused",
        JSON.stringify([EVOLUTION_TRUST_CODES.CANDIDATE_COMMIT_CHANGED, EVOLUTION_TRUST_CODES.CANDIDATE_TREE_CHANGED]),
        JSON.stringify(codesOf(assertCandidateImmutable({ candidateCommit: "", candidateTree: "", observedCommit: movedCommit, observedTree: movedTree })))
      );
      item.cite("assertCandidateImmutable");
    });
  });

  it("TE-12 push, budget, scope, baseline and replay policy all fail closed", async () => {
    await run.scenario("TE-12", "§31/§49/§50/§77/§79 policy enforcement", (item) => {
      const noPolicy = { mainBranch: "main", policyAllows: false };
      const withPolicy = { mainBranch: "main", policyAllows: true };
      item.check("--force is denied", EVOLUTION_TRUST_CODES.FORCE_PUSH_DENIED, forcePushDecision(["git", "push", "--force", "origin", "feature"], noPolicy).code);
      item.check("--force-with-lease is denied", EVOLUTION_TRUST_CODES.FORCE_PUSH_DENIED, forcePushDecision(["git", "push", "--force-with-lease", "origin", "feature"], noPolicy).code);
      item.check(
        "--force-with-lease=<ref> is denied",
        EVOLUTION_TRUST_CODES.FORCE_PUSH_DENIED,
        forcePushDecision(["git", "push", "--force-with-lease=refs/heads/feature", "origin", "feature"], noPolicy).code
      );
      item.check("-f is denied", EVOLUTION_TRUST_CODES.FORCE_PUSH_DENIED, forcePushDecision(["git", "push", "-f", "origin", "feature"], noPolicy).code);
      item.check(
        "a +refs refspec is denied",
        EVOLUTION_TRUST_CODES.FORCE_PUSH_DENIED,
        forcePushDecision(["git", "push", "origin", "+refs/heads/feature:refs/heads/feature"], noPolicy).code
      );
      item.check("an explicit root policy can allow a feature branch", "OK", forcePushDecision(["git", "push", "--force", "origin", "feature"], withPolicy).code);
      item.check("main is denied even with a policy", EVOLUTION_TRUST_CODES.MAIN_FORCE_PUSH_DENIED, forcePushDecision(["git", "push", "--force", "origin", "main"], withPolicy).code);
      item.check("so is master", EVOLUTION_TRUST_CODES.MAIN_FORCE_PUSH_DENIED, forcePushDecision(["git", "push", "-f", "origin", "master"], withPolicy).code);
      item.check(
        "and a forced main refspec",
        EVOLUTION_TRUST_CODES.MAIN_FORCE_PUSH_DENIED,
        forcePushDecision(["git", "push", "+refs/heads/main:refs/heads/main"], withPolicy).code
      );
      item.check("an unnamed destination is denied", EVOLUTION_TRUST_CODES.FORCE_PUSH_DENIED, forcePushDecision(["git", "push", "--force", "origin"], withPolicy).code);
      item.check("an ordinary push is not a force push", "OK", forcePushDecision(["git", "push", "origin", "feature"], noPolicy).code);
      item.check("main and master are always protected names", "main,master", NEVER_FORCE_PUSHED_BRANCHES.join(","));

      const overBudget = assessBudget({
        usage: { changed_files: 26, changed_loc: 700, iterations: 1, repair_attempts: 0, test_retries: 0, wall_clock_ms: 1000 }
      });
      item.check("a 26-file/700-LOC run exceeds the run budget", true, overBudget.exceeded);
      item.check("with RUN_BUDGET_EXCEEDED", EVOLUTION_TRUST_CODES.RUN_BUDGET_EXCEEDED, overBudget.code);
      item.check("naming the file and LOC limits", "max_changed_files,max_changed_loc", overBudget.breaches.map((breach) => breach.limit).join(","));
      item.check("the file limit is 25", 25, overBudget.breaches[0]?.allowed);
      item.check("and 26 were used", 26, overBudget.breaches[0]?.used);
      item.check("the LOC limit is 600", 600, overBudget.breaches[1]?.allowed);
      const atBudget = assessBudget({
        usage: { changed_files: 25, changed_loc: 600, iterations: 4, repair_attempts: 2, test_retries: 2, wall_clock_ms: DEFAULT_EVOLUTION_BUDGET.max_wall_clock_ms }
      });
      item.check("a run exactly at every limit is inside it", false, atBudget.exceeded);
      item.check("with OK", "OK", atBudget.code);
      item.check("one exceeded limit is enough", EVOLUTION_TRUST_CODES.RUN_BUDGET_EXCEEDED, assessBudget({ usage: { iterations: 5 } }).code);
      item.check("an unmeasurable usage is a breach", EVOLUTION_TRUST_CODES.RUN_BUDGET_EXCEEDED, assessBudget({ usage: { changed_loc: Number.NaN } }).code);

      const declared: EvolutionScope = {
        allowed_files: ["src/app/**", "src/shared/**", "docs/**"],
        expected_files: ["src/app/main.ts", "docs/**"],
        forbidden_files: ["src/shared/hash.ts"]
      };
      const scope = assessScope({
        declared,
        changed: ["src/app/main.ts", "docs/notes.md", "src/shared/hash.ts", "src/shared/acceptance-contracts.ts", "src/lib/util.ts", "src/app/unplanned.ts"]
      });
      const kindOf = (file: string): string | undefined => scope.violations.find((violation) => violation.path === file)?.kind;
      item.check("the diff violates the declared scope", "SCOPE_VIOLATION", scope.verdict);
      item.check("a root trust file is never allowed", JSON.stringify(["src/shared/acceptance-contracts.ts"]), JSON.stringify(scope.never_allowed));
      item.check("even though the plan listed src/shared/** as allowed", "FORBIDDEN", kindOf("src/shared/acceptance-contracts.ts"));
      item.check("an explicitly forbidden file is FORBIDDEN", "FORBIDDEN", kindOf("src/shared/hash.ts"));
      item.check("an unlisted file is NOT_ALLOWED", "NOT_ALLOWED", kindOf("src/lib/util.ts"));
      item.check("an allowed but unplanned file is UNEXPECTED", "UNEXPECTED", kindOf("src/app/unplanned.ts"));
      item.check("allowed and expected files are not violations", false, scope.violations.some((violation) => violation.path === "src/app/main.ts"));
      item.check("a diff that matches the plan is SCOPE_OK", "SCOPE_OK", assessScope({ declared, changed: ["src/app/main.ts", "docs/notes.md"] }).verdict);
      item.check("an escaping path can never be allowed", "FORBIDDEN", assessScope({ declared, changed: ["../outside/secret.txt"] }).violations[0]?.kind);

      const current = "a".repeat(40);
      item.check("the certificate's baseline is current", "BASELINE_CURRENT", assessBaseline({ certificateBaselineCommit: current, currentMainCommit: current }).verdict);
      item.check("with OK", "OK", assessBaseline({ certificateBaselineCommit: current, currentMainCommit: current }).code);
      item.check("a moved main is a stale baseline", "STALE_BASELINE", assessBaseline({ certificateBaselineCommit: current, currentMainCommit: "b".repeat(40) }).verdict);
      item.check("and says so", EVOLUTION_TRUST_CODES.STALE_BASELINE, assessBaseline({ certificateBaselineCommit: current, currentMainCommit: "b".repeat(40) }).code);
      item.check("a missing current main is stale too", "STALE_BASELINE", assessBaseline({ certificateBaselineCommit: current, currentMainCommit: "" }).verdict);

      const certificate: ReplayBinding = {
        session_id: "session-a",
        commit: "a".repeat(40),
        tree: "b".repeat(40),
        build_hash: "c".repeat(64),
        run_id: "run-1"
      };
      const other: ReplayBinding = { ...certificate, session_id: "session-b", run_id: "run-2" };
      const replay = replayAttackVerdict({ certificate, current: other });
      item.check("replayed evidence is detected", true, replay.replayed);
      item.check("on the session and the run id", "session_id,run_id", replay.mismatches.join(","));
      item.check("the five §77 bindings are compared", "session_id,commit,tree,build_hash,run_id", REPLAY_BINDING_FIELDS.join(","));
      item.check("identical evidence is not a replay", false, replayAttackVerdict({ certificate, current: certificate }).replayed);
      item.check("a missing certificate is a replay", true, replayAttackVerdict({ certificate: undefined, current: certificate }).replayed);
      item.check(
        "an empty binding cannot match",
        "build_hash",
        replayAttackVerdict({ certificate: { ...certificate, build_hash: "" }, current: certificate }).mismatches.join(",")
      );
      item.check(
        "every changed binding is named",
        5,
        replayAttackVerdict({ certificate, current: { session_id: "s", commit: "c", tree: "t", build_hash: "b", run_id: "r" } }).mismatches.length
      );
      item.cite("forcePushDecision / assessBudget / assessScope / assessBaseline / replayAttackVerdict");
    });
  });
});

afterAll(() => {
  const report = run.write(REPORT_DIR, "evolution-trust.json", {
    checkpoint: "PHASE_C",
    gate: "acceptance-evolution-trust",
    plan: "Update-Plan/self-evlo.md"
  });
  cleanupFixtures();
  run.assertAllPass();
  expect((report.totals as { fail: number }).fail).toEqual(0);
});
