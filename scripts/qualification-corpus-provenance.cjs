#!/usr/bin/env node
/**
 * Corpus provenance for the real-host qualification lane (Phase B4/B5/B6).
 *
 *   node scripts/qualification-corpus-provenance.cjs                     # human-readable, local
 *   node scripts/qualification-corpus-provenance.cjs --json              # full machine record (host-local)
 *   node scripts/qualification-corpus-provenance.cjs --json --redacted   # uploadable aggregate ONLY
 *   node scripts/qualification-corpus-provenance.cjs --digest            # one commitment line (quiescence)
 *
 * READ-ONLY, and deliberately NOT a gate: it walks the same four roots the lifecycle generator walks
 * (`.codex-boss`, `artifacts`, `runtime-data`, `history`) and reports what is there, so that a Phase 04
 * result is always accompanied by the numbers that explain it.
 *
 * It does not compare the total against the generator's threshold on purpose. The invariant lives in
 * `scripts/data-lifecycle-report.cjs` (`allFiles.length > 1000`) and is the gate; restating the number here
 * would be a second copy of the truth that can silently drift, and a reporter that decides pass/fail would
 * let someone lower the bar in the reporter instead of in the gate. This script always exits 0.
 *
 * WHY `--redacted` EXISTS (B4)
 *
 * The qualification corpus is the Owner's real host state: sessions, prompts, project contents, paths and
 * whatever else accumulated. It must never be uploaded to a GitHub artifact. The redacted record carries
 * only what a reader needs to judge the run — per-root counts and byte totals, the overall totals, the
 * runner class and OS, the commit and trust epoch — plus a **commitment digest** over the full
 * `(path, size)` manifest. Anyone holding the corpus can recompute that digest and prove the aggregate was
 * not invented; nobody holding only the artifact learns a single path. The full manifest stays host-local.
 *
 * WHY `--digest` EXISTS (B5)
 *
 * B5 wants a stable view rather than a moving target. The lifecycle generator only READS and walks the roots
 * directly, so the honest way to establish stability without modifying a frozen Phase 04 gate is to measure
 * before and after: if the commitment digest is identical either side of the run, the corpus was quiescent
 * and the gate read a stable view. A different digest does not fail the gate — it qualifies the result,
 * which is what the workflow records.
 *
 * WHY THE SCHEMA IS v2 (PF-DEBT-018)
 *
 * v1's `runner` block carried a `labels` array read from `process.env.RUNNER_LABELS`. GitHub Actions does not
 * define that variable — its documented runner variables are `RUNNER_NAME`, `RUNNER_OS`, `RUNNER_ARCH` and
 * `RUNNER_ENVIRONMENT` — so the field was never a measurement: on the real soak host, which is scheduled
 * through `[self-hosted, windows, boss-real-soak, boss-qualification]`, it serialized as `[]`. A field that
 * looks like a measurement and can only ever be empty is worse than no field, so v2 REMOVES it instead of
 * trying to fill it.
 *
 * The reporter has no authoritative source for a runner's label set, and this is worth stating because the
 * three nearby facts are easy to collapse into one:
 *
 *   - the in-job environment carries the runner's NAME, ENVIRONMENT and OS, and no label list at all;
 *   - the agent's `.runner` registration file proves which ACCOUNT the runner is registered to — the private
 *     control repository, not this public one — and says nothing about its label set;
 *   - the labels a workflow declares in `runs-on` are a SCHEDULING REQUIREMENT: they say what the scheduler
 *     demanded, not what the runner reported about itself.
 *
 * So v2 reports only what the job can observe (`class`, `name`, and an `os` measured from the running
 * process), and the workflow's own evidence records the scheduling requirement under a name that says it is
 * one. Historical schema-1 artifacts remain valid historical artifacts with this known limitation and are not
 * rewritten; the commitment algorithm and the redaction boundary are unchanged by the version bump.
 */

"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const redacted = args.includes("--redacted");
const digestOnly = args.includes("--digest");

/** The roots `scripts/data-lifecycle-report.cjs` walks, in the same order for a diffable report. */
const ROOTS = [
  { dir: ".codex-boss", describes: "owner and runtime configuration" },
  { dir: "artifacts", describes: "acceptance evidence, soak output and packaged builds" },
  { dir: "runtime-data", describes: "runtime working data" },
  { dir: "history", describes: "session history" }
];

