/**
 * OFF-REPO WORKING TOOL (post-CC103 closeout, T4 hypothesis test).
 *
 * The decisive question for this round: how much of the 31 mutual capability pairs and the 18-node largest SCC is
 * caused by `src/shared/**` being owned by feature capabilities, and how much survives when it is not?
 *
 * It patches the ownership map IN MEMORY (every src/shared file a kernel reaches becomes FOUNDATION, so the edge
 * becomes kernel -> foundation and disappears from the S2 count) and re-computes the capability graph, the mutual
 * pairs and the SCCs with the same edge rule `scripts/phase2-edge-inventory.cjs` uses.
 *
 * Reader only; nothing on disk changes.
 *
 * usage: node scc-shared-hypothesis.cjs
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
const COMPOSITION_ROOT = "<composition-root>";
const base = new Map();
for (const [cap, patterns] of Object.entries(map.capabilities ?? {})) for (const f of allFiles) if (ownsPath(patterns, f)) base.set(f, cap);
for (const [entry] of Object.entries(map.compositionRoot ?? {})) for (const f of allFiles) if (ownsPath([entry], f)) base.set(f, COMPOSITION_ROOT);

function graph(own) {
  const edges = [];
  for (const file of [...own.keys()].sort()) {
    const from = own.get(file);
    if (from === COMPOSITION_ROOT) continue;
    const text = fs.readFileSync(path.join(REPO, file), "utf8");
    for (const m of text.matchAll(IMPORT_RE)) {
      const s = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!s) continue;
      const target = inv.resolveSpecifier(s, file);
      if (!target || !own.has(target)) continue;
      const to = own.get(target);
      if (to === COMPOSITION_ROOT || from === to) continue;
      edges.push({ from, to, fromFile: file, toFile: target });
    }
  }
  const pairs = new Map();
  for (const e of edges) pairs.set(`${e.from} -> ${e.to}`, (pairs.get(`${e.from} -> ${e.to}`) ?? 0) + 1);
  const mutual = new Set();
  for (const k of pairs.keys()) {
    const [a, b] = k.split(" -> ");
    if (pairs.has(`${b} -> ${a}`)) mutual.add([a, b].sort().join("|"));
  }
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const adj = new Map(nodes.map((n) => [n, new Set()]));
  for (const e of edges) adj.get(e.from).add(e.to);
  let i = 0; const idx = new Map(), low = new Map(), on = new Set(), st = [], comps = [];
  const go = (v) => {
    idx.set(v, i); low.set(v, i); i++; st.push(v); on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) { go(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) { const c = []; for (;;) { const w = st.pop(); on.delete(w); c.push(w); if (w === v) break; } comps.push(c); }
  };
  for (const n of nodes) if (!idx.has(n)) go(n);
  const largest = comps.reduce((a, c) => (c.length > a.length ? c : a), []);
  const kernelToFeature = edges.filter((e) => kinds.get(e.from) === "kernel" && kinds.get(e.to) === "feature");
  return { edges, pairs, mutual, nodes, largest, kernelToFeature };
}

const g0 = graph(base);
process.stdout.write(`BASELINE: edges ${g0.edges.length}, pairs ${g0.pairs.size}, mutual ${g0.mutual.size}, largest SCC ${g0.largest.length}, kernel->feature ${g0.kernelToFeature.length}\n`);

// Patch: every src/shared file reached by a kernel becomes FOUNDATION (removed from the capability graph entirely).
for (const label of ["FOUNDATION-KERNEL-REACHED", "FOUNDATION-ALL-SHARED"]) {
  const own = new Map(base);
  let moved = 0;
  if (label === "FOUNDATION-KERNEL-REACHED") {
    const reached = new Set(g0.kernelToFeature.filter((e) => e.toFile.startsWith("src/shared/")).map((e) => e.toFile));
    for (const f of reached) { own.delete(f); moved++; }
  } else {
    for (const f of [...own.keys()]) if (f.startsWith("src/shared/")) { own.delete(f); moved++; }
  }
  const g = graph(own);
  process.stdout.write(`\nPATCH ${label} (${moved} file(s) leave the capability graph):\n`);
  process.stdout.write(`  edges ${g.edges.length}, pairs ${g.pairs.size}, mutual ${g.mutual.size}, largest SCC ${g.largest.length}, kernel->feature ${g.kernelToFeature.length}\n`);
  process.stdout.write(`  SCC members: ${JSON.stringify([...g.largest].sort())}\n`);
}
