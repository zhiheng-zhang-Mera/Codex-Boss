/**
 * Update-Plan/self-evlo.md §5–§13 + §37 (EV-01..EV-16) — Phase B, artifact/build
 * binding: the identity a certificate must bind before the whole "SOURCE + BUILD +
 * RUNTIME" claim (§7) can be made.
 *
 * Every scenario runs against real files in real temporary trees — the freeze and
 * the inventory are produced by hashing bytes that exist, the build manifest is
 * produced by walking a real `dist/`+`dist-electron/` pair, and nothing here mocks
 * a filesystem. The two places that read the repository itself (`process.cwd()`)
 * assert structure only, because other suites are being written while this one runs.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AcceptanceRun, acceptanceArtifacts } from "../helpers/acceptance-report";
import { cleanupFixtures, gitRepo, revParse, tempDir, write } from "../helpers/root-fixtures";
import {
  ACCEPTANCE_CONTRACT_VERSION,
  ACCEPTANCE_GATE_CONTRACTS,
  CAPABILITY_GATES,
  DESKTOP_BLACK_BOX_CONTRACT
} from "../../src/shared/acceptance-contracts";
import {
  DESKTOP_BLACK_BOX_CONTRACT_HASH,
  DESKTOP_BLACK_BOX_CONTRACT_VERSION
} from "../../src/shared/desktop-black-box-contract";
import {
  EVOLUTION_IDENTITY_CODES,
  REPRODUCIBILITY_FIELDS,
  buildManifestAggregate,
  aggregateIdentityHash,
  compareRequiredIdSurface as compareRequiredIdSurfacePure,
  identityVerdict,
  reproducibilityDigest,
  reproducibilityEqual,
  testManifestFrom,
  type ReproducibilityInput
} from "../../src/shared/autonomous-evolution-identity";
import * as identity from "../../electron/engineering/autonomous-evolution-identity";

const run = new AcceptanceRun("AUTONOMOUS_EVOLUTION_IDENTITY");
const REPORT_DIR = acceptanceArtifacts();
const CODES = EVOLUTION_IDENTITY_CODES;

/** The files a §9 fixture really writes; the excluded ones must never be frozen. */
const SOURCE_FIXTURE_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
  "scripts/tool.cjs",
  "src/shared/alpha.ts",
  "electron/engineering/beta.ts",
  "tests/unit/alpha.test.ts"
];

/** Real files that are products, evidence or history — never sources (§9). */
const SOURCE_FIXTURE_PRODUCTS = [
  "node_modules/dep/index.js",
  "dist/bundle.js",
  "dist-electron/main.js",
  "artifacts/acceptance/report.json"
];

const BUILD_FIXTURE_FILES = [
  "dist/index.html",
  "dist/assets/app.js",
  "dist-electron/main.js",
  "dist-electron/preload.js"
];

function sha256Of(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function absolute(root: string, relative: string): string {
  return path.join(root, ...relative.split("/"));
}

/** A real tree with the §9 source roots plus the product directories. */
function sourceFixture(prefix: string): string {
  const root = tempDir(prefix);
  for (const relative of SOURCE_FIXTURE_FILES) write(root, relative, `// ${relative}\n`);
  for (const relative of SOURCE_FIXTURE_PRODUCTS) write(root, relative, `// ${relative}\n`);
  return root;
}

/** A real build output pair to hash (§7/§8). */
function buildFixture(prefix: string): string {
  const root = tempDir(prefix);
  for (const relative of BUILD_FIXTURE_FILES) write(root, relative, `// ${relative}\n`);
  return root;
}

function codesOf(problems: readonly { code: string }[]): string[] {
  return problems.map((problem) => problem.code).sort();
}

function hasCode(problems: readonly { code: string }[], code: string): boolean {
  return problems.some((problem) => problem.code === code);
}

function hasDetail(problems: readonly { code: string; detail?: string }[], code: string, prefix: string): boolean {
  return problems.some((problem) => problem.code === code && String(problem.detail ?? "").split(":").indexOf(prefix) >= 0);
}

function structured(problems: readonly { code: string; detail?: string }[]): boolean {
  return problems.every(
    (problem) =>
      typeof problem.code === "string" &&
      (problem.detail === undefined || typeof problem.detail === "string") &&
      Object.keys(problem).every((key) => key === "code" || key === "detail")
  );
}

function readPackageJson(root: string): Record<string, Record<string, string>> {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, Record<string, string>>;
}

/** Counts `*.test.ts` files with the test's own walk, never the module under test. */
function countTestFiles(directory: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) total += countTestFiles(child);
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) total += 1;
  }
  return total;
}