/** Walk a root, collecting `(relativePath, size)` pairs. Unreadable entries are counted, never hidden. */
function inventory(root) {
  const dir = path.join(ROOT, root.dir);
  if (!fs.existsSync(dir)) return { present: false, files: 0, bytes: 0, skipped: 0, entries: [] };
  const entries = [];
  let bytes = 0;
  let skipped = 0;
  const walk = (current, prefix) => {
    let dirents;
    try {
      dirents = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      skipped += 1;
      return;
    }
    for (const dirent of dirents) {
      const full = path.join(current, dirent.name);
      const relative = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        walk(full, relative);
        continue;
      }
      try {
        const size = fs.statSync(full).size;
        entries.push({ path: relative, size });
        bytes += size;
      } catch {
        skipped += 1;
      }
    }
  };
  walk(dir, "");
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { present: true, files: entries.length, bytes, skipped, entries };
}

/** SHA-256 over the canonical `(root, path, size)` manifest: a commitment that reveals no path. */
function commitmentDigest(perRoot) {
  const lines = [];
  for (const root of perRoot) {
    for (const entry of root.entries) lines.push(`${root.dir}\u0000${entry.path}\u0000${entry.size}`);
  }
  return crypto.createHash("sha256").update(lines.join("\n")).digest("hex");
}

const perRoot = ROOTS.map((root) => ({ ...root, ...inventory(root) }));
const totalFiles = perRoot.reduce((sum, root) => sum + root.files, 0);
const totalBytes = perRoot.reduce((sum, root) => sum + root.bytes, 0);
const totalSkipped = perRoot.reduce((sum, root) => sum + root.skipped, 0);
const digest = commitmentDigest(perRoot);

if (digestOnly) {
  process.stdout.write(`${digest}\n`);
  process.exit(0);
}

const record = {
  $comment:
    "Phase B4/B5/B6 corpus provenance. The redacted record is the ONLY form permitted to leave the host: " +
    "aggregate counts and a commitment digest, never paths, never file contents.",
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  redacted,
  // Only facts this job can actually observe. v1 also carried `labels`, read from a variable GitHub Actions
  // does not define; see the header. There is deliberately no replacement field: a declared scheduling
  // requirement belongs in the workflow's evidence, not in a runner measurement.
  runner: {
    class: process.env.RUNNER_ENVIRONMENT ?? (process.env.CI ? "github-actions" : "local"),
    name: process.env.RUNNER_NAME ?? os.hostname(),
    os: `${os.type()} ${os.release()} ${os.arch()}`
  },
  commit: process.env.GITHUB_SHA ?? null,
  trustEpoch: (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, "trust-policy", "trust-epoch.json"), "utf8")).record?.trust_epoch ?? null;
    } catch {
      return null;
    }
  })(),
  corpus: {
    totalFiles,
    totalBytes,
    totalSkipped,
    perRoot: perRoot.map((root) => ({ root: root.dir, describes: root.describes, present: root.present, files: root.files, bytes: root.bytes, skipped: root.skipped })),
    commitmentDigest: digest,
    commitmentAlgorithm: "sha256 over the sorted 'root\\0path\\0size' manifest (recomputable by a holder of the corpus)"
  },
  // The full manifest is host-local by default and omitted entirely when redacted.
  manifest: redacted ? undefined : perRoot.map((root) => ({ root: root.dir, entries: root.entries }))
};

if (asJson) {
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 && args[outIndex + 1] ? path.resolve(args[outIndex + 1]) : undefined;
  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text, "utf8");
    process.stdout.write(`[corpus] wrote ${path.relative(ROOT, out).split(path.sep).join("/")} (redacted=${redacted})\n`);
  } else {
    process.stdout.write(text);
  }
  process.exit(0);
}

process.stdout.write("[corpus] accumulated state the Phase 04 lifecycle gate will walk:\n");
for (const root of perRoot) {
  const state = root.present ? `${root.files} file(s), ${(root.bytes / (1024 * 1024)).toFixed(1)} MiB` : "absent";
  process.stdout.write(`[corpus]   ${root.dir.padEnd(14)} ${state}${root.skipped ? `, ${root.skipped} unreadable` : ""}  -- ${root.describes}\n`);
}
process.stdout.write(`[corpus] total: ${totalFiles} file(s), ${(totalBytes / (1024 * 1024)).toFixed(1)} MiB\n`);
process.stdout.write(`[corpus] commitment: ${digest}\n`);
process.stdout.write("[corpus] the gate itself is scripts/data-lifecycle-report.cjs; this report always exits 0\n");
