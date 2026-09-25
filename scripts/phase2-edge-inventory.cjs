"use strict";
/**
 * PHASE 2 — the real cross-capability edge inventory (P2-A increment 2 / P2-B / P2-C preparation).
 *
 * READ-ONLY. Writes nothing. Prints to stdout, so the caller decides where it goes.
 *
 * WHY IT EXISTS
 *
 *   The manifests declare 25 module paths while the ownership map owns 597 files, so the architecture ratchet --
 *   which builds its capability graph from `modules` (`scripts/architecture.cjs:270-295`) -- reads 25 files and
 *   reports 3 declared edges. The moment the manifests declare their real surface, the ratchet reports the
 *   cross-capability edges that were invisible until then, and `architecture:ratchet` is a required step in the
 *   required `quality` job. This program measures that work list BEFORE it starts, so increment 2's size is known
 *   rather than discovered mid-migration.
 *
 *   The import pattern and the specifier resolution are the repository's own, copied verbatim from
 *   `scripts/architecture.cjs:256-266`, so this inventory and the ratchet cannot disagree about what an edge is.
 *   Disagreeing would be worse than either being wrong: the work list and the gate would measure two graphs.
 *
 * USAGE
 *
 *   node scripts/phase2-edge-inventory.cjs            human-readable summary
 *   node scripts/phase2-edge-inventory.cjs --json     the full inventory as JSON
 *
 * WHAT IT DOES NOT DO
 *
 *   It does not decide whether an edge is a defect. A capability PAIR is one design decision (declare it, invert
 *   it, or extract a road); the file edges are that decision's instances. Classifying them is P2-B/P2-C work, and
 *   this program stops at the measurement so the classification cannot be smuggled into the instrument.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveSpecifier(specifier, fromFile) {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(ROOT, path.dirname(fromFile), specifier);
  const withoutJs = base.endsWith(".js") ? base.slice(0, -3) : base;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${withoutJs}.ts`, `${withoutJs}.tsx`, path.join(base, "index.ts"), path.join(withoutJs, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.relative(ROOT, candidate).split(path.sep).join("/");
  }
  return undefined;
}

const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry.name))) out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

const { parse } = require(path.join(ROOT, "node_modules", "yaml"));
const map = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "capability-modules.json"), "utf8"));

/**
 * The composition root's owner id, from the map's third class.
 *
 * It is deliberately NOT a capability and has no manifest `kind`. The map records it so that the
 * composition root's imports stop being read as a KERNEL's imports of features: `electron/main.ts`
 * registers every capability's boot module, so its import of `electron/commander/**` is class-1
 * composition-root wiring, not `runtime` reaching into `tenx`.
 *
 * The edges are RE-ATTRIBUTED, never dropped. Deleting them would shrink the work list by hiding part
 * of it, which is the failure mode this instrument exists to prevent: the inventory's job is to say how
 * many cross-capability file edges exist and which of them are inversions, so a change of attribution
 * has to move the second number and leave the first one traceable.
 */
const COMPOSITION_ROOT = "<composition-root>";
const compositionRootEntries = Object.entries(map.composition_root ?? {});

// owner of every file, using the map's own prefix rule
function ownsPath(entries, file) {
  for (const entry of entries) {
    const normalized = String(entry).replace(/\\/g, "/").replace(/\/+$/, "");
    if (file === normalized || file.startsWith(`${normalized}/`)) return true;
  }
  return false;
}
const owner = new Map();
const allFiles = walk(path.join(ROOT, "electron")).concat(walk(path.join(ROOT, "src")));
for (const [capability, patterns] of Object.entries(map.capabilities)) {
  for (const file of allFiles) {
    if (ownsPath(patterns, file)) owner.set(file, capability);
  }
}
// The composition root wins over a capability claim, which the closure validator refuses outright; the
// precedence here only decides which way a future contradiction would be read, not whether one exists.
for (const file of allFiles) {
  if (compositionRootEntries.some(([entry]) => ownsPath([entry], file))) owner.set(file, COMPOSITION_ROOT);
}
const files = [...owner.keys()].sort();

