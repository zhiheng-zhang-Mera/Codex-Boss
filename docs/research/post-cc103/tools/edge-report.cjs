/**
 * OFF-REPO WORKING TOOL (post-CC103 closeout, T2/T3/T4).
 *
 * Recomputes the FULL kernel -> feature edge list and the mutual capability pairs from the repository's OWN
 * instrument (`scripts/phase2-edge-inventory.cjs`) and prints them grouped by source file, so the migration can be
 * driven cluster by cluster instead of by the truncated 40-sample list the instrument publishes.
 *
 * It re-implements nothing: the ownership map, the road declarations, the kind table and the import pattern are all
 * read from the same modules the CI gate uses. This is a reader, not a second instrument.
 *
 * usage: node edge-report.cjs [--json] [--file=<path>] [--cluster=<capability>]
 */
"use strict";
const path = require("node:path");
const fs = require("node:fs");

const REPO = process.env.BOSS_REPO ?? "D:/Codex-Boss";
process.chdir(REPO);

const inv = require(path.join(REPO, "scripts", "phase2-edge-inventory.cjs"));
const cycles = require(path.join(REPO, "scripts", "phase2-cycles.cjs"));

// The inventory publishes only 40 samples; recompute the full set with its own primitives.
const closure = require(path.join(REPO, "scripts", "capability-closure-validator.cjs"));
const map = closure.readOwnershipMap(REPO);
const manifests = closure.readManifests(REPO);
const kinds = new Map(manifests.filter((m) => m.id).map((m) => [m.id, m.kind ?? null]));

const IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;
const spec = require(path.join(REPO, "scripts", "phase2-edge-inventory.cjs"));

const allFiles = (function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if ([".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(path.extname(entry.name))) out.push(path.relative(REPO, full).split(path.sep).join("/"));
  }
  return out;
})(path.join(REPO, "electron")).concat((function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if ([".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(path.extname(entry.name))) out.push(path.relative(REPO, full).split(path.sep).join("/"));
  }
  return out;
})(path.join(REPO, "src")));

const COMPOSITION_ROOT = "<composition-root>";
const ROAD = "<road>";
const roadConfig = JSON.parse(fs.readFileSync(path.join(REPO, "config", "capability-roads.json"), "utf8"));
const roadOwner = new Map(Object.entries(roadConfig.roads ?? {}).map(([f, e]) => [f, String(e.owner)]));

function ownsPath(entries, file) {
  for (const entry of entries) {
    const n = String(entry).replace(/\\/g, "/").replace(/\/+$/, "");
    if (file === n || file.startsWith(`${n}/`)) return true;
  }
  return false;
}
const owner = new Map();
for (const [cap, patterns] of Object.entries(map.capabilities ?? {})) for (const f of allFiles) if (ownsPath(patterns, f)) owner.set(f, cap);
for (const f of allFiles) if (roadOwner.has(f)) owner.set(f, ROAD);
for (const [entry] of Object.entries(map.compositionRoot ?? {})) for (const f of allFiles) if (ownsPath([entry], f)) owner.set(f, COMPOSITION_ROOT);

const edges = [];
for (const file of [...owner.keys()].sort()) {
  const text = fs.readFileSync(path.join(REPO, file), "utf8");
  const specifiers = new Set([...text.matchAll(IMPORT_PATTERN)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]).filter(Boolean));
  for (const s of specifiers) {
    const target = spec.resolveSpecifier(s, file);
    if (!target || !owner.has(target)) continue;
    const from = owner.get(file);
    const to = owner.get(target);
    const effectiveTo = to === ROAD ? roadOwner.get(target) : to;
    if (from === effectiveTo) continue;
    // line number of the import statement, for the editor
    const idx = text.indexOf(s);
    const line = idx >= 0 ? text.slice(0, idx).split("\n").length : null;
    edges.push({ from, to, fromFile: file, toFile: target, fromKind: kinds.get(from) ?? (from === COMPOSITION_ROOT ? "composition-root" : from === ROAD ? "road" : null), toKind: kinds.get(to) ?? (to === ROAD ? "road" : null), specifier: s, line });
  }
}

const kf = edges.filter((e) => e.fromKind === "kernel" && e.toKind === "feature");
const args = process.argv.slice(2);
const json = args.includes("--json");
const onlyFile = (args.find((a) => a.startsWith("--file=")) ?? "").slice(7);
const onlyCluster = (args.find((a) => a.startsWith("--cluster=")) ?? "").slice(10);

let list = kf;
if (onlyFile) list = list.filter((e) => e.fromFile === onlyFile);
if (onlyCluster) list = list.filter((e) => `${e.from} -> ${e.to}` === onlyCluster || e.from === onlyCluster);

if (json) {
  process.stdout.write(`${JSON.stringify({ count: list.length, edges: list }, null, 2)}\n`);
} else {
  const bySource = new Map();
  for (const e of list) {
    const arr = bySource.get(e.fromFile) ?? [];
    arr.push(e);
    bySource.set(e.fromFile, arr);
  }
  process.stdout.write(`kernel->feature edges: ${list.length} over ${new Set(list.map((e) => `${e.from} -> ${e.to}`)).size} pairs\n`);
  process.stdout.write(`mutual pairs: ${inv.report.edges.mutualCapabilityPairs}; largest SCC ${cycles.report.largestSccSize} of ${cycles.report.capabilityNodes}\n`);
  for (const [file, arr] of [...bySource.entries()].sort()) {
    process.stdout.write(`\n${file}  [${arr[0].from}]\n`);
    for (const e of arr) process.stdout.write(`    L${String(e.line).padStart(4)}  -> ${e.toFile}   (${e.from} -> ${e.to})\n`);
  }
}
