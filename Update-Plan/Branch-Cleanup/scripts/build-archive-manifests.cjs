/**
 * Phase B / N planning — build the archive and deletion manifests WITHOUT
 * creating, moving or deleting any ref.
 *
 * Per the owner's instruction for this round, all tag creation and branch deletion
 * is deferred to the promotion phase. This script therefore only *plans*: it
 * evaluates the cleanup.md section 21 deletion guard for every candidate branch and
 * records the verdict, so the promotion phase has a reviewed list to execute.
 *
 * READ-ONLY with respect to git: no `git tag`, `git branch -d`, `git push`.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Walk up from this script until the repository root is found.
function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const repoRoot = findRepoRoot(__dirname);
process.chdir(repoRoot);

const git = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
const gitOk = (args) => {
  try { return { ok: true, out: git(args) }; } catch (e) { return { ok: false, out: null }; }
};

const OUT_DIR = path.join(repoRoot, "Update-Plan", "Branch-Cleanup");

// --- candidate classification from cleanup.md sections 2, 3, 15, 17 -----------
const CANDIDATES = [
  // A class — integration participants
  { branch: "9-10-M",       cls: "A", keep: true,  deleteAfterPromotion: true,  tag: "archive/host-m-final" },
  { branch: "9-10-A",       cls: "A", keep: true,  deleteAfterPromotion: true,  tag: "archive/host-a-final" },
  { branch: "A-main-integration", cls: "C-created", keep: true, deleteAfterPromotion: true, tag: "archive/9-10-integration-final", aliasOf: "9-10-integration" },
  // B class — permanent
  { branch: "main",         cls: "B", keep: true,  deleteAfterPromotion: false, tag: null },
  { branch: "owner-result", cls: "B", keep: true,  deleteAfterPromotion: false, tag: "archive/owner-result-r43" },
  // C class — old dated versions
  { branch: "9-3-remote",        cls: "C", keep: false, deleteAfterPromotion: false, tag: "archive/9-3-remote" },
  { branch: "9-3",               cls: "C", keep: false, deleteAfterPromotion: false, tag: "archive/9-3" },
  { branch: "9-4",               cls: "C", keep: false, deleteAfterPromotion: false, tag: "archive/9-4" },
  { branch: "9-5",               cls: "C", keep: false, deleteAfterPromotion: false, tag: "archive/9-5" },
  { branch: "9-6",               cls: "C", keep: false, deleteAfterPromotion: false, tag: "archive/9-6" },
  { branch: "9-7",               cls: "C", keep: false, deleteAfterPromotion: false, tag: "archive/9-7" },
  { branch: "9-8",               cls: "C", keep: false, deleteAfterPromotion: false, tag: "archive/9-8" },
  { branch: "9-8-overcomplete",  cls: "C", keep: false, deleteAfterPromotion: false, tag: "archive/9-8-overcomplete" },
  // D class — old closure branches (must NOT be merged)
  { branch: "2026-09-09-closure",   cls: "D", keep: false, deleteAfterPromotion: false, tag: "archive/closure-2026-09-09", mustNotMerge: true },
  { branch: "9-2026-09-09-closure", cls: "D", keep: false, deleteAfterPromotion: false, tag: "archive/closure-9-2026-09-09", mustNotMerge: true },
];

function localSha(name) {
  const r = gitOk(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
  return r.ok ? r.out : null;
}
function remoteSha(name) {
  const r = gitOk(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`]);
  return r.ok ? r.out : null;
}
function tagExistsWhich(name, tag) {
  const r = gitOk(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]);
  return r.ok ? r.out : null;
}

const integrationSha = git(["rev-parse", "HEAD"]);
const mSha = git(["rev-parse", "9-10-M"]);

// Which commits of a candidate are not already reachable from the integration HEAD?
// A non-zero count means the branch holds commits the integration tree does not
// carry — the cleanup.md section 1.1 condition "no unique unintegrated production
// code" is then NOT provably satisfied, and deletion must be denied.
function uniqueCommits(name, sha) {
  if (!sha) return null;
  const r = gitOk(["rev-list", "--count", `${integrationSha}..${sha}`]);
  return r.ok ? Number(r.out) : null;
}

const archiveEntries = [];
const deletionEntries = [];

for (const c of CANDIDATES) {
  const lsha = localSha(c.branch);
  const rsha = remoteSha(c.branch);
  const present = Boolean(lsha || rsha);
  const sha = lsha || rsha;
  const existingTagSha = c.tag ? tagExistsWhich(c.branch, c.tag) : null;
  const uniq = uniqueCommits(c.branch, sha);

  const guard = {
    TAG_EXISTS: false,
    TAG_SHA_MATCH: false,
    TREE_READABLE: false,
    UNIQUE_REQUIRED_CODE: null,
    INTEGRATED_OR_ARCHIVED: false,
  };

  if (sha) {
    // Guard 3: the tree must be readable.
    const treeOk = gitOk(["ls-tree", "-r", "--name-only", sha]);
    guard.TREE_READABLE = treeOk.ok && treeOk.out.length > 0;
    // Guard 4: no unique unintegrated production code.
    guard.UNIQUE_REQUIRED_CODE = uniq !== null && uniq > 0;
    // Guards 1/2 are evaluated against the *planned* tag, which does not exist yet.
    guard.TAG_EXISTS = Boolean(existingTagSha);
    guard.TAG_SHA_MATCH = Boolean(existingTagSha && existingTagSha === sha);
    guard.INTEGRATED_OR_ARCHIVED = guard.TAG_EXISTS && guard.TAG_SHA_MATCH;
  }

  const denialReasons = [];
  if (!present) denialReasons.push("branch not present on any ref");
  if (!guard.TAG_EXISTS) denialReasons.push("archive tag does not exist yet (deferred to promotion)");
  if (guard.TAG_EXISTS && !guard.TAG_SHA_MATCH) denialReasons.push("tag SHA does not match branch HEAD");
  if (!guard.TREE_READABLE) denialReasons.push("repository tree not readable");
  if (guard.UNIQUE_REQUIRED_CODE === true) {
    denialReasons.push(`${uniq} commit(s) not reachable from the integration HEAD (not absorbed; must not be deleted)`);
  }
  if (uniq === null) denialReasons.push("could not compute commit divergence");

  const safeToDelete = present && guard.TAG_EXISTS && guard.TAG_SHA_MATCH && guard.TREE_READABLE
    && guard.UNIQUE_REQUIRED_CODE === false && guard.INTEGRATED_OR_ARCHIVED;

  archiveEntries.push({
    branch: c.branch,
    class: c.cls,
    plannedTag: c.tag,
    localSha: lsha,
    remoteSha: rsha,
    localEqualsRemote: lsha && rsha ? lsha === rsha : null,
    refScope: lsha && rsha ? "both" : lsha ? "local-only" : rsha ? "remote-only" : "absent",
    tagExistsNow: Boolean(existingTagSha),
    tagShaNow: existingTagSha,
    actionThisRound: "PLAN_ONLY",
    actionAtPromotion: c.tag ? `create ${c.tag} at ${sha || "(absent)"}` : "none",
  });

  deletionEntries.push({
    branch: c.branch,
    class: c.cls,
    headSha: sha,
    commitsNotInIntegration: uniq,
    guard,
    safeToDelete,
    deleteDecision: safeToDelete ? "SAFE_TO_DELETE" : "DELETE_DENIED",
    denialReasons,
    deleteThisRound: false,
    deleteAtPromotion: !c.keep,
    keepPermanently: c.keep,
    deleteAfterMainPromotion: c.deleteAfterPromotion,
    mustNotMerge: Boolean(c.mustNotMerge),
  });
}

const archiveManifest = {
  schemaVersion: 1,
  kind: "BRANCH_CLEANUP_ARCHIVE_MANIFEST",
  generatedAt: new Date().toISOString(),
  integrationBranch: "A-main-integration",
  integrationHead: integrationSha,
  baselineBranch: "9-10-M",
  baselineHead: mSha,
  authority: "Update-Plan/cleanup.md sections 1.1, 2, 3, 20",
  executionScopeThisRound: "PLAN_ONLY — the owner deferred all tag creation and branch deletion to the promotion phase",
  tagsCreatedThisRound: 0,
  branchesDeletedThisRound: 0,
  tagCountAtPlanning: Number(git(["tag", "-l"]).split("\n").filter(Boolean).length),
  entries: archiveEntries,
};

const deletionManifest = {
  schemaVersion: 1,
  kind: "BRANCH_CLEANUP_DELETION_MANIFEST",
  generatedAt: new Date().toISOString(),
  integrationBranch: "A-main-integration",
  integrationHead: integrationSha,
  authority: "Update-Plan/cleanup.md sections 1.1, 21, 22, 28",
  guardRule: "a branch may only be deleted when TAG_EXISTS && TAG_SHA_MATCH && TREE_READABLE && UNIQUE_REQUIRED_CODE == false && INTEGRATED_OR_ARCHIVED",
  executionScopeThisRound: "PLAN_ONLY — no branch was deleted; every row is DELETE_DENIED until its tag is created and verified",
  branchesDeletedThisRound: 0,
  summary: {
    candidates: deletionEntries.length,
    safeToDelete: deletionEntries.filter((e) => e.safeToDelete).length,
    deleteDenied: deletionEntries.filter((e) => !e.safeToDelete).length,
  },
  entries: deletionEntries,
};

fs.writeFileSync(path.join(OUT_DIR, "archive-manifest.json"), JSON.stringify(archiveManifest, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(OUT_DIR, "deletion-manifest.json"), JSON.stringify(deletionManifest, null, 2) + "\n", "utf8");

console.log("=== archive manifest ===");
console.log(`tags created this round: ${archiveManifest.tagsCreatedThisRound}, branches deleted: ${archiveManifest.branchesDeletedThisRound}`);
for (const e of archiveEntries) {
  console.log(`  ${e.branch.padEnd(24)} ${String(e.refScope).padEnd(12)} ${(e.localSha || e.remoteSha || "-").slice(0, 12)}  tag=${e.plannedTag || "-"}  [${e.actionThisRound}]`);
}
console.log("");
console.log("=== deletion manifest ===");
console.log(`candidates=${deletionManifest.summary.candidates} safeToDelete=${deletionManifest.summary.safeToDelete} deleteDenied=${deletionManifest.summary.deleteDenied}`);
for (const e of deletionEntries) {
  console.log(`  ${e.branch.padEnd(24)} ${e.deleteDecision.padEnd(18)} commitsNotInIntegration=${e.commitsNotInIntegration}  uniqRequiredCode=${e.guard.UNIQUE_REQUIRED_CODE}`);
}