// capability kinds from the manifests
const kinds = {};
const declaredModules = new Map();
for (const name of fs.readdirSync(path.join(ROOT, "config", "capabilities")).sort()) {
  if (!name.endsWith(".yaml")) continue;
  const doc = parse(fs.readFileSync(path.join(ROOT, "config", "capabilities", name), "utf8"));
  kinds[doc.id] = doc.kind;
  for (const module of doc.modules ?? []) declaredModules.set(module, doc.id);
}
/** Counted before the composition root is added, so the field keeps meaning "capabilities with a kind". */
const capabilitiesWithKinds = Object.keys(kinds).length;
// The composition root's kind is the repository's own name for the class and matches no manifest kind,
// so it can never satisfy a `kernel -> feature` test.
kinds[COMPOSITION_ROOT] = "composition-root";

// every cross-capability edge
const edges = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  const specifiers = new Set([...text.matchAll(IMPORT_PATTERN)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]).filter(Boolean));
  for (const specifier of specifiers) {
    const target = resolveSpecifier(specifier, file);
    if (!target || !owner.has(target)) continue;
    const from = owner.get(file);
    const to = owner.get(target);
    if (from === to) continue;
    edges.push({ from, to, fromFile: file, toFile: target, fromKind: kinds[from] ?? null, toKind: kinds[to] ?? null });
  }
}
edges.sort((a, b) => (a.from + a.to + a.fromFile).localeCompare(b.from + b.to + b.fromFile));

// capability-pair rollup
const pairs = new Map();
/** Up to three real edges per pair, so every count in the report can be traced to files without re-running it. */
const samplesByPair = new Map();
for (const edge of edges) {
  const key = `${edge.from} -> ${edge.to}`;
  pairs.set(key, (pairs.get(key) ?? 0) + 1);
  const samples = samplesByPair.get(key) ?? [];
  if (samples.length < 3) samples.push(`${edge.fromFile} -> ${edge.toFile}`);
  samplesByPair.set(key, samples);
}
const pairList = [...pairs.entries()]
  .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
  .map(([pair, count]) => ({ pair, count, samples: samplesByPair.get(pair) ?? [] }));

// kernel -> feature (P2-B's target)
const kernelToFeature = edges.filter((edge) => edge.fromKind === "kernel" && edge.toKind === "feature");
const kfPairs = new Map();
for (const edge of kernelToFeature) kfPairs.set(`${edge.from} -> ${edge.to}`, (kfPairs.get(`${edge.from} -> ${edge.to}`) ?? 0) + 1);

// mutual pairs (P2-C's 2-cycles)
const mutual = [];
const seen = new Set();
for (const { pair } of pairList) {
  const [a, b] = pair.split(" -> ");
  const reverse = `${b} -> ${a}`;
  if (seen.has(pair) || seen.has(reverse)) continue;
  if (pairs.has(reverse)) { mutual.push({ a, b, forward: pairs.get(pair), backward: pairs.get(reverse) }); seen.add(pair); seen.add(reverse); }
}

// what the manifests already declare vs what is real
const declaredCrossCapability = edges.filter((edge) => declaredModules.get(edge.fromFile) === edge.from && declaredModules.get(edge.toFile) === edge.to);
const declaredPairs = new Set();
for (const name of fs.readdirSync(path.join(ROOT, "config", "capabilities")).sort()) {
  if (!name.endsWith(".yaml")) continue;
  const doc = parse(fs.readFileSync(path.join(ROOT, "config", "capabilities", name), "utf8"));
  for (const requirement of [...(doc.requires ?? []), ...(doc.optional ?? [])]) {
    // A requirement ref names a NAMESPACE (`knowledge.store@1`); its owning capability is the first segment.
    declaredPairs.add(`${doc.id} -> ${String(requirement.ref).split("@")[0].split(".")[0]}`);
  }
}
const realPairs = new Set(pairList.map((entry) => entry.pair));
const declaredRealPairs = [...realPairs].filter((pair) => declaredPairs.has(pair));