describe("self-evlo §5–§13/§37 Phase B evolution identity", () => {
  it("EV-01 the source freeze hashes a real tree and is stable", async () => {
    await run.scenario("EV-01", "§9 source snapshot", (item) => {
      const root = sourceFixture("boss-ev-freeze-");
      const first = identity.computeSourceFreeze({ root });
      const second = identity.computeSourceFreeze({ root });

      item.check("every source root file is frozen", SOURCE_FIXTURE_FILES.length, first.file_count);
      item.check("the file list is path-sorted", JSON.stringify(first.files.map((entry) => entry.path)), JSON.stringify([...SOURCE_FIXTURE_FILES].sort()));
      item.check("each hash is the file's real SHA-256", true, first.files.every((entry) => entry.sha256 === sha256Of(absolute(root, entry.path))));
      item.check("the aggregate is stable across two runs", first.aggregate_hash, second.aggregate_hash);
      item.check("the aggregate is the hash of the frozen list", first.aggregate_hash, aggregateIdentityHash(first.files));
      item.check("a hand-computed freeze verifies", 0, identity.verifySourceFreeze(first, root).length);
      item.check("the freeze records when it was computed", true, first.computed_at.length > 0);
      // §9: products, evidence and history are not identity sources.
      item.check("no excluded directory is frozen", JSON.stringify(first.files.map((entry) => entry.path.split("/")[0]).filter((segment) => ["node_modules", "dist", "dist-electron", "artifacts", ".git"].indexOf(segment) >= 0)), "[]");
      item.check("paths are repository-relative POSIX paths", JSON.stringify(first.files.filter((entry) => entry.path.indexOf("\\") >= 0).length), "0");
      item.cite("computeSourceFreeze");
    });
  });

  it("EV-02 a single-byte change is detected by the freeze", async () => {
    await run.scenario("EV-02", "§9 graduation re-scan", (item) => {
      const root = sourceFixture("boss-ev-freeze-change-");
      const freeze = identity.computeSourceFreeze({ root });
      const clean = identity.verifySourceFreeze(freeze, root);
      item.check("the untouched freeze verifies", 0, clean.length);

      write(root, "src/shared/alpha.ts", "// src/shared/alpha.ts!\n");
      const changed = identity.verifySourceFreeze(freeze, root);
      const second = identity.computeSourceFreeze({ root });
      item.check("the aggregate moved", true, second.aggregate_hash !== freeze.aggregate_hash);
      item.check("the changed file is named", true, hasCode(changed, CODES.SOURCE_FREEZE_FILE_CHANGED));
      item.check("and the detail carries the path and both hashes", true, hasDetail(changed, CODES.SOURCE_FREEZE_FILE_CHANGED, "src/shared/alpha.ts"));
      item.check("the aggregate mismatch is named too", true, hasCode(changed, CODES.SOURCE_FREEZE_AGGREGATE_MISMATCH));
      item.check("the full problem list is structured", true, structured(changed));

      fs.rmSync(absolute(root, "scripts/tool.cjs"));
      item.check("a deleted source is named", true, hasCode(identity.verifySourceFreeze(freeze, root), CODES.SOURCE_FREEZE_FILE_MISSING));
      write(root, "scripts/tool.cjs", "// scripts/tool.cjs\n");
      write(root, "src/shared/gamma.ts", "// new source\n");
      item.check("a new source is named", true, hasCode(identity.verifySourceFreeze(freeze, root), CODES.SOURCE_FREEZE_FILE_ADDED));
      item.cite("verifySourceFreeze");
    });
  });

  it("EV-03 the dependency identity reads the real lockfile and toolchain", async () => {
    await run.scenario("EV-03", "§10 dependency lock", (item) => {
      const root = process.cwd();
      const dependency = identity.computeDependencyIdentity({ root });
      const packageJson = readPackageJson(root);

      item.check("the lockfile hash is the real SHA-256", sha256Of(path.join(root, "pnpm-lock.yaml")), dependency.lockfile_sha256);
      item.check("node is the running runtime", process.versions.node, dependency.node);
      item.check("electron is the declared dependency", packageJson.dependencies.electron, dependency.electron);
      item.check("pnpm comes from packageManager", String(packageJson.packageManager).split("@")[1], dependency.pnpm);
      item.check("the platform is the real one", process.platform, dependency.platform);
      item.check("the architecture is the real one", process.arch, dependency.arch);
      item.check("the real identity has no problems", 0, identity.verifyDependencyIdentity(dependency).length);

      const bare = identity.computeDependencyIdentity({ root: tempDir("boss-ev-nolock-") });
      item.check("a missing lockfile stays empty, never invented", "", bare.lockfile_sha256);
      item.check("and it is refused structurally", true, hasCode(identity.verifyDependencyIdentity(bare), CODES.DEPENDENCY_LOCKFILE_MISSING));
      item.cite("computeDependencyIdentity");
    });
  });

  it("EV-04 the build manifest walks the real dist trees", async () => {
    await run.scenario("EV-04", "§7 build artifact identity", (item) => {
      const root = buildFixture("boss-ev-build-");
      const commit = "1".repeat(40);
      const tree = "2".repeat(40);
      const first = identity.computeBuildManifest({ root, sourceCommit: commit, sourceTree: tree });
      const second = identity.computeBuildManifest({ root, sourceCommit: commit, sourceTree: tree });

      item.check("every built file is recorded", BUILD_FIXTURE_FILES.length, first.files.length);
      item.check("the real build directories were walked", JSON.stringify([...new Set(first.files.map((entry) => entry.path.split("/")[0]))].sort()), JSON.stringify(["dist", "dist-electron"]));
      item.check("each hash is the artifact's real SHA-256", true, first.files.every((entry) => entry.sha256 === sha256Of(absolute(root, entry.path))));
      item.check("the per-file map covers the same files", JSON.stringify(Object.keys(first.per_file_sha256).sort()), JSON.stringify(first.files.map((entry) => entry.path).sort()));
      item.check("the map values are the recorded hashes", JSON.stringify(first.per_file_sha256), JSON.stringify(Object.fromEntries(first.files.map((entry) => [entry.path, entry.sha256]))));
      item.check("the aggregate is stable across two builds", first.aggregate_build_hash, second.aggregate_build_hash);
      item.check("the aggregate is the recorded identity", first.aggregate_build_hash, buildManifestAggregate(first));
      item.check("the aggregate ignores the build timestamp", true, first.aggregate_build_hash === second.aggregate_build_hash && first.built_at.length > 0);
      item.check("the runtime is recorded", process.versions.node, first.node_version);
      item.check("the untouched build verifies", 0, identity.verifyBuildManifest(first, { root, sourceCommit: commit, sourceTree: tree }).length);
      item.cite("computeBuildManifest");
    });
  });

  it("EV-05 a build that does not match the manifest is refused", async () => {
    await run.scenario("EV-05", "§8 source-to-binary binding", (item) => {
      const root = buildFixture("boss-ev-build-mismatch-");
      const commit = "3".repeat(40);
      const tree = "4".repeat(40);
      const manifest = identity.computeBuildManifest({ root, sourceCommit: commit, sourceTree: tree });
      item.check("the untouched build passes", 0, identity.verifyBuildManifest(manifest, { root, sourceCommit: commit, sourceTree: tree }).length);

      fs.rmSync(absolute(root, "dist/assets/app.js"));
      const deleted = identity.verifyBuildManifest(manifest, { root, sourceCommit: commit, sourceTree: tree });
      item.check("a deleted artifact is refused", true, hasCode(deleted, CODES.BUILD_FILE_MISSING));
      item.check("and the missing path is named", true, hasDetail(deleted, CODES.BUILD_FILE_MISSING, "dist/assets/app.js"));

      write(root, "dist/assets/app.js", "// a different bundle\n");
      const changed = identity.verifyBuildManifest(manifest, { root, sourceCommit: commit, sourceTree: tree });
      item.check("a changed artifact is refused", true, hasCode(changed, CODES.BUILD_MANIFEST_HASH_MISMATCH));
      item.check("and the changed path is named", true, hasDetail(changed, CODES.BUILD_MANIFEST_HASH_MISMATCH, "dist/assets/app.js"));

      write(root, "dist/assets/app.js", "// dist/assets/app.js\n");
      write(root, "dist/stale-old-bundle.js", "// left over from a previous build\n");
      item.check("an artifact the manifest never saw is refused", true, hasCode(identity.verifyBuildManifest(manifest, { root, sourceCommit: commit, sourceTree: tree }), CODES.BUILD_FILE_ADDED));

      item.check("a different commit is refused", true, hasCode(identity.verifyBuildManifest(manifest, { root, sourceCommit: "9".repeat(40), sourceTree: tree }), CODES.BUILD_SOURCE_COMMIT_MISMATCH));
      item.check("a different tree is refused", true, hasCode(identity.verifyBuildManifest(manifest, { root, sourceCommit: commit, sourceTree: "9".repeat(40) }), CODES.BUILD_SOURCE_TREE_MISMATCH));
      item.check("old dist + new source cannot pass", true, hasCode(identity.verifyBuildManifest(manifest, { root, sourceCommit: "9".repeat(40), sourceTree: "9".repeat(40) }), CODES.BUILD_SOURCE_COMMIT_MISMATCH));
      item.check("every refusal is structured", true, structured(identity.verifyBuildManifest(manifest, { root, sourceCommit: "9".repeat(40), sourceTree: "9".repeat(40) })));
      item.cite("verifyBuildManifest");
    });
  });

  it("EV-06 the manifest binds the commit and the tree verbatim", async () => {
    await run.scenario("EV-06", "§6/§8 tree identity", (item) => {
      const explicitRoot = buildFixture("boss-ev-bind-explicit-");
      const commit = "a".repeat(40);
      const tree = "b".repeat(40);
      const explicit = identity.computeBuildManifest({ root: explicitRoot, sourceCommit: commit, sourceTree: tree });
      item.check("the commit is recorded verbatim", commit, explicit.source_commit);
      item.check("the tree is recorded verbatim", tree, explicit.source_tree);

      const repo = gitRepo("boss-ev-bind-git-");
      write(repo.root, "dist/main.js", "// built after the commit\n");
      const fromGit = identity.computeBuildManifest({ root: repo.root });
      item.check("the commit is read from the real repository", repo.sha, fromGit.source_commit);
      item.check("the tree is read from the real repository", revParse(repo.root, "HEAD^{tree}"), fromGit.source_tree);
      item.check("the build hash covers the source identity", true, buildManifestAggregate(fromGit) !== buildManifestAggregate({ ...fromGit, source_tree: "c".repeat(40) }));
      item.cite("readGitIdentity");
    });
  });

  it("EV-07 the contract snapshot hash is stable and change-sensitive", async () => {
    await run.scenario("EV-07", "§11 immutable contract snapshot", (item) => {
      // A controlled root, so the stability comparison cannot race another suite
      // that is writing into the real `trust-policy/` while this runs.
      const root = tempDir("boss-ev-snapshot-");
      write(root, "trust-policy/amendment.json", "{ \"amendment\": 1 }\n");
      const snapshot = identity.computeContractSnapshot({ root });
      const again = identity.computeContractSnapshot({ root });

      item.check("the snapshot hash is stable", snapshot.contract_snapshot_hash, again.contract_snapshot_hash);
      item.check("it is a SHA-256", true, /^[0-9a-f]{64}$/.test(snapshot.contract_snapshot_hash));
      item.check("the trust policy file is hashed into the snapshot", 1, snapshot.trust_policy.length);
      item.check("and its hash is the real file hash", sha256Of(absolute(root, "trust-policy/amendment.json")), snapshot.trust_policy[0]?.sha256 ?? "");

      const withoutPolicy = identity.computeContractSnapshot({ root: tempDir("boss-ev-nopolicy-") });
      item.check("an absent trust policy is recorded as absent", JSON.stringify(withoutPolicy.trust_policy), "[]");
      item.check("and it changes the snapshot hash", true, withoutPolicy.contract_snapshot_hash !== snapshot.contract_snapshot_hash);

      const extended = ACCEPTANCE_GATE_CONTRACTS.map((contract, index) =>
        index === 0 ? { ...contract, required_ids: [...contract.required_ids, "WB-11"] } : contract
      );
      const addedId = identity.computeContractSnapshot({ root, contracts: extended });
      item.check("a new required id changes the snapshot hash", true, addedId.contract_snapshot_hash !== snapshot.contract_snapshot_hash);

      const reversioned = ACCEPTANCE_GATE_CONTRACTS.map((contract, index) =>
        index === 0 ? { ...contract, contract_version: "workbook-acceptance-2" } : contract
      );
      item.check("a changed contract version changes the snapshot hash", true, identity.computeContractSnapshot({ root, contracts: reversioned }).contract_snapshot_hash !== snapshot.contract_snapshot_hash);

      const dropped = ACCEPTANCE_GATE_CONTRACTS.slice(1);
      item.check("dropping a contract changes the snapshot hash", true, identity.computeContractSnapshot({ root, contracts: dropped }).contract_snapshot_hash !== snapshot.contract_snapshot_hash);
      item.cite("computeContractSnapshot");
    });
  });

  it("EV-08 the snapshot carries the real desktop digest and counts", async () => {
    await run.scenario("EV-08", "§11 contract identity", (item) => {
      const snapshot = identity.computeContractSnapshot({ root: process.cwd() });
      item.check("the desktop contract digest is carried", DESKTOP_BLACK_BOX_CONTRACT_HASH, snapshot.desktop_contract_hash);
      item.check("the desktop contract version is carried", DESKTOP_BLACK_BOX_CONTRACT_VERSION, snapshot.desktop_contract_version);
      item.check("the acceptance contract version is carried", ACCEPTANCE_CONTRACT_VERSION, snapshot.acceptance_contract_version);
      item.check("the delivery gates number sixteen", 16, snapshot.gate_count);
      item.check("and match the declared contracts", ACCEPTANCE_GATE_CONTRACTS.length, snapshot.gate_count);
      item.check("the capabilities number thirteen", 13, snapshot.capability_count);
      item.check("and match the capability mapping", Object.keys(CAPABILITY_GATES).length, snapshot.capability_count);
      item.check("the snapshot takes the desktop contract as data", true, identity.computeContractSnapshot({ root: process.cwd(), desktopContract: { ...DESKTOP_BLACK_BOX_CONTRACT, contract_version: "desktop-blackbox-2" } }).desktop_contract_version === "desktop-blackbox-2");
      item.cite("desktop_contract_hash");
    });
  });

  it("EV-09 the test inventory scans the real tests tree", async () => {
    await run.scenario("EV-09", "§12 test inventory lock", (item) => {
      const root = process.cwd();
      const manifest = identity.computeTestManifest({ root });

      item.check("more than a hundred test files", true, manifest.file_count > 100);
      item.check("more than a thousand cases", true, manifest.case_count > 1000);
      item.check("the acceptance category is present", true, manifest.categories.acceptance > 0);
      item.check("the unit category is present", true, manifest.categories.unit > 0);
      item.check("the categories partition the files", manifest.file_count, manifest.categories.acceptance + manifest.categories.unit + manifest.categories.other);
      item.check("every file's case count is its case list", true, manifest.files.every((file) => file.case_count === file.cases.length));
      item.check("the total is the sum of the files", manifest.case_count, manifest.files.reduce((total, file) => total + file.case_count, 0));
      item.check("only real test files are inventoried", true, manifest.files.every((file) => file.path.endsWith(".test.ts")));
      item.check("every hash is a SHA-256 digest", true, manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)));
      item.check("every inventoried file exists", true, manifest.files.every((file) => fs.existsSync(absolute(root, file.path))));
      // An independent walk by the test itself. Sibling suites may still be adding
      // files, so the honest claim is one-sided: the tree holds *at least* this many.
      item.check("an independent walk finds at least this many test files", true, countTestFiles(path.join(root, "tests")) >= manifest.file_count);

      const evidence = manifest.files.find((file) => file.path === "tests/acceptance/evidence-integrity.test.ts");
      item.check("a known suite is inventoried", true, evidence !== undefined);
      item.check("its declared scenario ids are captured", true, (evidence?.cases ?? []).some((entry) => entry.id === "EI-01"));
      item.check("its describe blocks are captured", true, (evidence?.describe ?? []).length > 0);
      // Classified by a second, independent implementation (§12 categories).
      item.check("and it is categorised as acceptance", "acceptance", evidence === undefined ? "" : identityPathCategory(evidence.path));
      item.cite("computeTestManifest");
    });
  });

  it("EV-10 the manifest hash is reproducible and covers file hashes", async () => {
    await run.scenario("EV-10", "§12 inventory lock hash", (item) => {
      // Two full scans of a real tree. A controlled root is used because the
      // repository's own `tests/` is being written by sibling suites while this
      // one runs, and "two scans agree" must not be a race.
      const root = tempDir("boss-ev-lock-");
      write(root, "tests/acceptance/lock.test.ts", 'describe("lock suite", () => {\n  it("L-01 locked", () => {});\n});\n');
      write(root, "tests/unit/lock-unit.test.ts", 'it("L-02 locked unit", () => {});\n');
      const first = identity.computeTestManifest({ root });
      const second = identity.computeTestManifest({ root });

      item.check("two scans agree on the manifest hash", first.manifest_hash, second.manifest_hash);
      item.check("and on every file hash", JSON.stringify(first.files.map((file) => [file.path, file.sha256])), JSON.stringify(second.files.map((file) => [file.path, file.sha256])));
      item.check("the hash follows from the recorded inventory", first.manifest_hash, testManifestFrom(first.files).manifest_hash);
      item.check("it verifies against its own tree", 0, identity.verifyTestManifest(first, root).length);

      // The real repository's inventory is scanned once, so no cross-run claim is
      // made about a tree other agents are still appending to.
      const real = identity.computeTestManifest({ root: process.cwd() });
      item.check("the real inventory reproduces its own hash", real.manifest_hash, testManifestFrom(real.files).manifest_hash);
      const forgedHash = testManifestFrom(real.files.map((file, index) => (index === 0 ? { ...file, sha256: "0".repeat(64) } : file)));
      item.check("changing one recorded file hash changes the manifest hash", true, forgedHash.manifest_hash !== real.manifest_hash);
      const forgedCases = testManifestFrom(real.files.map((file, index) => (index === 0 ? { ...file, cases: file.cases.slice(1) } : file)));
      item.check("dropping one recorded case changes the manifest hash", true, forgedCases.manifest_hash !== real.manifest_hash);
      const dropped = testManifestFrom(real.files.slice(1));
      item.check("dropping a recorded file changes the manifest hash", true, dropped.manifest_hash !== real.manifest_hash);
      item.cite("testManifestFrom");
    });
  });

  it("EV-11 a deleted test file and a decreased case count are detected", async () => {
    await run.scenario("EV-11", "§12 anti-deletion", (item) => {
      const root = tempDir("boss-ev-tests-");
      const alpha = "tests/acceptance/alpha.test.ts";
      const beta = "tests/unit/beta.test.ts";
      write(root, alpha, 'describe("alpha suite", () => {\n  it("A-01 alpha one", () => {});\n  it("A-02 alpha two", () => {});\n});\n');
      write(root, beta, 'it("B-01 beta one", () => {});\n');
      const manifest = identity.computeTestManifest({ root });

      item.check("the fixture inventory is scanned", 2, manifest.file_count);
      item.check("the fixture cases are counted", 3, manifest.case_count);
      item.check("it verifies untouched", 0, identity.verifyTestManifest(manifest, root).length);

      fs.rmSync(absolute(root, beta));
      const removed = identity.verifyTestManifest(manifest, root);
      item.check("a deleted test file is refused", true, hasCode(removed, CODES.TEST_FILE_REMOVED));
      item.check("and the deleted path is named", true, hasDetail(removed, CODES.TEST_FILE_REMOVED, beta));
      item.check("the manifest hash no longer matches", true, hasCode(removed, CODES.TEST_MANIFEST_HASH_MISMATCH));

      write(root, beta, 'it("B-01 beta one", () => {});\n');
      write(root, alpha, 'describe("alpha suite", () => {\n  it("A-01 alpha one", () => {});\n});\n');
      const decreased = identity.verifyTestManifest(manifest, root);
      item.check("a decreased case count is refused", true, hasCode(decreased, CODES.TEST_CASE_COUNT_DECREASED));
      item.check("and the modified file is named", true, hasCode(decreased, CODES.TEST_FILE_MODIFIED));
      item.check("the verdict is FAIL", "FAIL", identityVerdict(decreased));

      write(root, "tests/unit/gamma.test.ts", 'it("G-01 gamma", () => {});\n');
      const grown = identity.verifyTestManifest(manifest, root);
      item.check("a new test file is reported", true, hasCode(grown, CODES.TEST_FILE_ADDED));
      item.check("but a new file alone is informational", "PASS", identityVerdict([{ code: CODES.TEST_FILE_ADDED }]));
      item.check("every problem is structured", true, structured(grown));
      item.cite("verifyTestManifest");
    });
  });

  it("EV-12 the required-id surface is monotone", async () => {
    await run.scenario("EV-12", "§13 required test monotonicity", (item) => {
      const baseline = { "acceptance-workbook": ["WB-01", "WB-02"], "acceptance-knowledge": ["K-01"] };
      const identical = compareRequiredIdSurfacePure(baseline, { "acceptance-workbook": ["WB-01", "WB-02"], "acceptance-knowledge": ["K-01"] });
      item.check("identical counts are unchanged", "UNCHANGED", identical.verdict);
      item.check("and need no retirement record", false, identical.retirement_records_required);

      const grown = compareRequiredIdSurfacePure(baseline, { "acceptance-workbook": ["WB-01", "WB-02", "WB-03"], "acceptance-knowledge": ["K-01"] });
      item.check("growth is recorded as growth", "ACCEPTANCE_SURFACE_GROWN", grown.verdict);
      item.check("and the added id is named", JSON.stringify([{ gate: "acceptance-workbook", id: "WB-03" }]), JSON.stringify(grown.added));

      const candidate = { "acceptance-workbook": ["WB-01"], "acceptance-knowledge": ["K-01"] };
      const shrunk = compareRequiredIdSurfacePure(baseline, candidate);
      item.check("a removed id is a regression", "ACCEPTANCE_SURFACE_REGRESSION", shrunk.verdict);
      item.check("and the removed id is named", JSON.stringify([{ gate: "acceptance-workbook", id: "WB-02" }]), JSON.stringify(shrunk.removed));
      item.check("a retirement record is required", true, shrunk.retirement_records_required);

      const root = tempDir("boss-ev-retire-");
      write(root, "trust-policy/requirement-retirements.json", `${JSON.stringify({ version: 1, retirements: [{ old_id: "WB-02", reason: "superseded by WB-03", replacement: "WB-03", migration: "replay the WB-03 evidence", risk: "low" }] }, null, 2)}\n`);
      item.check("the policy file is read from the trust surface", 1, identity.readRequirementRetirements(root).length);
      const retired = identity.compareRequiredIdSurface(baseline, candidate, { root });
      item.check("a removed id with a complete record is retired", "RETIRED_WITH_RECORD", retired.verdict);
      item.check("so no further record is required", false, retired.retirement_records_required);
      item.check("and the id is listed as retired", JSON.stringify(["WB-02"]), JSON.stringify(retired.retired));

      write(root, "trust-policy/requirement-retirements.json", `${JSON.stringify({ version: 1, retirements: [{ old_id: "WB-02", reason: "no replacement named" }] }, null, 2)}\n`);
      const incomplete = identity.compareRequiredIdSurface(baseline, candidate, { root });
      item.check("an incomplete record is not a retirement", "ACCEPTANCE_SURFACE_REGRESSION", incomplete.verdict);
      item.check("and it stays unretired", JSON.stringify(["WB-02"]), JSON.stringify(incomplete.unretired));
      item.check("the declared contract surface is read from the contracts", 16, Object.keys(identity.acceptanceRequiredIdCounts()).length);
      // The repository's own trust policy is read with the same code path; an
      // unchanged surface stays UNCHANGED whatever the policy file happens to hold.
      item.check("the repository policy file is read without inventing a change", "UNCHANGED", identity.compareRequiredIdSurface(identity.acceptanceRequiredIdCounts(), identity.acceptanceRequiredIdCounts(), { root: process.cwd() }).verdict);
      item.cite("compareRequiredIdSurface");
    });
  });

  it("EV-13 identity writes are atomic and leave no residue", async () => {
    await run.scenario("EV-13", "§96 atomic certificate write", (item) => {
      const root = tempDir("boss-ev-atomic-");
      const file = path.join(root, "build-manifest.json");
      identity.writeFileAtomicSync(file, '{ "written": 1 }\n');

      item.check("the file is the only thing written", JSON.stringify(fs.readdirSync(root)), JSON.stringify(["build-manifest.json"]));
      item.check("the content is exactly what was asked", '{ "written": 1 }\n', fs.readFileSync(file, "utf8"));
      item.check("no temp residue is left behind", 0, fs.readdirSync(root).filter((name) => name.endsWith(".tmp")).length);

      identity.writeFileAtomicSync(file, '{ "written": 2 }\n');
      item.check("writing over an existing file replaces it", '{ "written": 2 }\n', fs.readFileSync(file, "utf8"));
      item.check("still exactly one file and no residue", JSON.stringify(fs.readdirSync(root)), JSON.stringify(["build-manifest.json"]));

      const buildRoot = buildFixture("boss-ev-atomic-build-");
      const manifest = identity.computeBuildManifest({ root: buildRoot, sourceCommit: "1".repeat(40), sourceTree: "2".repeat(40) });
      const written = identity.writeBuildManifest(buildRoot, manifest);
      item.check("the manifest lands in the acceptance namespace", "artifacts/acceptance/build-manifest.json", identity.relativeIdentityPath(buildRoot, written));
      item.check("and reads back identically", JSON.stringify(manifest), JSON.stringify(identity.readBuildManifest(written)));
      item.check("the artifact directory holds no temp file", 0, fs.readdirSync(path.dirname(written)).filter((name) => name.endsWith(".tmp")).length);
      item.cite("writeFileAtomicSync");
    });
  });

  it("EV-14 the reproducibility digest covers every component", async () => {
    await run.scenario("EV-14", "§37 reproducibility digest", (item) => {
      const root = tempDir("boss-ev-repro-");
      write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
      write(root, "package.json", `${JSON.stringify({ packageManager: "pnpm@11.19.0", dependencies: { electron: "44.0.0" } })}\n`);
      write(root, "tests/unit/repro.test.ts", 'it("R-01 reproducible", () => {});\n');
      const options = { root, commit: "1".repeat(40), tree: "2".repeat(40) };
      const first = identity.readReproducibilityDigest(options);
      const second = identity.readReproducibilityDigest(options);

      item.check("the digest is stable for identical inputs", first.reproducibility_hash, second.reproducibility_hash);
      item.check("and every component agrees", JSON.stringify(first), JSON.stringify(second));
      item.check("it is a SHA-256", true, /^[0-9a-f]{64}$/.test(first.reproducibility_hash));
      item.check("identical digests compare equal", true, reproducibilityEqual(first, second));
      item.check("the lockfile component is the real lockfile hash", sha256Of(path.join(root, "pnpm-lock.yaml")), first.lockfile);
      item.check("the test manifest component is the real inventory hash", identity.computeTestManifest({ root }).manifest_hash, first.test_manifest_hash);
      item.check("a missing build manifest is empty, never invented", "", first.build_manifest_hash);

      write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n# a different lockfile\n");
      const lockChanged = identity.readReproducibilityDigest(options);
      item.check("a changed lockfile changes the digest", true, lockChanged.reproducibility_hash !== first.reproducibility_hash);
      item.check("unequal digests compare unequal", false, reproducibilityEqual(first, lockChanged));

      const commitChanged = identity.readReproducibilityDigest({ ...options, commit: "3".repeat(40) });
      item.check("a changed commit changes the digest", true, commitChanged.reproducibility_hash !== first.reproducibility_hash);

      const base: ReproducibilityInput = {
        commit: first.commit,
        tree: first.tree,
        lockfile: first.lockfile,
        contract_snapshot_hash: first.contract_snapshot_hash,
        test_manifest_hash: first.test_manifest_hash,
        build_manifest_hash: "d".repeat(64),
        capability_registry_hash: "e".repeat(64)
      };
      const baseline = reproducibilityDigest(base);
      item.check("the component list is the seven §37 fields", 7, REPRODUCIBILITY_FIELDS.length);
      item.check("every component changes the digest", true, REPRODUCIBILITY_FIELDS.every((field) => reproducibilityDigest({ ...base, [field]: "f".repeat(64) }).reproducibility_hash !== baseline.reproducibility_hash));
      item.cite("readReproducibilityDigest");
    });
  });

  it("EV-15 the real repository identity is computable end to end", async () => {
    await run.scenario("EV-15", "§7/§37 real working tree", (item) => {
      const root = process.cwd();
      const freeze = identity.computeSourceFreeze({ root });
      const prefixes = ["src/", "electron/", "scripts/", "tests/"];
      item.check("the freeze covers the source prefixes", JSON.stringify(prefixes.filter((prefix) => !freeze.files.some((entry) => entry.path.startsWith(prefix)))), "[]");
      item.check("it covers package.json", true, freeze.files.some((entry) => entry.path === "package.json"));
      item.check("it covers the workflow directory", true, freeze.files.some((entry) => entry.path.startsWith(".github/")));
      item.check("it is a real tree, not a handful of files", true, freeze.file_count > 100);
      item.check("its own aggregate follows from its files", freeze.aggregate_hash, aggregateIdentityHash(freeze.files));
      // The re-verification must not assume the tree is frozen while other suites
      // are being written; it asserts the shape of the answer, not emptiness.
      item.check("re-verification answers with structured problems", true, structured(identity.verifySourceFreeze(freeze, root)));

      const dependency = identity.computeDependencyIdentity({ root });
      item.check("the dependency identity is complete", true, dependency.lockfile_sha256.length === 64 && dependency.node.length > 0 && dependency.pnpm.length > 0 && dependency.electron.length > 0);
      item.check("the contract snapshot hashes", true, /^[0-9a-f]{64}$/.test(identity.computeContractSnapshot({ root }).contract_snapshot_hash));
      item.check("the test inventory hashes", true, /^[0-9a-f]{64}$/.test(identity.computeTestManifest({ root }).manifest_hash));

      const build = identity.computeBuildManifest({ root });
      item.check("the real build tree is inventoried", true, build.files.length > 0);
      item.check("the build is bound to the real HEAD", true, identity.readGitIdentity(root).commit === build.source_commit && build.source_commit.length === 40);
      item.check("verifying the real build answers structurally", true, structured(identity.verifyBuildManifest(build, { root, sourceCommit: build.source_commit, sourceTree: build.source_tree })));

      const digest = identity.readReproducibilityDigest({ root });
      item.check("the end-to-end digest carries the seven components", true, digest.commit.length === 40 && digest.tree.length === 40 && digest.lockfile.length === 64 && digest.contract_snapshot_hash.length === 64 && digest.test_manifest_hash.length === 64 && digest.reproducibility_hash.length === 64);
      item.check("the digest follows from its components", digest.reproducibility_hash, reproducibilityDigest(digest).reproducibility_hash);
      item.cite("readReproducibilityDigest");
    });
  });

  it("EV-16 verification speaks structured problems only", async () => {
    await run.scenario("EV-16", "§44 structured errors only", (item) => {
      const modules = [
        "src/shared/autonomous-evolution-identity.ts",
        "electron/engineering/autonomous-evolution-identity.ts"
      ];
      const sources = modules.map((relative) => ({ file: relative, text: fs.readFileSync(absolute(process.cwd(), relative), "utf8") }));
      const includesCount = sources.reduce((total, source) => total + (source.text.match(/\.includes\("/g) ?? []).length, 0);
      const startsWithCount = sources.reduce((total, source) => total + (source.text.match(/\.startsWith\("/g) ?? []).length, 0);

      item.check("both modules are in the scan", JSON.stringify(modules), JSON.stringify(sources.map((source) => source.file)));
      item.check("each module is really read", true, sources.every((source) => source.text.length > 1000));
      item.check("no module branches on problem prose with includes", 0, includesCount);
      item.check("no module branches on problem prose with startsWith", 0, startsWithCount);

      const root = sourceFixture("boss-ev-problems-");
      const freeze = identity.computeSourceFreeze({ root });
      write(root, "src/shared/alpha.ts", "// changed after the freeze\n");
      const manifest = identity.computeBuildManifest({ root, sourceCommit: "1".repeat(40), sourceTree: "2".repeat(40) });
      const bare = tempDir("boss-ev-problems-bare-");
      const problems = [
        ...identity.verifySourceFreeze(freeze, root),
        ...identity.verifyBuildManifest(manifest, { root, sourceCommit: "9".repeat(40), sourceTree: "9".repeat(40) }),
        ...identity.verifyTestManifest(identity.computeTestManifest({ root }), root),
        ...identity.verifyDependencyIdentity(identity.computeDependencyIdentity({ root: bare }))
      ];

      item.check("the real verifications did report problems", true, problems.length > 0);
      item.check("every problem is a {code, detail?} object", true, structured(problems));
      item.check("every code comes from the declared vocabulary", JSON.stringify([...new Set(problems.map((problem) => problem.code))].filter((code) => (Object.values(CODES) as string[]).indexOf(code) < 0)), "[]");
      item.check("the dependency identity of a bare tree is refused by code", true, hasCode(problems, CODES.DEPENDENCY_LOCKFILE_MISSING));
      item.cite("EVOLUTION_IDENTITY_CODES");
    });
  });
});

/** The §12 category of an inventoried path, read through the host vocabulary. */
function identityPathCategory(relativePath: string): string {
  const segments = relativePath.split("/").slice(0, -1);
  if (segments.indexOf("acceptance") >= 0) return "acceptance";
  if (segments.indexOf("unit") >= 0) return "unit";
  return "other";
}

afterAll(() => {
  const report = run.write(REPORT_DIR, "evolution-identity.json", {
    phase: "Phase B — Artifact / Build Binding",
    plan: "Update-Plan/self-evlo.md §5–§13, §37",
    scenarios: 16
  });
  cleanupFixtures();
  run.assertAllPass();
  expect((report.totals as { fail: number }).fail).toEqual(0);
});
