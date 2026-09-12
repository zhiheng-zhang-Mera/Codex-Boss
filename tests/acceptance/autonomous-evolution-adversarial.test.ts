/**
 * Update-Plan/self-evlo.md §20–§23, §43, §44, §76–§78 — Phase E (adversarial expansion).
 *
 * AD-21..AD-50 continue the AD-01..AD-20 suite (`prestart-adversarial.test.ts`) into the
 * evolution trust surface, FX-01..FX-06 are §23's deterministic fuzz layer and
 * MM-01..MM-06 are §22's metamorphic rules. Every case is a *real* attack:
 *
 *   • a real git repository is created, real commits are made and the real
 *     `readGitIdentity` / `startAcceptanceSession` production readers are used;
 *   • real report files, real SHA-256 attestations, a real Owner ledger, real §3 surface
 *     hashes, a real contract snapshot, a real test manifest, a real build manifest and a
 *     real §47 certificate are written to disk;
 *   • the case then mutates those real bytes and asks the *real* host auditor
 *     (`createBootstrapAuditor` → `evaluateTrustedBootstrap`), the real strict validators
 *     (`validateGateReport`, `validateDesktopBlackBoxReport`), the real attestation
 *     verifier (`verifyGateAttestation`), the real ledger verifier (`verifyOwnerLedger`)
 *     and the real session validator (`sessionProblems`) for a verdict;
 *   • every refusal is recorded as a structured `{ code, detail? }` (§44), never as prose.
 *
 * The run must not complete in any of the 42 cases; `false_positive_cases` must be 0.
 * `notes` in the report records every place where the honest implementation is bounded
 * (for example: the evolution trust modules of §3/§7–§12/§47 do not exist in this
 * checkout yet, and `scripts/acceptance-prestart.cjs` is not importable because it
 * self-executes).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import {
  AcceptanceRun,
  acceptanceArtifacts,
  cleanGateReport,
  desktopBlackBoxReport,
  type AcceptanceItem
} from "../helpers/acceptance-report";
import { cleanupFixtures, commit as commitRepo, revParse } from "../helpers/root-fixtures";
import { trustedFixture } from "../helpers/trusted-evidence";
import {
  ACCEPTANCE_GATE_CONTRACTS,
  ACCEPTANCE_SUPPORTING_CONTRACTS,
  DESKTOP_BLACK_BOX_CONTRACT,
  type AcceptanceGateContract
} from "../../src/shared/acceptance-contracts";
import {
  PLAN_SECTION_3_ROOT_TRUST_PATHS,
  ROOT_TRUST_SURFACE_PATHS,
  assessBaseline,
  classifySurface
} from "../../src/shared/autonomous-evolution-trust";
import {
  buildGateAttestation,
  canonicalJson,
  canonicalSha256,
  sessionProblems,
  validateDesktopBlackBoxReport,
  validateGateReport,
  verifyGateAttestation
} from "../../src/shared/acceptance-evidence";
import { appendOwnerIntervention, emptyOwnerLedger, verifyOwnerLedger } from "../../src/shared/owner-intervention";
import { TRUST_CODES } from "../../src/shared/trust-problems";
import { readGitIdentity, readJsonFile, sha256File, sessionPath } from "../../electron/engineering/acceptance-session";
import { ownerLedgerPath } from "../../electron/engineering/owner-intervention-ledger";
import {
  CERTIFIED_STATE,
  FUZZ_MUTATIONS_PER_CASE,
  FUZZ_SEED,
  ROOT_TRUST_SURFACE_EXTRA_PATHS,
  ROOT_TRUST_SURFACE_GLOBS,
  assertScriptMirrors,
  buildManifestOf,
  bumpMutation,
  certificateRootHash,
  ciCoverage,
  ciRequiredGates,
  contractSnapshotProblems,
  createLab,
  evidenceLinkProblems,
  evolutionHarnessNotes,
  flipByteAfter,
  flipOneValueByte,
  fuzzMutationCount,
  hasCode,
  mutationCount,
  replayBindingOf,
  replayProblems,
  repositoryRoot,
  reportWithInstant,
  runFuzz,
  sha256Text,
  sourcesFromAudit,
  staleBaselineProblems,
  writeJsonFile,
  type FuzzReport,
  type GraduationVerdict,
  type Lab
} from "../helpers/evolution-attacks";

const UNIT = "AUTONOMOUS_EVOLUTION_ADVERSARIAL";
const run = new AcceptanceRun(UNIT);
const REPORT_DIR = acceptanceArtifacts();
const falsePositives: string[] = [];
const acceptedAttacks: string[] = [];
const notes: Record<string, string> = {};
const fuzzReports: FuzzReport[] = [];
const ciSummary: Record<string, unknown> = {};
const AD_IDS = Array.from({ length: 30 }, (_, index) => `AD-${21 + index}`);
const FX_IDS = Array.from({ length: 6 }, (_, index) => `FX-0${index + 1}`);
const MM_IDS = Array.from({ length: 6 }, (_, index) => `MM-0${index + 1}`);

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function contractOf(gate: string): AcceptanceGateContract {
  if (gate === DESKTOP_BLACK_BOX_CONTRACT.gate) return DESKTOP_BLACK_BOX_CONTRACT;
  const found = [...ACCEPTANCE_GATE_CONTRACTS, ...ACCEPTANCE_SUPPORTING_CONTRACTS].find((entry) => entry.gate === gate);
  if (!found) throw new Error(`no contract for ${gate}`);
  return found;
}

/** A real on-disk mutation by an attack (counted in the report's `mutation_count`). */
function writeRaw(file: string, text: string): void {
  bumpMutation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function writeRecord(file: string, value: unknown): void {
  bumpMutation();
  writeJsonFile(file, value);
}

function removeRaw(file: string): void {
  bumpMutation();
  fs.rmSync(file, { force: true });
}

/**
 * AD-21/29/35/36/48/49: a real commit that really moves HEAD. Git refuses an empty
 * commit, so the attack first writes a real file — which is also what a candidate run
 * would do.
 */
function attackCommit(root: string, message: string): string {
  const trace = path.join(root, "attack-trace.txt");
  fs.appendFileSync(trace, `${message}\n`, "utf8");
  bumpMutation();
  return commitRepo(root, message);
}

/** The honest control: derive the certificate, then re-verify the whole run. */
function certifyAndGraduate(lab: Lab, options?: Parameters<Lab["graduate"]>[0]): GraduationVerdict {
  lab.certificate();
  return lab.graduate(options);
}

/**
 * §20/§44: the run must not complete, and the refusal must name a machine reason that
 * came from a real checker. Nothing here inspects prose.
 */
function refused(item: AcceptanceItem, id: string, verdict: GraduationVerdict, expects: readonly string[]): void {
  const stopped = verdict.state !== CERTIFIED_STATE;
  if (!stopped) {
    falsePositives.push(id);
    acceptedAttacks.push(id);
  }
  item.check(`${id} does not complete (no certificate)`, "REFUSED", stopped ? "REFUSED" : "ACCEPTED");
  const matched = expects.filter((code) => verdict.codes.includes(code));
  item.check(`the refusal names its machine reason (${expects.join(" | ")})`, true, matched.length > 0);
  for (const code of matched) item.cite(code);
}

/** Hand-edits the certificate the way a forger would: state first, digest recomputed. */
function patchCertificate(lab: Lab, mutate: (record: Record<string, unknown>) => void, recomputeRootHash = true): Record<string, unknown> {
  const record = lab.readCertificate();
  if (!record) throw new Error("no certificate to patch");
  const copy = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  mutate(copy);
  if (recomputeRootHash) copy.root_hash = certificateRootHash(copy as never);
  writeRaw(lab.certificatePath, `${canonicalJson(copy)}\n`);
  return copy;
}

/* ------------------------------------------------------------------ *
 * Group AD — §20's hostile cases
 * ------------------------------------------------------------------ */

describe("Phase E §20–§23 adversarial expansion", () => {
  it("AD-21 HEAD changed after the session started is refused", async () => {
    await run.scenario("AD-21", "a new commit after session start", (item) => {
      const lab = createLab({ git: true });
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const moved = attackCommit(lab.root, "attack: HEAD moves after the session started");
      item.check("HEAD really moved", true, moved !== lab.session.commit_sha);
      const verdict = lab.graduate();
      item.check("the evidence alone is still complete", "BOOTSTRAP_COMPLETE", verdict.audit.decision);
      refused(item, "AD-21", verdict, [TRUST_CODES.CURRENT_HEAD_MISMATCH, TRUST_CODES.CURRENT_TREE_MISMATCH]);
    });
  });

  it("AD-22 a tracked file modified after session start is refused", async () => {
    await run.scenario("AD-22", "tracked file modified mid-run", (item) => {
      const lab = createLab({ git: true });
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      writeRaw(path.join(lab.root, "src", "app", "main.ts"), "export const main = 2;\n");
      const identity = readGitIdentity(lab.root);
      item.check("the real worktree reader sees a dirty tree", false, identity.worktree_clean);
      refused(item, "AD-22", lab.graduate(), [TRUST_CODES.WORKTREE_DIRTY_AT_GRADUATION]);
    });
  });

  it("AD-23 a staged change after session start is refused", async () => {
    await run.scenario("AD-23", "staged index change mid-run", (item) => {
      const lab = createLab({ git: true });
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      writeRaw(path.join(lab.root, "staged-attack.txt"), "staged but not committed\n");
      execFileSync("git", ["add", "staged-attack.txt"], { cwd: lab.root, stdio: "pipe" });
      const identity = readGitIdentity(lab.root);
      item.check("the real index reader sees a staged change", false, identity.index_clean);
      item.check("and the worktree is otherwise clean", true, identity.worktree_clean);
      refused(item, "AD-23", lab.graduate(), [TRUST_CODES.INDEX_DIRTY_AT_GRADUATION]);
    });
  });

  it("AD-24 a Root Trust Surface file modified after session start is refused", async () => {
    await run.scenario("AD-24", "§3 surface file modified mid-run", (item) => {
      const lab = createLab({ git: true });
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const surface = Object.keys(lab.startSurface).sort();
      item.check("the lab froze the real §3 surface", true, surface.length > 10);
      const target = "scripts/acceptance-prestart.cjs";
      item.check("the surface includes the graduation command", true, surface.includes(target));
      const absolute = path.join(lab.root, ...target.split("/"));
      writeRaw(absolute, `${fs.readFileSync(absolute, "utf8")}\n// attack: a Root Trust Surface edit during the run\n`);
      const verdict = lab.graduate();
      item.check("the surface hash differs", true, verdict.codes.includes("ROOT_TRUST_SURFACE_CHANGED"));
      refused(item, "AD-24", verdict, ["ROOT_TRUST_SURFACE_CHANGED", TRUST_CODES.WORKTREE_DIRTY_AT_GRADUATION]);
      item.check("production classifies the attacked path as root trust", "ROOT_TRUST_SURFACE", classifySurface(target));
      item.check("and classifies the evolution globs as root trust", "ROOT_TRUST_SURFACE",
        classifySurface("src/shared/autonomous-evolution-trust.ts"));
      notes["AD-24"] = `surface list imported from src/shared/autonomous-evolution-trust.ts: ${PLAN_SECTION_3_ROOT_TRUST_PATHS.length} §3 paths ∪ ${ROOT_TRUST_SURFACE_PATHS.length} declared patterns, ${surface.length} of them real in the lab, plus ${ROOT_TRUST_SURFACE_EXTRA_PATHS.join(", ")} for §9's source freeze. The attack edits scripts/acceptance-prestart.cjs and the live surface list is asserted against production classifySurface().`;
      item.cite("self-evlo.md §3");
    });
  });

  it("AD-25 a contract that shrinks mid-run is refused", async () => {
    await run.scenario("AD-25", "the acceptance contract loses a required id", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const shrunk = ACCEPTANCE_GATE_CONTRACTS.map((contract) => contract.gate === "acceptance-verify"
        ? { ...contract, required_ids: contract.required_ids.filter((id) => id !== "V-04") }
        : contract);
      const shrunkContract = shrunk.find((contract) => contract.gate === "acceptance-verify")!;
      const real = verifyGateAttestation({
        gate: "acceptance-verify",
        contract: shrunkContract,
        session: lab.session,
        attestation: lab.readAttestation("acceptance-verify"),
        report: lab.readReport("acceptance-verify"),
        source_sha256: sha256File(lab.reportFile("acceptance-verify"))
      });
      item.check("the real attestation verifier refuses the shrunken contract", true,
        real.some((problem) => problem.code === TRUST_CODES.ATTESTATION_REQUIRED_IDS_MISMATCH || problem.code === TRUST_CODES.ATTESTATION_REQUIRED_IDS_HASH_MISMATCH));
      const verdict = lab.graduate({ contracts: [...shrunk, DESKTOP_BLACK_BOX_CONTRACT, ...ACCEPTANCE_SUPPORTING_CONTRACTS] });
      item.check("the audit on the shrunken contract would still pass", "BOOTSTRAP_COMPLETE", verdict.audit.decision);
      refused(item, "AD-25", verdict, ["CONTRACT_REQUIRED_IDS_CHANGED"]);
      item.cite("self-evlo.md §11");
    });
  });

  it("AD-26 a test file deleted mid-run is refused", async () => {
    await run.scenario("AD-26", "test inventory loses a real test file", (item) => {
      const lab = createLab({ git: true });
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const test = path.join(lab.root, "tests", "acceptance", "prestart-adversarial.test.ts");
      item.check("the lab holds the repository's real test file", true, fs.existsSync(test) && fs.readFileSync(test, "utf8").includes("AD-01"));
      item.check("the test inventory locked it", true, lab.startTests.files.some((entry) => entry.file === "tests/acceptance/prestart-adversarial.test.ts"));
      removeRaw(test);
      refused(item, "AD-26", lab.graduate(), ["TEST_FILE_MISSING", TRUST_CODES.WORKTREE_DIRTY_AT_GRADUATION]);
      item.cite("self-evlo.md §12");
    });
  });

  it("AD-27 the package lock changing mid-run is refused", async () => {
    await run.scenario("AD-27", "pnpm-lock.yaml changes mid-run", (item) => {
      const lab = createLab({ git: true });
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const lock = path.join(lab.root, "pnpm-lock.yaml");
      const original = fs.readFileSync(lock, "utf8");
      item.check("the lab holds the repository's real lockfile", true, original.includes("lockfileVersion"));
      writeRaw(lock, `${original}\n# attack: a dependency appeared mid-run\n`);
      refused(item, "AD-27", lab.graduate(), ["DEPENDENCY_IDENTITY_MISMATCH", "ROOT_TRUST_SURFACE_CHANGED", TRUST_CODES.WORKTREE_DIRTY_AT_GRADUATION]);
      item.cite("self-evlo.md §10");
    });
  });

  it("AD-28 a stale build reused under a build manifest is refused", async () => {
    await run.scenario("AD-28", "build manifest hash mismatch", (item) => {
      const lab = createLab({ git: true });
      const manifest = lab.buildManifest();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched build certifies", CERTIFIED_STATE, control.state);
      item.check("the manifest lists real build files", true, manifest.build_files.length > 0);
      const target = manifest.build_files[0];
      const built = path.join(lab.root, ...target.split("/"));
      item.check("the listed build file really exists", true, fs.existsSync(built));
      writeRaw(built, `${fs.readFileSync(built, "utf8")}\n// attack: an older build of this module was reused\n`);
      refused(item, "AD-28", lab.graduate(), ["BUILD_FILE_HASH_MISMATCH"]);
      const missing = ["dist-electron/electron/engineering/atomic-file.js"]
        .filter((file) => !fs.existsSync(path.join(lab.root, ...file.split("/"))));
      notes["AD-28"] = `build identity is recorded in build-manifest.json and re-hashed at graduation (real SHA-256 over ${manifest.build_files.length} real build artifacts). Observation: the checkout's dist-electron is incomplete — ${missing.length ? missing.join(", ") : "nothing"} missing — and scripts/acceptance-prestart.cjs refuses to start without every module it requires, so a stale dist cannot be certified either.`;
      item.cite("self-evlo.md §7/§8");
    });
  });

  it("AD-29 a binary built from a different tree is refused", async () => {
    await run.scenario("AD-29", "build manifest source_tree mismatch", (item) => {
      const lab = createLab({ git: true });
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const sourceTree = revParse(lab.root, "HEAD^{tree}");
      attackCommit(lab.root, "attack: a second tree the build could have come from");
      const otherTree = revParse(lab.root, "HEAD^{tree}");
      item.check("the two trees really differ", true, otherTree !== sourceTree);
      const other = buildManifestOf(lab.root, lab.buildFiles, { commit_sha: revParse(lab.root, "HEAD"), tree_sha: otherTree });
      writeRecord(lab.buildManifestPath, other);
      const verdict = lab.graduate({
        identity: { commit_sha: lab.session.commit_sha, tree_sha: lab.session.tree_sha ?? "", worktree_clean: true, index_clean: true, status: "" }
      });
      refused(item, "AD-29", verdict, ["BUILD_SOURCE_TREE_MISMATCH"]);
    });
  });

  it("AD-30 a hand-edited certificate state is refused by re-derivation", async () => {
    await run.scenario("AD-30", "certificate state field is not evidence", (item) => {
      const lab = createLab();
      lab.writeLedger(appendOwnerIntervention(emptyOwnerLedger(lab.session), {
        source: "acceptance-run",
        at: lab.labTime(900),
        reason: "attack: the Owner had to decide something"
      }));
      const honest = lab.certificate();
      item.check("the honest certificate is incomplete", "AUTONOMOUS_EVOLUTION_INCOMPLETE", honest.state);
      const forged = patchCertificate(lab, (record) => {
        record.state = CERTIFIED_STATE;
        record.problems = [];
      });
      item.check("the forgery is internally hash-consistent", forged.root_hash, certificateRootHash(forged as never));
      const verdict = lab.graduate();
      item.check("the certificate root hash is intact", false, hasCode(verdict.problems, "CERTIFICATE_ROOT_HASH_MISMATCH"));
      refused(item, "AD-30", verdict, ["CERTIFICATE_STATE_NOT_REDERIVED", "OWNER_INTERVENTION_PRESENT"]);
      item.cite("self-evlo.md §76");
    });
  });

  it("AD-31 a hand-edited certificate root hash is refused", async () => {
    await run.scenario("AD-31", "certificate root hash is not self-authenticating", (item) => {
      const lab = createLab();
      const honest = lab.certificate();
      item.check("the honest certificate is certified", CERTIFIED_STATE, honest.state);
      const forged = patchCertificate(lab, (record) => { record.root_hash = "0".repeat(64); }, false);
      item.check("the file really holds the forged digest", "0".repeat(64), (lab.readCertificate() as { root_hash: string }).root_hash);
      item.check("and the re-derived digest differs", true, certificateRootHash(forged as never) !== "0".repeat(64));
      refused(item, "AD-31", lab.graduate(), ["CERTIFICATE_ROOT_HASH_MISMATCH"]);
    });
  });

  it("AD-32 an attestation replaced after the root audit is refused", async () => {
    await run.scenario("AD-32", "attestation swapped after the audit", (item) => {
      const lab = createLab();
      const audited = lab.evaluate();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const foreign = trustedFixture({ sessionId: "session-adversary-attestation" });
      writeRaw(lab.attestationFile("acceptance-verify"), fs.readFileSync(foreign.attestationFile("acceptance-verify"), "utf8"));
      const verdict = lab.graduate();
      item.check("the root audit hash moved", true, verdict.audit_root_hash !== audited.root_hash);
      refused(item, "AD-32", verdict, [TRUST_CODES.ATTESTATION_SESSION_MISMATCH, TRUST_CODES.ATTESTATION_HASH_MISMATCH]);
    });
  });

  it("AD-33 the Owner ledger replaced after the root audit is refused", async () => {
    await run.scenario("AD-33", "Owner ledger swapped after the audit", (item) => {
      const lab = createLab();
      const audited = lab.evaluate();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const foreign = trustedFixture({ sessionId: "session-adversary-ledger" });
      lab.writeLedger(emptyOwnerLedger(foreign.session));
      const verdict = lab.graduate();
      item.check("the root audit hash moved", true, verdict.audit_root_hash !== audited.root_hash);
      item.check("the audit reads the foreign ledger's session", foreign.session.session_id, verdict.audit.owner_intervention_ledger.session_id);
      refused(item, "AD-33", verdict, ["LEDGER_SESSION_MISMATCH", "LEDGER_HASH_MISMATCH"]);
    });
  });

  it("AD-34 session.json replaced after the root audit is refused", async () => {
    await run.scenario("AD-34", "session manifest swapped after the audit", (item) => {
      const lab = createLab();
      const audited = lab.evaluate();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const replaced = { ...lab.session, session_id: "session-adversary-replaced", commit_sha: "d".repeat(40), tree_sha: "f".repeat(40) };
      writeRaw(sessionPath(lab.artifacts), `${canonicalJson(replaced)}\n`);
      const verdict = lab.graduate();
      item.check("the root audit hash moved", true, verdict.audit_root_hash !== audited.root_hash);
      refused(item, "AD-34", verdict, [TRUST_CODES.ATTESTATION_SESSION_MISMATCH, TRUST_CODES.CURRENT_HEAD_MISMATCH, "CERTIFICATE_SESSION_MISMATCH"]);
    });
  });

  it("AD-35 test results copied from a previous commit are refused", async () => {
    await run.scenario("AD-35", "evidence replayed from a previous commit", (item) => {
      const lab = createLab({ git: true });
      const control = certifyAndGraduate(lab);
      item.check("control: the first commit certifies", CERTIFIED_STATE, control.state);
      const replayed = {
        report: fs.readFileSync(lab.reportFile("acceptance-verify"), "utf8"),
        attestation: fs.readFileSync(lab.attestationFile("acceptance-verify"), "utf8")
      };
      const previousBinding = replayBindingOf(lab);
      const previousCommit = lab.session.commit_sha;
      const next = attackCommit(lab.root, "attack: a new commit replays the old test results");
      item.check("the commit really moved", true, next !== previousCommit);
      const session = lab.restart("replay");
      item.check("the new session binds the new commit", next, session.commit_sha);
      writeRaw(lab.reportFile("acceptance-verify"), replayed.report);
      writeRaw(lab.attestationFile("acceptance-verify"), replayed.attestation);
      item.check("the replayed report bytes are unchanged", sha256File(lab.reportFile("acceptance-verify")), sha256Text(replayed.report));
      refused(item, "AD-35", certifyAndGraduate(lab), [TRUST_CODES.ATTESTATION_COMMIT_MISMATCH, TRUST_CODES.ATTESTATION_TREE_MISMATCH]);
      // §77 through the evolution trust module's own replay verdict: the previous run's
      // five bindings against this run's.
      const replay = replayProblems(previousBinding, replayBindingOf(lab));
      item.check("§77 reports the replay", true, replay.replayed);
      item.check("and names the bindings that no longer match", true,
        replay.mismatches.includes("session_id") || replay.mismatches.includes("commit") || replay.mismatches.includes("tree"));
      item.cite("self-evlo.md §77");
    });
  });

  it("AD-36 a build artifact copied from a previous commit is refused", async () => {
    await run.scenario("AD-36", "build manifest replayed from a previous commit", (item) => {
      const lab = createLab({ git: true });
      const stale = JSON.parse(JSON.stringify(lab.buildManifest())) as Record<string, unknown>;
      const control = certifyAndGraduate(lab);
      item.check("control: the first commit certifies", CERTIFIED_STATE, control.state);
      attackCommit(lab.root, "attack: a new commit replays the previous build");
      const session = lab.restart("stale-build");
      item.check("the new session binds a new tree", true, session.tree_sha !== stale.source_tree);
      writeRecord(lab.buildManifestPath, stale);
      refused(item, "AD-36", certifyAndGraduate(lab), ["BUILD_SOURCE_TREE_MISMATCH", "BUILD_SOURCE_COMMIT_MISMATCH"]);
      item.cite("self-evlo.md §8");
    });
  });

  it("AD-37 a symlink/junction path substitution is refused", async () => {
    await run.scenario("AD-37", "junction substitution on the evidence directory", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const foreign = trustedFixture({ sessionId: "session-adversary-junction" });
      const attestations = path.join(lab.artifacts, "attestations");
      const moved = path.join(lab.artifacts, "attestations-real");
      fs.renameSync(attestations, moved);
      bumpMutation();
      fs.symlinkSync(path.join(foreign.artifacts, "attestations"), attestations, "junction");
      item.check("the substitution is a real filesystem link", true, fs.lstatSync(attestations).isSymbolicLink());
      const linkProblems = evidenceLinkProblems(lab.artifacts);
      item.check("the path-identity check sees it", true, hasCode(linkProblems, "EVIDENCE_PATH_REDIRECTED"));
      item.check("and sees that it leaves the evidence root", true, hasCode(linkProblems, "EVIDENCE_PATH_ESCAPE"));
      const verdict = lab.graduate();
      item.check("the foreign bytes are read and refused, not silently accepted", true,
        verdict.codes.includes(TRUST_CODES.ATTESTATION_SESSION_MISMATCH));
      refused(item, "AD-37", verdict, ["EVIDENCE_PATH_REDIRECTED", TRUST_CODES.ATTESTATION_SESSION_MISMATCH]);
    });
  });

  it("AD-38 a malformed-Unicode path collision is refused", async () => {
    await run.scenario("AD-38", "Unicode look-alike evidence filenames", (item) => {
      const lab = createLab();
      const foreign = trustedFixture({ sessionId: "session-adversary-unicode" });
      const decoy = "\uff53ession.json";
      const zeroWidth = "session.json\u200b";
      const bytes = fs.readFileSync(sessionPath(foreign.artifacts), "utf8");
      item.check("the decoy is a Unicode confusable, not the real name", true, decoy.normalize("NFKC") === "session.json" && decoy !== "session.json");
      writeRaw(path.join(lab.artifacts, decoy), bytes);
      writeRaw(path.join(lab.artifacts, zeroWidth), bytes);
      const inspected = lab.graduate({ skipCertificate: true });
      item.check("the real reader still reads the real session", lab.session.session_id, inspected.audit.session_id);
      const withDecoys = lab.graduate();
      item.check("the look-alikes are unaccounted sources", true, withDecoys.codes.includes("UNKNOWN_EVIDENCE_SOURCE"));
      removeRaw(sessionPath(lab.artifacts));
      const verdict = lab.graduate();
      item.check("the look-alike cannot stand in for session.json", true, verdict.codes.includes(TRUST_CODES.SESSION_FILE_MISSING));
      refused(item, "AD-38", verdict, [TRUST_CODES.SESSION_FILE_MISSING, "UNKNOWN_EVIDENCE_SOURCE"]);
    });
  });

  it("AD-39 a duplicate evidence source is refused", async () => {
    await run.scenario("AD-39", "duplicate source for one gate", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const audit = lab.evaluate();
      const gates = audit.sources.filter((source) => source.kind === "gate").map((source) => source.gate);
      item.check("the real host audit lists every gate exactly once", gates.length, new Set(gates).size);
      const forged = patchCertificate(lab, (record) => {
        const sources = record.sources as { gate: string }[];
        sources.push(JSON.parse(JSON.stringify(sources.find((source) => source.gate === "acceptance-verify")!)) as { gate: string });
      });
      item.check("the forged manifest really holds a duplicate", true,
        new Set((forged.sources as { gate: string }[]).map((source) => source.gate)).size < (forged.sources as unknown[]).length);
      refused(item, "AD-39", lab.graduate(), ["DUPLICATE_EVIDENCE_SOURCE"]);
      const attestation = lab.readAttestation("acceptance-verify")!;
      const duplicated = { ...attestation, required_ids: [...attestation.required_ids, attestation.required_ids[0]] };
      const problems = verifyGateAttestation({
        gate: "acceptance-verify",
        contract: contractOf("acceptance-verify"),
        session: lab.session,
        attestation: duplicated,
        report: lab.readReport("acceptance-verify"),
        source_sha256: sha256File(lab.reportFile("acceptance-verify"))
      });
      item.check("the real verifier refuses a duplicated id list", true,
        problems.some((problem) => problem.code === TRUST_CODES.ATTESTATION_REQUIRED_IDS_MISMATCH));
    });
  });

  it("AD-40 an unknown evidence source injected into the manifest is refused", async () => {
    await run.scenario("AD-40", "a gate no contract knows", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      const rogueContract: AcceptanceGateContract = {
        gate: "acceptance-rogue",
        contract_version: "rogue-1",
        report_file: "rogue-gate.json",
        required_ids: ["RG-01"],
        out_of_scope_ids: []
      };
      const rogueReport = cleanGateReport(rogueContract);
      rogueReport.generatedAt = lab.labTime(1000);
      const rogueReportFile = path.join(lab.artifacts, "rogue-gate.json");
      writeRecord(rogueReportFile, rogueReport);
      writeRaw(path.join(lab.artifacts, "attestations", "acceptance-rogue.json"), `${canonicalJson(buildGateAttestation({
        gate: rogueContract.gate,
        contract: rogueContract,
        session: lab.session,
        source_sha256: sha256File(rogueReportFile),
        validation: validateGateReport({ gate: rogueContract.gate, contract: rogueContract, report: rogueReport }),
        attested_at: lab.labTime(1000)
      }))}\n`);
      const audit = lab.evaluate();
      item.check("the real host audit cannot be made to count the rogue gate", ACCEPTANCE_GATE_CONTRACTS.length, audit.gates_required);
      item.check("and the contracted evidence still completes", "BOOTSTRAP_COMPLETE", audit.decision);
      refused(item, "AD-40", certifyAndGraduate(lab), ["UNKNOWN_EVIDENCE_SOURCE"]);
    });
  });

  it("AD-41 a required source silently removed is refused", async () => {
    await run.scenario("AD-41", "a contracted source disappears from the manifest", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      patchCertificate(lab, (record) => {
        record.sources = (record.sources as { gate: string }[]).filter((source) => source.gate !== "acceptance-soak");
      });
      refused(item, "AD-41", lab.graduate(), ["REQUIRED_SOURCE_MISSING"]);
      removeRaw(lab.reportFile("acceptance-soak"));
      removeRaw(lab.attestationFile("acceptance-soak"));
      const filesVerdict = lab.graduate();
      item.check("the real audit refuses the missing gate report", 15, filesVerdict.audit.gates_passed);
      refused(item, "AD-41", filesVerdict, [TRUST_CODES.REPORT_FILE_MISSING, "REQUIRED_SOURCE_MISSING"]);
    });
  });

  it("AD-42 a trust suite removed from the CI workflow is refused", async () => {
    await run.scenario("AD-42", "ci.yml loses a trust-suite run step", (item) => {
      const workflowPath = path.join(repositoryRoot(), ".github", "workflows", "ci.yml");
      const workflow = fs.readFileSync(workflowPath, "utf8");
      const required = ciRequiredGates();
      const supporting = ACCEPTANCE_SUPPORTING_CONTRACTS.map((contract) => contract.gate);
      const coverage = ciCoverage(workflow, required, supporting);
      item.check("every gate the run attests has a real run step", "none",
        coverage.missing.map((problem) => `${problem.code}:${problem.detail}`).join(",") || "none");
      item.check("the graduation command still mirrors these codes", 0, assertScriptMirrors(path.join(repositoryRoot(), "scripts", "acceptance-prestart.cjs")).length);
      item.check("the workflow attests at least the delivery gates", true, coverage.attested_gates.length >= required.length);
      const attacked = workflow.split(/\r?\n/).filter((line) => !(/^\s*-\s*run:/.test(line) && /acceptance:verify\b/.test(line))).join("\n");
      item.check("the copy really lost that run step", false, attacked.includes("pnpm run acceptance:verify"));
      const attackedCoverage = ciCoverage(attacked, required, supporting);
      item.check("the mutated workflow is refused", true,
        attackedCoverage.missing.some((problem) => problem.code === "CI_RUN_STEP_MISSING" && problem.detail === "acceptance-verify"));
      item.check("the real workflow file was not modified", sha256Text(workflow), sha256Text(fs.readFileSync(workflowPath, "utf8")));
      ciSummary.run_steps = coverage.run_steps.length;
      ciSummary.attested_gates = coverage.attested_gates.length;
      ciSummary.gates_required = required.length;
      ciSummary.covered = coverage.covered.length;
      ciSummary.uncovered_supporting = coverage.uncovered_supporting;
      notes["AD-42"] = `bound to the ${required.length} gates the fixture attests (sixteen delivery gates plus the desktop black box), all of which ci.yml runs today. Supporting suites with no run step in ci.yml: ${coverage.uncovered_supporting.join(", ") || "none"}.`;
      item.cite(".github/workflows/ci.yml");
    });
  });

  it("AD-43 a graduation that bypasses one gate is refused", async () => {
    await run.scenario("AD-43", "the run skips one gate's evidence", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      removeRaw(lab.reportFile("acceptance-verify"));
      const verdict = lab.graduate();
      item.check("the real audit sees fifteen of sixteen gates", 15, verdict.audit.gates_passed);
      item.check("and the capabilities are no longer established", true, verdict.audit.capabilities.passed < verdict.audit.capabilities.required);
      refused(item, "AD-43", verdict, [TRUST_CODES.REPORT_FILE_MISSING, "REQUIRED_SOURCE_MISSING"]);
    });
  });

  it("AD-44 a fake supporting-suite report without an attestation is refused", async () => {
    await run.scenario("AD-44", "a perfect report is not evidence", (item) => {
      const control = createLab();
      control.certificate();
      item.check("control: the same suite with its attestation verifies", CERTIFIED_STATE, control.graduate().state);
      const lab = createLab();
      const gate = "acceptance-root-hardening";
      lab.writeReport(gate, reportWithInstant(contractOf(gate)));
      removeRaw(lab.attestationFile(gate));
      const validation = validateGateReport({ gate, contract: contractOf(gate), report: lab.readReport(gate) });
      item.check("the fake report passes the strict report contract", "PASS", validation.verdict);
      refused(item, "AD-44", certifyAndGraduate(lab), [TRUST_CODES.ATTESTATION_NOT_OBJECT, TRUST_CODES.ATTESTATION_FILE_MISSING]);
    });
  });

  it("AD-45 timestamps from an unrelated run are refused", async () => {
    await run.scenario("AD-45", "future/past evidence timestamps", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched run certifies", CERTIFIED_STATE, control.state);
      lab.attest("acceptance-review", "2099-01-01T00:00:00.000Z");
      lab.writeReport("acceptance-soak", reportWithInstant(contractOf("acceptance-soak"), "2000-01-01T00:00:00.000Z"));
      lab.attest("acceptance-soak");
      const verdict = lab.graduate();
      item.check("the checkpoint-2 audit alone does not bind freshness", "BOOTSTRAP_COMPLETE", verdict.audit.decision);
      refused(item, "AD-45", verdict, ["ATTESTATION_TIME_OUTSIDE_RUN", "REPORT_TIME_OUTSIDE_RUN"]);
      notes["AD-45"] = "bound fields: attestation.attested_at (verifyGateAttestation keeps the field honest, but the checkpoint-2 audit never compares it to a window) and report.generatedAt (not validated at all by validateGateReport). The evolution layer binds both to the run window [session.started_at, session.started_at + 1h] and refuses anything outside it. The audit's own verdict is recorded as still complete, which is exactly why the binding is needed.";
    });
  });

  it("AD-46 a workspace mutation between the audit and the certificate write is refused", async () => {
    await run.scenario("AD-46", "TOCTOU between the final audit and the certificate", (item) => {
      const lab = createLab();
      const audit = lab.evaluate();
      const report = reportWithInstant(contractOf("acceptance-verify"));
      report.requirementResults = [...report.requirementResults, { id: "V-EXTRA", title: "an added passing check", verdict: "PASS" }];
      report.totals = { ...report.totals, pass: report.totals.pass + 1 };
      lab.writeReport("acceptance-verify", report);
      lab.attest("acceptance-verify");
      item.check("the changed evidence is still valid on its own", "PASS",
        validateGateReport({ gate: "acceptance-verify", contract: contractOf("acceptance-verify"), report: lab.readReport("acceptance-verify") }).verdict);
      const record = lab.certificate({
        bootstrap_root_hash: audit.root_hash,
        sources: [...sourcesFromAudit(audit), ...lab.supportingSources()],
        state: CERTIFIED_STATE,
        problems: []
      });
      item.check("the certificate records the stale audit", audit.root_hash, record.bootstrap_root_hash);
      refused(item, "AD-46", lab.graduate(), ["CERTIFICATE_BOOTSTRAP_HASH_MISMATCH", TRUST_CODES.SOURCE_HASH_MISMATCH]);
      item.cite("self-evlo.md §96");
    });
  });

  it("AD-47 a certificate generated from a dirty tree is refused", async () => {
    await run.scenario("AD-47", "dirty-tree certificate", (item) => {
      const lab = createLab({ git: true });
      const control = certifyAndGraduate(lab);
      item.check("control: the clean run certifies", CERTIFIED_STATE, control.state);
      writeRaw(path.join(lab.root, "src", "app", "main.ts"), "export const main = 3;\n");
      const identity = readGitIdentity(lab.root);
      item.check("the real reader sees the dirty tree", false, identity.worktree_clean);
      const forged = patchCertificate(lab, (record) => {
        record.state = CERTIFIED_STATE;
        record.problems = [];
        record.graduate_identity = {
          commit_sha: identity.commit_sha,
          tree_sha: identity.tree_sha,
          worktree_clean: true,
          index_clean: true,
          checked_at: lab.labTime(1400)
        };
      });
      item.check("the forgery is hash-consistent", forged.root_hash, certificateRootHash(forged as never));
      refused(item, "AD-47", lab.graduate(), [TRUST_CODES.WORKTREE_DIRTY_AT_GRADUATION, "CERTIFICATE_IDENTITY_MISMATCH"]);
    });
  });

  it("AD-48 a current HEAD that differs from the certificate commit is refused", async () => {
    await run.scenario("AD-48", "HEAD moved after the certificate", (item) => {
      const lab = createLab({ git: true });
      const certificate = lab.certificate();
      item.check("the certificate binds the current commit", lab.session.commit_sha, certificate.candidate_commit);
      const moved = attackCommit(lab.root, "attack: main moved after the certificate was written");
      item.check("main really moved", true, moved !== certificate.candidate_commit);
      const verdict = lab.graduate();
      refused(item, "AD-48", verdict, [TRUST_CODES.CURRENT_HEAD_MISMATCH, "CERTIFICATE_COMMIT_MISMATCH"]);
      const promotion = staleBaselineProblems({ baseline_commit: certificate.baseline_commit, candidate_commit: moved }, moved);
      item.check("a promotion attempt reports the stale baseline", true, hasCode(promotion, "STALE_BASELINE"));
      // §79 through the evolution trust module's own verdict.
      item.check("production agrees the baseline is stale", "STALE_BASELINE",
        assessBaseline({ certificateBaselineCommit: certificate.baseline_commit, currentMainCommit: moved }).verdict);
      item.check("and agrees an unmoved baseline is current", "BASELINE_CURRENT",
        assessBaseline({ certificateBaselineCommit: certificate.baseline_commit, currentMainCommit: certificate.baseline_commit }).verdict);
      item.cite("self-evlo.md §79");
    });
  });

  it("AD-49 a current tree that differs from the certificate tree is refused", async () => {
    await run.scenario("AD-49", "tree changed after the certificate", (item) => {
      const lab = createLab({ git: true });
      const certificate = lab.certificate();
      item.check("the certificate binds the current tree", lab.session.tree_sha ?? "", certificate.candidate_tree);
      attackCommit(lab.root, "attack: the certified tree is replaced by a new commit");
      const movedTree = revParse(lab.root, "HEAD^{tree}");
      item.check("the tree really changed", true, movedTree !== certificate.candidate_tree);
      refused(item, "AD-49", lab.graduate(), [TRUST_CODES.CURRENT_TREE_MISMATCH, "CERTIFICATE_TREE_MISMATCH"]);
      const forged = createLab({ git: true });
      forged.certificate();
      patchCertificate(forged, (record) => { record.candidate_tree = "0".repeat(40); });
      refused(item, "AD-49", forged.graduate(), ["CERTIFICATE_TREE_MISMATCH"]);
    });
  });

  it("AD-50 a package lock that does not match the recorded dependency identity is refused", async () => {
    await run.scenario("AD-50", "dependency identity mismatch", (item) => {
      const lab = createLab({ git: true });
      const certificate = lab.certificate();
      item.check("the certificate recorded a real lock digest", true, /^[0-9a-f]{64}$/.test(certificate.dependency_identity.lockfile_sha256));
      const lock = path.join(lab.root, "pnpm-lock.yaml");
      writeRaw(lock, `${fs.readFileSync(lock, "utf8")}\n# attack: a different dependency set\n`);
      const verdict = lab.graduate();
      item.check("the lock really changed", true, sha256File(lock) !== certificate.dependency_identity.lockfile_sha256);
      refused(item, "AD-50", verdict, ["DEPENDENCY_IDENTITY_MISMATCH"]);
      item.cite("self-evlo.md §10");
    });
  });

  /* ---------------------------------------------------------------- *
   * Group FX — §23 fuzz layer
   * ---------------------------------------------------------------- */

  it("FX-01 mutated gate reports are never accepted", async () => {
    await run.scenario("FX-01", "§23 fuzz over report files", (item) => {
      const lab = createLab();
      const gate = "acceptance-verify";
      const contract = contractOf(gate);
      const file = lab.reportFile(gate);
      const baseline = fs.readFileSync(file, "utf8");
      const attestation = lab.readAttestation(gate)!;
      item.check("the text hash equals the file hash", sha256File(file), sha256Text(baseline));
      const report = runFuzz({
        id: "FX-01",
        baseline,
        judge: (mutated) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(mutated);
          } catch {
            return { refused: true, by: "parse", codes: [TRUST_CODES.REPORT_NOT_OBJECT] };
          }
          const validation = validateGateReport({ gate, contract, report: parsed });
          const provenance = verifyGateAttestation({
            gate,
            contract,
            session: lab.session,
            attestation,
            report: parsed,
            source_sha256: sha256Text(mutated)
          });
          const codes = [...validation.problems.map((problem) => problem.code), ...provenance.map((problem) => problem.code)];
          return {
            refused: validation.verdict === "FAIL" || provenance.length > 0,
            by: validation.verdict === "FAIL" ? "validator" : "provenance",
            codes
          };
        }
      });
      fuzzReports.push(report);
      item.check("mutated inputs judged", FUZZ_MUTATIONS_PER_CASE, report.mutations);
      item.check("every mutated report was refused", report.mutations, report.refused);
      item.check("no mutated report was accepted", 0, report.passes.length);
      item.check("no validator exception escaped as a pass", 0, report.crashes);
      const hostInput = JSON.parse(JSON.stringify(lab.readReport(gate))) as Record<string, unknown>;
      hostInput.passed = false;
      writeRecord(file, hostInput);
      const audit = lab.evaluate();
      item.check("the real host auditor refuses the mutated file on disk", "INCOMPLETE", audit.decision);
      item.check("and names a machine code for it", true, audit.sources.some((source) => source.problems.length > 0));
      item.cite("§23 parser never crashes into PASS");
    });
  });

  it("FX-02 mutated attestations are never accepted", async () => {
    await run.scenario("FX-02", "§23 fuzz over attestation files", (item) => {
      const lab = createLab();
      const gate = "acceptance-verify";
      const contract = contractOf(gate);
      const file = lab.attestationFile(gate);
      const baseline = fs.readFileSync(file, "utf8");
      const report = lab.readReport(gate);
      const reportSha = sha256File(lab.reportFile(gate));
      const fuzz = runFuzz({
        id: "FX-02",
        baseline,
        judge: (mutated) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(mutated);
          } catch {
            return { refused: true, by: "parse", codes: [TRUST_CODES.ATTESTATION_NOT_OBJECT] };
          }
          const problems = verifyGateAttestation({ gate, contract, session: lab.session, attestation: parsed, report, source_sha256: reportSha });
          return { refused: problems.length > 0, by: "provenance", codes: problems.map((problem) => problem.code) };
        }
      });
      fuzzReports.push(fuzz);
      item.check("mutated inputs judged", FUZZ_MUTATIONS_PER_CASE, fuzz.mutations);
      item.check("every mutated attestation was refused", fuzz.mutations, fuzz.refused);
      item.check("no mutated attestation was accepted", 0, fuzz.passes.length);
      item.check("no verifier exception escaped as a pass", 0, fuzz.crashes);
      const flip = flipOneValueByte(file);
      item.check("one byte of the attestation really changed", true, flip.before !== flip.after);
      const audit = lab.evaluate();
      item.check("the real host auditor refuses the mutated attestation file", "INCOMPLETE", audit.decision);
      writeRaw(file, flip.before);
      item.cite("§23 parser never crashes into PASS");
    });
  });

  it("FX-03 a mutated Owner ledger is never accepted", async () => {
    await run.scenario("FX-03", "§23 fuzz over the ledger", (item) => {
      const lab = createLab();
      const file = ownerLedgerPath(lab.artifacts);
      const baseline = fs.readFileSync(file, "utf8");
      const session = lab.session;
      const fuzz = runFuzz({
        id: "FX-03",
        baseline,
        judge: (mutated) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(mutated);
          } catch {
            return { refused: true, by: "parse", codes: ["LEDGER_NOT_OBJECT"] };
          }
          const problems = verifyOwnerLedger({ ledger: parsed, session });
          return { refused: problems.length > 0, by: "validator", codes: problems.map((problem) => problem.code) };
        }
      });
      fuzzReports.push(fuzz);
      item.check("mutated inputs judged", FUZZ_MUTATIONS_PER_CASE, fuzz.mutations);
      item.check("every mutated ledger was refused", fuzz.mutations, fuzz.refused);
      item.check("no mutated ledger was accepted", 0, fuzz.passes.length);
      item.check("no verifier exception escaped as a pass", 0, fuzz.crashes);
      const flip = flipOneValueByte(file);
      item.check("one byte of the ledger really changed", true, flip.before !== flip.after);
      item.check("the real host auditor refuses the mutated ledger file", "INCOMPLETE", lab.evaluate().decision);
      writeRaw(file, flip.before);
      item.cite("self-evlo.md §7");
    });
  });

  it("FX-04 a mutated session manifest is never accepted", async () => {
    await run.scenario("FX-04", "§23 fuzz over the session manifest", (item) => {
      const lab = createLab();
      const file = sessionPath(lab.artifacts);
      const baseline = fs.readFileSync(file, "utf8");
      const originalSha = sha256Text(baseline);
      const bound = { session_id: lab.session.session_id, commit_sha: lab.session.commit_sha, tree_sha: lab.session.tree_sha ?? "" };
      const fuzz = runFuzz({
        id: "FX-04",
        baseline,
        judge: (mutated) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(mutated);
          } catch {
            return { refused: true, by: "parse", codes: [TRUST_CODES.SESSION_NOT_OBJECT] };
          }
          const problems = sessionProblems(parsed).map((problem) => problem.code);
          if (problems.length) return { refused: true, by: "validator", codes: problems };
          const value = parsed as { session_id?: unknown; commit_sha?: unknown; tree_sha?: unknown };
          if (value.session_id !== bound.session_id || value.commit_sha !== bound.commit_sha || value.tree_sha !== bound.tree_sha) {
            return { refused: true, by: "provenance", codes: [TRUST_CODES.ATTESTATION_SESSION_MISMATCH, TRUST_CODES.ATTESTATION_COMMIT_MISMATCH] };
          }
          if (sha256Text(mutated) !== originalSha) {
            return { refused: true, by: "binding", codes: ["SESSION_FILE_CHANGED"] };
          }
          return { refused: false, by: "none", codes: [] };
        }
      });
      fuzzReports.push(fuzz);
      item.check("mutated inputs judged", FUZZ_MUTATIONS_PER_CASE, fuzz.mutations);
      item.check("every mutated session was refused", fuzz.mutations, fuzz.refused);
      item.check("no mutated session was accepted", 0, fuzz.passes.length);
      item.check("no validator exception escaped as a pass", 0, fuzz.crashes);
      const flip = flipOneValueByte(file);
      item.check("one byte of session.json really changed", true, flip.before !== flip.after);
      item.check("the real host auditor refuses the mutated session", "INCOMPLETE", lab.evaluate().decision);
      writeRaw(file, flip.before);
      notes["FX-04"] = "structural session mutations are refused by sessionProblems; mutations of fields the validator does not shape-check (e.g. working_tree_status) are refused by the session file-hash binding — session.json's SHA-256 is part of the root manifest and of the certificate. The checkpoint-2 host audit alone would still complete on such a benign field, which is why the file binding is asserted.";
      item.cite("self-evlo.md §43");
    });
  });

  it("FX-05 a mutated certificate/manifest is never accepted", async () => {
    await run.scenario("FX-05", "§23 fuzz over the §47 certificate", (item) => {
      const lab = createLab();
      const certificate = lab.certificate();
      const baseline = fs.readFileSync(lab.certificatePath, "utf8");
      const fuzz = runFuzz({
        id: "FX-05",
        baseline,
        judge: (mutated) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(mutated);
          } catch {
            return { refused: true, by: "parse", codes: ["CERTIFICATE_NOT_OBJECT"] };
          }
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { refused: true, by: "validator", codes: ["CERTIFICATE_NOT_OBJECT"] };
          }
          const record = parsed as { root_hash?: unknown };
          if (record.root_hash !== certificateRootHash(parsed as never)) {
            return { refused: true, by: "provenance", codes: ["CERTIFICATE_ROOT_HASH_MISMATCH"] };
          }
          return { refused: false, by: "none", codes: [] };
        }
      });
      fuzzReports.push(fuzz);
      item.check("mutated inputs judged", FUZZ_MUTATIONS_PER_CASE, fuzz.mutations);
      item.check("every mutated certificate was refused", fuzz.mutations, fuzz.refused);
      item.check("no mutated certificate was accepted", 0, fuzz.passes.length);
      item.check("no parser exception escaped as a pass", 0, fuzz.crashes);
      item.check("control: the untouched certificate re-derives", certificate.root_hash, certificateRootHash(certificate));
      const flip = flipOneValueByte(lab.certificatePath);
      item.check("one byte of the certificate really changed", true, flip.before !== flip.after);
      item.check("the run refuses the mutated certificate", true, lab.graduate().state !== CERTIFIED_STATE);
      writeRaw(lab.certificatePath, flip.before);
      item.cite("self-evlo.md §76");
    });
  });

  it("FX-06 a mutated contract snapshot / desktop contract block is never accepted", async () => {
    await run.scenario("FX-06", "§23 fuzz over the contract snapshot and the desktop contract", (item) => {
      const lab = createLab();
      lab.certificate();
      const contracts = [...ACCEPTANCE_GATE_CONTRACTS, DESKTOP_BLACK_BOX_CONTRACT, ...ACCEPTANCE_SUPPORTING_CONTRACTS];
      const snapshotBaseline = fs.readFileSync(lab.contractSnapshotPath, "utf8");
      const snapshotFuzz = runFuzz({
        id: "FX-06:snapshot",
        baseline: snapshotBaseline,
        judge: (mutated) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(mutated);
          } catch {
            return { refused: true, by: "parse", codes: ["CONTRACT_SNAPSHOT_MISSING"] };
          }
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { refused: true, by: "validator", codes: ["CONTRACT_SNAPSHOT_MISSING"] };
          }
          const problems = contractSnapshotProblems(parsed, contracts).map((problem) => problem.code);
          const { snapshot_hash: stored, ...body } = parsed as Record<string, unknown>;
          if (stored === canonicalSha256(body)) return { refused: false, by: "none", codes: problems };
          return { refused: true, by: "provenance", codes: ["CONTRACT_SNAPSHOT_HASH_MISMATCH", ...problems] };
        }
      });
      fuzzReports.push(snapshotFuzz);
      const desktopFile = lab.reportFile(DESKTOP_BLACK_BOX_CONTRACT.gate);
      const desktopBaseline = fs.readFileSync(desktopFile, "utf8");
      const desktopAttestation = lab.readAttestation(DESKTOP_BLACK_BOX_CONTRACT.gate)!;
      const desktopFuzz = runFuzz({
        id: "FX-06:desktop-contract",
        baseline: desktopBaseline,
        judge: (mutated) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(mutated);
          } catch {
            return { refused: true, by: "parse", codes: [TRUST_CODES.REPORT_NOT_OBJECT] };
          }
          const validation = validateDesktopBlackBoxReport({ contract: DESKTOP_BLACK_BOX_CONTRACT, report: parsed });
          const provenance = verifyGateAttestation({
            gate: DESKTOP_BLACK_BOX_CONTRACT.gate,
            contract: DESKTOP_BLACK_BOX_CONTRACT,
            session: lab.session,
            attestation: desktopAttestation,
            report: parsed,
            source_sha256: sha256Text(mutated)
          });
          const codes = [...validation.problems.map((problem) => problem.code), ...provenance.map((problem) => problem.code)];
          return { refused: validation.verdict === "FAIL" || provenance.length > 0, by: validation.verdict === "FAIL" ? "validator" : "provenance", codes };
        }
      });
      fuzzReports.push(desktopFuzz);
      item.check("mutated snapshots judged", FUZZ_MUTATIONS_PER_CASE, snapshotFuzz.mutations);
      item.check("every mutated snapshot was refused", snapshotFuzz.mutations, snapshotFuzz.refused);
      item.check("no mutated snapshot was accepted", 0, snapshotFuzz.passes.length);
      item.check("mutated desktop blocks judged", FUZZ_MUTATIONS_PER_CASE, desktopFuzz.mutations);
      item.check("every mutated desktop block was refused", desktopFuzz.mutations, desktopFuzz.refused);
      item.check("no mutated desktop block was accepted", 0, desktopFuzz.passes.length);
      item.check("no parser exception escaped as a pass", 0, snapshotFuzz.crashes + desktopFuzz.crashes);
      item.check("the crash set is empty and named", "none",
        [...snapshotFuzz.crash_messages, ...desktopFuzz.crash_messages].join(" | ") || "none");
      const flipped = flipOneValueByte(lab.contractSnapshotPath);
      item.check("one byte of the snapshot really changed", true, flipped.before !== flipped.after);
      item.check("the run refuses the mutated snapshot", true, lab.graduate().state !== CERTIFIED_STATE);
      writeRaw(lab.contractSnapshotPath, flipped.before);
      item.cite("self-evlo.md §11");
    });
  });

  /* ---------------------------------------------------------------- *
   * Group MM — §22 metamorphic rules
   * ---------------------------------------------------------------- */

  it("MM-01 one byte of a report changes the root result", async () => {
    await run.scenario("MM-01", "§22 report byte flip", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched evidence verifies", CERTIFIED_STATE, control.state);
      item.check("sixteen trusted gates", 16, control.audit.gates_passed);
      item.check("the full desktop contract", true, control.audit.desktop.verified_claims === control.audit.desktop.required_claims && control.audit.desktop.verified_claims > 0);
      item.check("thirteen capabilities", 13, control.audit.capabilities.passed);
      item.check("zero Owner interventions", 0, control.audit.owner_interventions);
      const before = sha256File(lab.reportFile("acceptance-verify"));
      flipOneValueByte(lab.reportFile("acceptance-verify"));
      item.check("exactly one byte changed", true, before !== sha256File(lab.reportFile("acceptance-verify")));
      const after = lab.graduate();
      item.check("the root result changed", true, after.audit_root_hash !== control.audit_root_hash);
      refused(item, "MM-01", after, [TRUST_CODES.SOURCE_HASH_MISMATCH]);
    });
  });

  it("MM-02 one byte of an attestation changes the root result", async () => {
    await run.scenario("MM-02", "§22 attestation byte flip", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched evidence verifies", CERTIFIED_STATE, control.state);
      const attestation = lab.attestationFile("acceptance-verify");
      const before = sha256File(attestation);
      flipOneValueByte(attestation);
      item.check("exactly one byte changed", true, before !== sha256File(attestation));
      const after = lab.graduate();
      item.check("the root result changed", true, after.audit_root_hash !== control.audit_root_hash);
      refused(item, "MM-02", after, [TRUST_CODES.ATTESTATION_HASH_MISMATCH]);
    });
  });

  it("MM-03 one byte of the ledger changes the root result", async () => {
    await run.scenario("MM-03", "§22 ledger byte flip", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched evidence verifies", CERTIFIED_STATE, control.state);
      const ledger = ownerLedgerPath(lab.artifacts);
      const before = sha256File(ledger);
      flipOneValueByte(ledger);
      item.check("exactly one byte changed", true, before !== sha256File(ledger));
      const after = lab.graduate();
      item.check("the root result changed", true, after.audit_root_hash !== control.audit_root_hash);
      refused(item, "MM-03", after, ["LEDGER_HASH_MISMATCH", "LEDGER_COMMIT_MISMATCH"]);
    });
  });

  it("MM-04 one byte of the session changes the root result", async () => {
    await run.scenario("MM-04", "§22 session byte flip", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched evidence verifies", CERTIFIED_STATE, control.state);
      const session = sessionPath(lab.artifacts);
      const before = sha256File(session);
      flipOneValueByte(session);
      item.check("exactly one byte changed", true, before !== sha256File(session));
      const after = lab.graduate();
      item.check("the root result changed", true, after.audit_root_hash !== control.audit_root_hash);
      refused(item, "MM-04", after, [TRUST_CODES.ATTESTATION_COMMIT_MISMATCH, TRUST_CODES.SESSION_COMMIT_INVALID, TRUST_CODES.CURRENT_HEAD_MISMATCH]);
    });
  });

  it("MM-05 one value of the desktop contract block changes the root result", async () => {
    await run.scenario("MM-05", "§22 desktop contract block value mutation", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched evidence verifies", CERTIFIED_STATE, control.state);
      const report = desktopBlackBoxReport();
      report.generatedAt = lab.labTime(1000);
      report.contract.claim_ids_hash = "0".repeat(64);
      item.check("the contract block really changed", true, report.contract.claim_ids_hash !== desktopBlackBoxReport().contract.claim_ids_hash);
      lab.writeReport(DESKTOP_BLACK_BOX_CONTRACT.gate, report);
      const after = lab.graduate();
      item.check("the root result changed", true, after.audit_root_hash !== control.audit_root_hash);
      item.check("the desktop verdict is no longer trusted", true, after.audit.desktop.verdict !== "PASS");
      refused(item, "MM-05", after, [TRUST_CODES.DESKTOP_CONTRACT_HASH_MISMATCH, TRUST_CODES.SOURCE_HASH_MISMATCH]);
    });
  });

  it("MM-06 one byte of the root audit record changes the result", async () => {
    await run.scenario("MM-06", "§22 root evidence manifest byte flip", (item) => {
      const lab = createLab();
      const control = certifyAndGraduate(lab);
      item.check("control: the untouched evidence verifies", CERTIFIED_STATE, control.state);
      const stored = readJsonFile(lab.auditRecordPath) as { root_hash: string };
      item.check("the record really is the run's own audit", control.audit_root_hash, stored.root_hash);
      const before = sha256File(lab.auditRecordPath);
      flipByteAfter(lab.auditRecordPath, "root_hash");
      item.check("exactly one byte of the record changed", true, before !== sha256File(lab.auditRecordPath));
      const flipped = (readJsonFile(lab.auditRecordPath) as { root_hash: string }).root_hash;
      const after = lab.graduate();
      item.check("the audit is unchanged, so only the record binding can refuse", control.audit_root_hash, after.audit_root_hash);
      item.check("the manifest no longer matches the derived root hash", true, flipped !== after.audit_root_hash);
      refused(item, "MM-06", after, [TRUST_CODES.BOOTSTRAP_RECORD_ROOT_HASH_MISMATCH]);
      notes["MM-06"] = "the root evidence manifest is bootstrap-completion.json (the record the real host auditor writes). scripts/acceptance-prestart.cjs re-runs the audit — which rewrites that file — and only then compares it, so its own record check cannot fail; this lab reads the record before the audit, which is what makes the byte flip visible. Reported as a finding.";
    });
  });
});

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

