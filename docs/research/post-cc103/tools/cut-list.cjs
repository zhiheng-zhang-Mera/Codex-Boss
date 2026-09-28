"use strict";
/**
 * The cheapest-first cut list for the 31 mutually dependent capability pairs, costed from the repository's own
 * `scripts/phase2-pair-edges.cjs` scan and `scripts/phase2-cycles.cjs` cycle report.
 *
 * Breaking a 2-cycle requires removing the edges of ONE direction, so for each pair the CHEAPER direction is chosen
 * and its source files are listed. That is the unit of work: a file that must be re-pointed, moved or removed.
 */
const path = require("node:path");
const REPO = process.cwd();
const j = require(path.join(REPO, "scripts", "phase2-pair-edges.cjs")).scan();
const cycles = require(path.join(REPO, "scripts", "phase2-cycles.cjs")).report;

const counts = new Map();
for (const e of j.edges) counts.set(e.from + " -> " + e.to, (counts.get(e.from + " -> " + e.to) ?? 0) + 1);

const seen = new Set();
const rows = [];
for (const p of cycles.mutualPairs) {
  const [a, b] = p.split(" -> ");
  const key = [a, b].sort().join("|");
  if (seen.has(key)) continue;
  seen.add(key);
  const ab = counts.get(a + " -> " + b) ?? 0;
  const ba = counts.get(b + " -> " + a) ?? 0;
  const small = ab <= ba ? { from: a, to: b, n: ab } : { from: b, to: a, n: ba };
  const files = [...new Set(j.edges.filter((e) => e.from === small.from && e.to === small.to).map((e) => e.fromFile))];
  const viaShared = files.filter((f) => f.startsWith("src/shared/")).length;
  rows.push({ pair: key, ab, ba, cutFrom: small.from, cutTo: small.to, cost: small.n, files, viaShared });
}
rows.sort((x, y) => x.cost - y.cost || x.pair.localeCompare(y.pair));

console.log("cheapest-first cut list over " + rows.length + " mutually dependent pairs");
console.log("cost = file edges to remove from the cheaper direction; files = the source files carrying them");
console.log("");
let total = 0;
for (const r of rows) {
  total += r.cost;
  console.log(String(r.cost).padStart(3) + "  " + r.pair.padEnd(26) + " cut " + (r.cutFrom + " -> " + r.cutTo).padEnd(26) + " " + r.files.length + " file(s), " + r.viaShared + " in src/shared");
  for (const f of r.files.slice(0, 4)) console.log("        " + f);
  if (r.files.length > 4) console.log("        ... " + (r.files.length - 4) + " more");
}
console.log("");
console.log("TOTAL file edges to break every 2-cycle: " + total);
console.log("largest SCC: " + cycles.largestSccSize + " of " + cycles.capabilityNodes + " nodes; capability edges " + cycles.capabilityEdges);