// The composition root's own edges, counted separately so the re-attribution is a visible number rather
// than a silently smaller kernel -> feature total.
const compositionRootFiles = files.filter((file) => owner.get(file) === COMPOSITION_ROOT);
const edgesFromCompositionRoot = edges.filter((edge) => edge.from === COMPOSITION_ROOT);
const edgesToCompositionRoot = edges.filter((edge) => edge.to === COMPOSITION_ROOT);

const report = {
  schema: "city-phase2-edge-inventory/1",
  measured: {
    filesOwned: files.length,
    capabilitiesWithKinds,
    declaredModulePaths: declaredModules.size,
    declaredRequirementPairs: declaredPairs.size,
    compositionRootFiles: compositionRootFiles.length,
  },
  edges: {
    totalCrossCapabilityFileEdges: edges.length,
    distinctCapabilityPairs: pairList.length,
    kernelToFeatureFileEdges: kernelToFeature.length,
    kernelToFeaturePairs: kfPairs.size,
    mutualCapabilityPairs: mutual.length,
    fullyDeclaredCrossCapabilityEdges: declaredCrossCapability.length,
    realPairsAlreadyDeclared: declaredRealPairs.length,
    realPairsUndeclared: realPairs.size - declaredRealPairs.length,
    edgesFromCompositionRoot: edgesFromCompositionRoot.length,
    edgesToCompositionRoot: edgesToCompositionRoot.length,
  },
  topPairs: pairList.slice(0, 60),
  // The FULL pair list, because `topPairs` is truncated to 60 for the human summary and `--json` is documented
  // as "the full inventory". A consumer that needs the whole capability graph -- the cycle/SCC validator does --
  // would otherwise silently receive 60 of 193 and compute SCCs on a graph with two thirds of its edges missing,
  // which reports FEWER cycles than exist. Counts only: the samples stay in `topPairs`, where they are for a
  // reader rather than for a computation.
  allPairs: pairList.map(({ pair, count }) => ({ pair, count })),
  kernelToFeaturePairs: [...kfPairs.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).map(([pair, count]) => ({ pair, count })),
  mutualPairs: mutual,
  declaredRequirementPairs: [...declaredPairs].sort(),
  sampleKernelToFeatureEdges: kernelToFeature.slice(0, 40).map((edge) => `${edge.fromFile} -> ${edge.toFile}  (${edge.from} -> ${edge.to})`),
};

const asJson = process.argv.includes("--json");

/** The human summary. Pure, so requiring this module prints nothing. */
function render(report) {
  const { measured, edges: counts } = report;
  return [
    `[p2-edges] owned files ${measured.filesOwned}; manifests declare ${measured.declaredModulePaths} module paths`,
    `[p2-edges] composition root: ${measured.compositionRootFiles} file(s), ${counts.edgesFromCompositionRoot} outgoing edge(s), ${counts.edgesToCompositionRoot} incoming  (reattributed, not removed)`,
    `[p2-edges] cross-capability file edges ${counts.totalCrossCapabilityFileEdges} over ${counts.distinctCapabilityPairs} pairs`,
    `[p2-edges] kernel -> feature: ${counts.kernelToFeatureFileEdges} edges over ${counts.kernelToFeaturePairs} pairs  (P2-B target: 0)`,
    `[p2-edges] mutual pairs: ${counts.mutualCapabilityPairs}  (P2-C target: 0)`,
    `[p2-edges] pairs already declared: ${counts.realPairsAlreadyDeclared} of ${counts.distinctCapabilityPairs}  (undeclared ${counts.realPairsUndeclared})`,
    "[p2-edges] largest kernel -> feature pairs:",
    ...report.kernelToFeaturePairs.slice(0, 10).map((entry) => `[p2-edges]   ${String(entry.count).padStart(3)}  ${entry.pair}`),
  ].join("\n");
}

// Printing is guarded on being the ENTRY POINT: a module that chats when it is required cannot be used by a test.
if (require.main === module) {
  process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : `${render(report)}\n`);
}

module.exports = { render, report, ownsPath, resolveSpecifier };