afterAll(() => {
  const report = run.write(REPORT_DIR, "evolution-adversarial.json", {
    checkpoint: "PHASE_E",
    phase: "adversarial-expansion",
    mutations: mutationCount(),
    mutation_count: mutationCount(),
    fuzz_count: fuzzMutationCount(),
    fuzz_seed: FUZZ_SEED,
    fuzz_mutations_per_case: FUZZ_MUTATIONS_PER_CASE,
    fuzz_cases: fuzzReports.map((entry) => ({
      case: entry.case,
      mutations: entry.mutations,
      refused: entry.refused,
      accepted: entry.passes.length,
      crashes: entry.crashes,
      crash_messages: entry.crash_messages,
      by: entry.by,
      operations: entry.operations
    })),
    // §20: the number that must be zero.
    false_positive_cases: falsePositives.length,
    false_positive_ids: falsePositives,
    accepted_mutations: acceptedAttacks,
    positive_control: CERTIFIED_STATE,
    ids: { ad: AD_IDS.length, fx: FX_IDS.length, mm: MM_IDS.length },
    ci: ciSummary,
    notes,
    harness: evolutionHarnessNotes()
  });
  cleanupFixtures();
  run.assertAllPass();
  expect(falsePositives).toEqual([]);
  expect((report.totals as { fail: number }).fail).toEqual(0);
  // §2.6/§5.4: the report is judged by the same strict contract the run attests it with.
  const contract = ACCEPTANCE_SUPPORTING_CONTRACTS.find((entry) => entry.gate === "acceptance-evolution-adversarial");
  if (!contract) throw new Error("the acceptance-evolution-adversarial contract is missing from acceptance-contracts.ts");
  const validation = validateGateReport({ gate: contract.gate, contract, report });
  expect(validation.reasons).toEqual([]);
  expect(validation.verdict).toEqual("PASS");
  expect(report.unit).toEqual(UNIT);
  expect(report.false_positive_cases).toEqual(0);
  expect(Number(report.mutation_count)).toBeGreaterThan(0);
  expect(Number(report.fuzz_count)).toBeGreaterThanOrEqual(FX_IDS.length * FUZZ_MUTATIONS_PER_CASE);
});
