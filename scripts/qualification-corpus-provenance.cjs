#!/usr/bin/env node
/**
 * Report the accumulated-corpus provenance for the Phase 04 lifecycle gate.
 *
 * READ-ONLY, and deliberately NOT a gate. It walks the same four roots the lifecycle generator walks
 * (`.codex-boss`, `artifacts`, `runtime-data`, `history`) and prints what is actually there, per root and
 * in total, so that a Phase 04 failure is always accompanied by the numbers that explain it.
 *
 * It does not compare the total against the generator's threshold on purpose. The invariant lives in
 * `scripts/data-lifecycle-report.cjs` (`allFiles.length > 1000`) and is the gate; restating the number
 * here would be a second copy of the truth that can silently drift, and a reporter that decides pass/fail
 * would let someone lower the bar in the reporter instead of in the gate. This script always exits 0.
 *
 * Why it exists at all: the Phase 04 gate verifies the retention policy over a corpus that real,
 * long-running host activity produces. Measured, that corpus is ~65125 files of `artifacts/host-soak`
 * residue on a host that has really been soaked, and 56 files on a clean hosted runner. Printing the
 * provenance is what makes the difference between "the gate is too strict" and "this runner has no
 * history" a matter of record rather than of opinion.
 *
 * Usage: node scripts/qualification-corpus-provenance.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

/** The roots `scripts/data-lifecycle-report.cjs` walks, kept in the same order for a diffable report. */
const ROOTS = [
  { dir: ".codex-boss", describes: "owner and runtime configuration" },
  { dir: "artifacts", describes: "acceptance evidence, soak output and packaged builds" },
  { dir: "runtime-data", describes: "runtime working data" },
  { dir: "history", describes: "session history" }
];

/** Count files and bytes under a root without following the walk into a failure. */
function measure(root) {
  const dir = path.join(ROOT, root.dir);
  if (!fs.existsSync(dir)) return { files: 0, bytes: 0, skipped: 0, present: false };
  let files = 0;
  let bytes = 0;
  let skipped = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      skipped += 1;
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        files += 1;
        bytes += fs.statSync(full).size;
      } catch {
        skipped += 1;
      }
    }
  };
  walk(dir);
  return { files, bytes, skipped, present: true };
}

const rows = ROOTS.map((root) => ({ ...root, ...measure(root) }));
const total = rows.reduce((sum, row) => sum + row.files, 0);
const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);

process.stdout.write("[corpus] accumulated state the Phase 04 lifecycle gate will walk:\n");
for (const row of rows) {
  const state = row.present ? `${row.files} file(s), ${(row.bytes / (1024 * 1024)).toFixed(1)} MiB` : "absent";
  process.stdout.write(`[corpus]   ${row.dir.padEnd(14)} ${state}${row.skipped ? `, ${row.skipped} unreadable` : ""}  -- ${row.describes}\n`);
}
process.stdout.write(`[corpus] total: ${total} file(s), ${(totalBytes / (1024 * 1024)).toFixed(1)} MiB\n`);
process.stdout.write("[corpus] the gate itself is scripts/data-lifecycle-report.cjs; this report always exits 0\n");
