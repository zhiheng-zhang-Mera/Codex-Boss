/**
 * OFF-REPO WORKING TOOL (post-CC103 closeout, T4).
 *
 * What would it TAKE? Computes, against the repository's own instrument modules, the single-EDGE removals that
 * reduce the mutual-pair count or the largest SCC the most, and reports the total number of mutual pairs and the
 * SCC membership so the size of the structural migration can be stated as a number instead of an adjective.
 *
 * The ownership model, the road declarations, the composition-root class and the import pattern are all read from
 * `scripts/phase2-edge-inventory.cjs` / `scripts/capability-closure-validator.cjs`, so this cannot disagree with the
 * CI gate about what an edge is. Reader only.
 *
 * usage: node scc-what-would-it-take.cjs [--top=10]
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

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;
const COMPOSITION_ROOT = "<composition-root>";
const ROAD = "<road>";
const roadConfig = JSON.parse(fs.readFileSync(path.join(REPO, "config", "capability-roads.json"), "utf8"));
const roadOwner = new Map(Object.entries(roadConfig.roads ?? {}).map(([f, e]) => [f, String(e.owner)]));

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
for (const f of allFiles) if (roadOwner.has(f)) owner.set(f, ROAD);
for (const [entry] of Object.entries(map.compositionRoot ?? {})) for (const f of allFiles) if (ownsPath([entry], f)) owner.set(f, COMPOSITION_ROOT);

const allEdges = [];
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
    allEdges.push({ from, to, fromFile: file, toFile: target });
  }
}
const capabilityEdges = allEdges.filter((e) => e.from !== COMPOSITION_ROOT && e.to !== COMPOSITION_ROOT && e.from !== ROAD && e.to !== ROAD);

function metrics(edges) {
  const pairs = new Map();
  for (const e of edges) pairs.set(`${e.from} -> ${e.to}`, (pairs.get(`${e.from} -> ${e.to}`) ?? 0) + 1);
  const mutual = new Set();
  for (const key of pairs.keys()) {
    const [a, b] = key.split(" -> ");
    if (pairs.has(`${b} -> ${a}`)) mutual.add([a, b].sort().join("|"));
  }
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const adj = new Map(nodes.map((n) => [n, new Set()]));
  for (const e of edges) adj.get(e.from).add(e.to);
  let index = 0;
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], comps = [];
  const go = (v) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) { go(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) { const c = []; for (;;) { const w = stack.pop(); onStack.delete(w); c.push(w); if (w === v) break; } comps.push(c); }
  };
  for (const n of nodes) if (!idx.has(n)) go(n);
  const largest = comps.reduce((a, c) => (c.length > a.length ? c : a), []);
  return { mutual, largest, nodes };
}

const base = metrics(capabilityEdges);
process.stdout.write(`capability graph: ${base.nodes.length} nodes, ${capabilityEdges.length} edges\n`);
process.stdout.write(`mutual pairs ${base.mutual.size}; largest SCC ${base.largest.length}: ${JSON.stringify([...base.largest].sort())}\n`);

// Per-PAIR leverage: which capability PAIR, if its edges were removed, shrinks the SCC most?
const pairKeys = [...new Set(capabilityEdges.map((e) => `${e.from} -> ${e.to}`))];
const rows = [];
for (const key of pairKeys) {
  const [a, b] = key.split(" -> ");
  const rest = capabilityEdges.filter((e) => !(e.from === a && e.to === b));
  const m = metrics(rest);
  const count = capabilityEdges.filter((e) => e.from === a && e.to === b).length;
  if (m.mutual.size < base.mutual.size || m.largest.length < base.largest.length) {
    rows.push({ key, count, mutualAfter: m.mutual.size, sccAfter: m.largest.length, sccMembers: [...m.largest].sort() });
  }
}
rows.sort((x, y) => x.sccAfter - y.sccAfter || x.mutualAfter - y.mutualAfter);
const top = Number((process.argv.find((x) => x.startsWith("--top=")) ?? "--top=15").slice(6));
process.stdout.write(`\ncapability-pair removals that change the metrics (${rows.length} candidates):\n`);
for (const r of rows.slice(0, top)) {
  process.stdout.write(`  remove ${String(r.count).padStart(3)} edge(s) ${r.key.padEnd(28)} -> mutual ${String(r.mutualAfter).padStart(2)} | SCC ${String(r.sccAfter).padStart(2)} ${JSON.stringify(r.sccMembers)}\n`);
}

// Exhaustive: smallest set of FILE edges whose removal brings the SCC to <= 1, greedy.
let current = capabilityEdges.slice();
let removed = [];
for (let step = 0; step < 60; step++) {
  const m = metrics(current);
  if (m.largest.length <= 1) break;
  // pick the pair whose removal minimises the largest SCC next
  let best = null;
  for (const key of new Set(current.map((e) => `${e.from} -> ${e.to}`))) {
    const [a, b] = key.split(" -> ");
    const rest = current.filter((e) => !(e.from === a && e.to === b));
    const mm = metrics(rest);
    const score = mm.largest.length * 1000 + mm.mutual.size;
    if (!best || score < best.score) best = { key, score, after: mm };
  }
  if (!best) break;
  const [a, b] = best.key.split(" -> ");
  const n = current.filter((e) => e.from === a && e.to === b).length;
  removed.push({ key: best.key, edges: n });
  current = current.filter((e) => !(e.from === a && e.to === b));
}
const finalM = metrics(current);
process.stdout.write(`\nGREEDY: removing ${removed.reduce((s, r) => s + r.edges, 0)} file edge(s) across ${removed.length} capability pair(s) reaches mutual ${finalM.mutual.size}, largest SCC ${finalM.largest.length}\n`);
for (const r of removed) process.stdout.write(`  ${String(r.edges).padStart(3)} edge(s)  ${r.key}\n`);
