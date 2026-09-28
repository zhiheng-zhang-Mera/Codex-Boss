/**
 * OFF-REPO WORKING TOOL (post-CC103 closeout, T4 hypothesis test).
 *
 * HYPOTHESIS: if `src/shared/**` is not owned by the feature capabilities at all but by a foundation class the
 * kernels import FROM (so feature -> foundation, never kernel -> feature), then S2 and the shared-vocabulary half of
 * S3/S4 collapse without any code change and without relabelling anything falsely -- the ownership change IS the
 * architectural statement.
 *
 * This applies that ownership patch IN MEMORY, re-reads every kernel -> feature import statement for each candidate
 * file, and reports: how many kernel -> feature edges and pairs remain, how many are coverage (all imports of that
 * file are type-only) versus real behaviour, and which kernels caused them.
 *
 * usage: node foundation-lever.cjs
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const REPO = process.env.BOSS_REPO ?? "D:/Codex-Boss";
const inv = require(path.join(REPO, "scripts", "phase2-edge-inventory.cjs"));
const closure = require(path.join(REPO, "scripts", "capability-closure-validator.cjs"));
const map = closure.readOwnershipMap(REPO);
const manifests = closure.readManifests(REPO);
const kinds = new Map(manifests.filter((m) => m.id).map((m) => [m.id, m.kind ?? null]));
const KERNELS = [...kinds.entries()].filter(([, k]) => k === "kernel").map(([id]) => id);

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(path.extname(entry.name))) out.push(path.relative(REPO, full).split(path.sep).join("/"));
  }
  return out;
};
const allFiles = walk(path.join(REPO, "electron")).concat(walk(path.join(REPO, "src")));
const ownsPath = (entries, file) => entries.some((entry) => {
  const n = String(entry).replace(/\\/g, "/").replace(/\/+$/, "");
  return file === n || file.startsWith(`${n}/`);
});

// Present owner, and which pattern produced it (so an exact-file claim can be distinguished from a directory claim).
const owner = new Map();
const claimKind = new Map();
for (const [cap, patterns] of Object.entries(map.capabilities ?? {})) {
  for (const f of allFiles) {
    if (!ownsPath(patterns, f)) continue;
    if (owner.has(f)) { claimKind.set(f, "COLLISION"); continue; }
    owner.set(f, cap);
    const exact = patterns.some((p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "") === f);
    claimKind.set(f, exact ? "exact-file" : "directory");
  }
}
const roadConfig = JSON.parse(fs.readFileSync(path.join(REPO, "config", "capability-roads.json"), "utf8"));
const roadOwner = new Map(Object.entries(roadConfig.roads ?? {}).map(([f, e]) => [f, String(e.owner)]));

// CANDIDATES: files under src/shared/** that a kernel imports, with the statement-level information we need.
function analyse(patch) {
  const own = new Map(owner);
  const kind = new Map(claimKind);
  for (const [file, newOwner] of patch) { own.set(file, newOwner); kind.set(file, "patched"); }
  const stmts = [];
  for (const file of [...own.keys()].sort()) {
    const from = own.get(file);
    const fromKind = kinds.get(from) ?? (from === "FOUNDATION" ? "foundation" : null);
    if (fromKind !== "kernel") continue;
    const text = fs.readFileSync(path.join(REPO, file), "utf8");
    for (const m of text.matchAll(IMPORT_RE)) {
      const s = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!s) continue;
      const target = inv.resolveSpecifier(s, file);
      if (!target || !own.has(target)) continue;
      const to = own.get(target);
      const toKind = kinds.get(to) ?? (to === "FOUNDATION" ? "foundation" : null);
      if (toKind !== "feature") continue;
      stmts.push({ from, to, fromFile: file, toFile: target, spec: s });
    }
  }
  const pairs = new Set(stmts.map((s) => `${s.from} -> ${s.to}`));
  const remainingTargets = new Map();
  for (const s of stmts) remainingTargets.set(s.toFile, (remainingTargets.get(s.toFile) ?? 0) + 1);
  return { stmts, pairs, remainingTargets };
}

const base = analyse([]);
process.stdout.write(`BASELINE kernel -> feature import statements: ${base.stmts.length} over ${base.pairs.size} pairs\n`);

// Which src/shared files do the kernels actually import, and are they directory- or exact-file claims?
const sharedTargets = new Map();
for (const s of base.stmts) {
  if (!s.toFile.startsWith("src/shared/")) continue;
  const e = sharedTargets.get(s.toFile) ?? { owner: owner.get(s.toFile), claim: claimKind.get(s.toFile), count: 0, kernels: new Set() };
  e.count++;
  e.kernels.add(s.from);
  sharedTargets.set(s.toFile, e);
}
process.stdout.write(`\nsrc/shared targets reached by a kernel (${sharedTargets.size}):\n`);
for (const [file, e] of [...sharedTargets.entries()].sort()) {
  process.stdout.write(`  ${String(e.count).padStart(2)}  ${file}  owner=${e.owner} claim=${e.claim} kernels=${[...e.kernels].join(",")}\n`);
}

// Patch 1: every src/shared file a kernel reaches moves to FOUNDATION.
const patch1 = new Map();
for (const file of sharedTargets.keys()) patch1.set(file, "FOUNDATION");
const a1 = analyse(patch1);
process.stdout.write(`\nPATCH 1 -- every kernel-reached src/shared file becomes FOUNDATION:\n`);
process.stdout.write(`  kernel -> feature statements ${base.stmts.length} -> ${a1.stmts.length}   pairs ${base.pairs.size} -> ${a1.pairs.size}\n`);
process.stdout.write(`  still-feature targets (${a1.remainingTargets.size}):\n`);
for (const [f, n] of [...a1.remainingTargets.entries()].sort((x, y) => y[1] - x[1])) process.stdout.write(`    ${String(n).padStart(2)}  ${f}\n`);
