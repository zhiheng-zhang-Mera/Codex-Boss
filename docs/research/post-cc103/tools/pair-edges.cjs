/**
 * OFF-REPO WORKING TOOL (post-CC103 closeout, T4).
 *
 * Print the actual FILE edges in both directions for one capability pair, so a mutual pair can be judged as a real
 * cycle or as a mis-attribution. Reads the repository's own inventory modules. Reader only.
 *
 * usage: node pair-edges.cjs tenx tasks [--limit=40]
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const REPO = process.env.BOSS_REPO ?? "D:/Codex-Boss";

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;
const inv = require(path.join(REPO, "scripts", "phase2-edge-inventory.cjs"));
const closure = require(path.join(REPO, "scripts", "capability-closure-validator.cjs"));
const map = closure.readOwnershipMap(REPO);
const manifests = closure.readManifests(REPO);
const kinds = new Map(manifests.filter((m) => m.id).map((m) => [m.id, m.kind ?? null]));

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
const owner = new Map();
for (const [cap, patterns] of Object.entries(map.capabilities ?? {})) for (const f of allFiles) if (ownsPath(patterns, f)) owner.set(f, cap);
const COMPOSITION_ROOT = "<composition-root>";
for (const [entry] of Object.entries(map.compositionRoot ?? {})) for (const f of allFiles) if (ownsPath([entry], f)) owner.set(f, COMPOSITION_ROOT);
const ROAD = "<road>";
const roadConfig = JSON.parse(fs.readFileSync(path.join(REPO, "config", "capability-roads.json"), "utf8"));
const roadOwner = new Map(Object.entries(roadConfig.roads ?? {}).map(([f, e]) => [f, String(e.owner)]));
for (const f of allFiles) if (roadOwner.has(f)) owner.set(f, ROAD);

const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
const limit = Number((process.argv.find((x) => x.startsWith("--limit=")) ?? "--limit=40").slice(8));

const edges = [];
for (const file of [...owner.keys()].sort()) {
  const text = fs.readFileSync(path.join(REPO, file), "utf8");
  for (const m of text.matchAll(IMPORT_RE)) {
    const s = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (!s) continue;
    const target = inv.resolveSpecifier(s, file);
    if (!target || !owner.has(target)) continue;
    const from = owner.get(file);
    const to = owner.get(target);
    const eff = to === ROAD ? roadOwner.get(target) : to;
    if (from === eff) continue;
    edges.push({ from, to, fromFile: file, toFile: target, specifier: s, line: text.slice(0, m.index).split("\n").length });
  }
}

const show = (x, y) => {
  const list = edges.filter((e) => e.from === x && e.to === y);
  process.stdout.write(`\n### ${x} -> ${y}: ${list.length} file edge(s)   [kinds: ${kinds.get(x) ?? "?"} -> ${kinds.get(y) ?? "?"}]\n`);
  for (const e of list.slice(0, limit)) process.stdout.write(`  ${e.fromFile}:${e.line}  ->  ${e.toFile}\n`);
  if (list.length > limit) process.stdout.write(`  ... ${list.length - limit} more\n`);
  return list.length;
};
if (!a || !b) {
  // no args: list the pairs
  const pairs = new Map();
  for (const e of edges) pairs.set(`${e.from} -> ${e.to}`, (pairs.get(`${e.from} -> ${e.to}`) ?? 0) + 1);
  for (const [k, v] of [...pairs.entries()].sort()) process.stdout.write(`${String(v).padStart(4)}  ${k}\n`);
} else {
  const f = show(a, b);
  const r = show(b, a);
  process.stdout.write(`\nTOTAL ${a}<->${b}: ${f} + ${r} = ${f + r}\n`);
}
