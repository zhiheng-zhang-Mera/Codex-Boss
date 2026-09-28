/**
 * OFF-REPO WORKING TOOL (post-CC103 closeout, T4).
 *
 * The SCC / mutual-pair work is only tractable if there is a SMALL set of TARGET FILES whose re-homing (moving the
 * file to the capability that actually owns its vocabulary, or to a kernel) dissolves many cycles. This computes,
 * per target file, how many cyclic pairs it is the LAST edge of, i.e. the effect of making that file stop being
 * owned by its present capability.
 *
 * Purely exploratory: it applies a hypothetical ownership patch in memory and re-counts. Reader only.
 *
 * usage: node cycle-leverage.cjs [--top=25] [--plan=fileA,fileB]
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

function computeGraph(baseOwner) {
  const owner = new Map(baseOwner);
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
      if (from === to) continue;
      edges.push({ from, to, fromFile: file, toFile: target });
    }
  }
  const pairs = new Map();
  for (const e of edges) pairs.set(`${e.from} -> ${e.to}`, (pairs.get(`${e.from} -> ${e.to}`) ?? 0) + 1);
  const mutual = [];
  const seen = new Set();
  for (const key of pairs.keys()) {
    const [a, b] = key.split(" -> ");
    const rev = `${b} -> ${a}`;
    const k = [a, b].sort().join("|");
    if (seen.has(k)) continue;
    if (pairs.has(rev)) {
      seen.add(k);
      mutual.push(k);
    }
  }
  // SCC over the capability graph
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const adj = new Map(nodes.map((n) => [n, new Set()]));
  for (const e of edges) adj.get(e.from).add(e.to);
  let index = 0;
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], comps = [];
  const strongconnect = (v) => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      for (;;) { const w = stack.pop(); onStack.delete(w); comp.push(w); if (w === v) break; }
      comps.push(comp);
    }
  };
  for (const n of nodes) if (!idx.has(n)) strongconnect(n);
  const largest = comps.reduce((acc, c) => (c.length > acc.length ? c : acc), []);
  return { edges, pairs, mutual, largestScc: largest.length, sccMembers: largest };
}

// base ownership: capabilities only (roads/composition-root excluded, exactly as phase2-cycles does not add them)
const base = new Map();
for (const [cap, patterns] of Object.entries(map.capabilities ?? {})) for (const f of allFiles) if (ownsPath(patterns, f)) base.set(f, cap);
const roadConfig = JSON.parse(fs.readFileSync(path.join(REPO, "config", "capability-roads.json"), "utf8"));
const roadOwner = new Map(Object.entries(roadConfig.roads ?? {}).map(([f, e]) => [f, String(e.owner)]));
for (const f of allFiles) if (roadOwner.has(f)) base.set(f, roadOwner.get(f)); // roads: keep the owner, as the inventory does
const ROADFILES = new Set(roadOwner.keys());

const baseline = computeGraph(base);
process.stdout.write(`baseline: mutual pairs ${baseline.mutual.length}, largest SCC ${baseline.largestScc} ${JSON.stringify(baseline.sccMembers)}\n`);

const plan = (process.argv.find((a) => a.startsWith("--plan=")) ?? "").slice(7);
if (plan) {
  const files = plan.split(",").map((s) => s.trim()).filter(Boolean);
  const patched = new Map(base);
  for (const spec of files) {
    const [file, to] = spec.split("=>");
    patched.set(file.trim(), to.trim());
  }
  const after = computeGraph(patched);
  process.stdout.write(`\nPLAN (${files.length} file(s)):\n`);
  for (const f of files) process.stdout.write(`  ${f}\n`);
  process.stdout.write(`after: mutual pairs ${after.mutual.length} (was ${baseline.mutual.length}), largest SCC ${after.largestScc} (was ${baseline.largestScc})\n`);
  process.stdout.write(`  remaining SCC members: ${JSON.stringify(after.sccMembers)}\n`);
  process.exit(0);
}

// leverage: for each target file that is the LAST edge of >=1 cyclic pair, what happens if it moves to any owner
const mutualSet = new Set(baseline.mutual);
const rows = [];
const seenTargets = new Set();
for (const e of baseline.edges) {
  if (seenTargets.has(e.toFile)) continue;
  seenTargets.add(e.toFile);
  const test = new Map(base);
  // re-home the file to a 'moved' pseudo owner: any owner different from `to` removes every edge onto it from `to`
  test.set(e.toFile, "__MOVED__");
  const after = computeGraph(test);
  const delta = baseline.mutual.length - after.mutual.length;
  if (delta > 0 || after.largestScc < baseline.largestScc) {
    rows.push({ file: e.toFile, presentOwner: e.to, pairBroken: delta, sccAfter: after.largestScc, mutualAfter: after.mutual.length });
  }
}
rows.sort((a, b) => b.pairBroken - a.pairBroken || a.sccAfter - b.sccAfter);
const top = Number((process.argv.find((a) => a.startsWith("--top=")) ?? "--top=40").slice(6));
process.stdout.write(`\ntarget files whose re-homing changes the cycle metrics (of ${seenTargets.size} distinct targets): ${rows.length}\n`);
for (const r of rows.slice(0, top)) process.stdout.write(`  -${String(r.pairBroken).padStart(2)} pairs -> ${String(r.mutualAfter).padStart(2)} | scc ${r.sccAfter} | ${r.file}  (present owner ${r.presentOwner})\n`);
