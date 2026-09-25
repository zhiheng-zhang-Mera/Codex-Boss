#!/usr/bin/env node
/**
 * PHASE 2 — the per-PAIR edge inspector (P2-B / P2-C / P2-D decision input).
 *
 * WHY IT EXISTS
 *
 *   `scripts/phase2-edge-inventory.cjs` answers "how many" and deliberately stops there: it publishes 193 pair
 *   COUNTS and at most three sample edges per pair, because not deciding is what keeps the classification out of
 *   the instrument. But the work of docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md sections 16 and 17 is
 *   per-PAIR and per-EDGE: a pair is one
 *   design decision (declare it, invert it, or extract a road), and that decision cannot be made from a count. The
 *   gap this program fills is exactly that: given a pair, print every edge in it with its file, its LINE, the raw
 *   import specifier, and the shape of the targets.
 *
 *   It answers the four questions a decision needs and nothing more:
 *
 *     1  which files make up this pair, and what does each one import?
 *     2  do the edges point at ONE directory or at scattered files? (If one directory, the minimum stable closure
 *        of section 15.3 is that directory; if scattered, no extraction can be bounded.)
 *     3  is the pair MUTUAL, and if so which direction carries the larger count?
 *     4  is the target owned by the capability the manifests already declare as a dependency for the source?
 *
 * IT CANNOT DISAGREE WITH THE INVENTORY
 *
 *   The counts decide whether a migration is finished, so an inspector that counted differently from the ratchet
 *   would be worse than useless -- a reviewer would act on one number while CI enforced another. `--verify`
 *   therefore re-derives the whole edge set and asserts equality with the inventory on ALL of: files owned, total
 *   cross-capability edges, distinct pairs, kernel -> feature edges, kernel -> feature pairs, mutual pairs, the two
 *   composition-root counts, and every one of the 193 per-pair counts. Any divergence fails loudly.
 *
 *   The import pattern is copied VERBATIM from the inventory (which in turn copies it from the architecture
 *   ratchet), because `IMPORT_PATTERN` is not exported and a re-derived regex is the one place the two could
 *   drift. `--verify` is what makes that copy safe rather than hopeful.
 *
 * READ-ONLY. Writes nothing.
 *
 * USAGE
 *
 *   node scripts/phase2-pair-edges.cjs --verify
 *   node scripts/phase2-pair-edges.cjs "persistence -> tasks"
 *   node scripts/phase2-pair-edges.cjs --kernel-to-feature
 *   node scripts/phase2-pair-edges.cjs --json
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ROAD = "<road>";
const inventory = require(path.join(ROOT, "scripts", "phase2-edge-inventory.cjs"));
const { ownsPath, resolveSpecifier } = inventory;

// Copied VERBATIM from scripts/phase2-edge-inventory.cjs:36, which copies it from scripts/architecture.cjs.
const IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

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

/** Line number of a byte offset, so the report points at a place a reviewer can open. */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

function scan() {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "capability-modules.json"), "utf8"));
  const { parse } = require(path.join(ROOT, "node_modules", "yaml"));

  const kinds = {};
  const declaredModules = new Map();
  const declaredDependencies = new Map();
  for (const name of fs.readdirSync(path.join(ROOT, "config", "capabilities")).sort()) {
    if (!name.endsWith(".yaml")) continue;
    const doc = parse(fs.readFileSync(path.join(ROOT, "config", "capabilities", name), "utf8"));
    kinds[doc.id] = doc.kind;
    for (const module of doc.modules ?? []) declaredModules.set(module, doc.id);
    declaredDependencies.set(
      doc.id,
      new Set([...(doc.requires ?? []), ...(doc.optional ?? [])].map((requirement) => String(requirement.ref ?? requirement).split("@")[0].split(".")[0])),
    );
  }
  const capabilitiesWithKinds = Object.keys(kinds).length;

  const COMPOSITION_ROOT = "<composition-root>";
  const compositionRootEntries = Object.entries(map.composition_root ?? {});
  kinds[COMPOSITION_ROOT] = "composition-root";

  const owner = new Map();
  const allFiles = walk(path.join(ROOT, "electron")).concat(walk(path.join(ROOT, "src")));
  for (const [capability, patterns] of Object.entries(map.capabilities)) {
    for (const file of allFiles) if (ownsPath(patterns, file)) owner.set(file, capability);
  }
  // Roads mirror the inventory EXACTLY: attributed before the composition root, and the road's own building is not
  // a consumer of it. `--verify` compares this against the inventory pair by pair, so a difference in these lines
  // would surface as a disagreement rather than as two plausible numbers.
  const roadsPath = path.join(ROOT, "config", "capability-roads.json");
  const roadConfig = fs.existsSync(roadsPath) ? JSON.parse(fs.readFileSync(roadsPath, "utf8")) : { roads: {} };
  const roadOwner = new Map(Object.entries(roadConfig.roads ?? {}).map(([file, entry]) => [file, String(entry.owner)]));
  kinds[ROAD] = "road";
  for (const file of allFiles) if (roadOwner.has(file)) owner.set(file, ROAD);
  for (const file of allFiles) {
    if (compositionRootEntries.some(([entry]) => ownsPath([entry], file))) owner.set(file, COMPOSITION_ROOT);
  }
  const files = [...owner.keys()].sort();

  const edges = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    // THE UNIT OF MEASUREMENT, and the first thing `--verify` caught: the inventory counts each DISTINCT SPECIFIER
    // once per source file (`new Set([...matchAll])`), not each import statement. So an edge is a (file, specifier)
    // pair, and a file that imports the same module twice -- as a type and as a value, which this repository does --
    // is ONE edge. Counting statements instead gave 867 edges against the inventory's 801, and 84 kernel -> feature
    // against 73. Section 16's target of zero (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md) is in the inventory's currency, so a work list in any other currency
    // would over-scope the migration. The line recorded is the FIRST occurrence.
    const seen = new Map();
    for (const match of text.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (!specifier) continue;
      if (seen.has(specifier)) continue;
      seen.set(specifier, lineAt(text, match.index ?? 0));
    }
    for (const [specifier, line] of seen) {
      const target = resolveSpecifier(specifier, file);
      if (!target || !owner.has(target)) continue;
      const from = owner.get(file);
      const to = owner.get(target);
      // Same rule as the inventory, and for the same reason: a road stays physically inside its building, so an
      // import from that building of its own road is internal and must not become a cross-capability edge.
      const effectiveTo = to === ROAD ? roadOwner.get(target) : to;
      if (from === effectiveTo) continue;
      edges.push({
        pair: `${from} -> ${to}`,
        from,
        to,
        fromFile: file,
        toFile: target,
        specifier,
        line,
        fromKind: kinds[from] ?? null,
        toKind: kinds[to] ?? null,
        declared: (declaredDependencies.get(from) ?? new Set()).has(to),
        targetDeclaredModule: declaredModules.get(target) ?? null,
      });
    }
  }

  const { pairCounts, totals } = summarise(edges);

  // The three totals that are NOT derivable from the edge list alone: they compare the real graph against what the
  // MANIFESTS declare. They are computed here and cross-checked by `--verify`, but they cannot be re-summarised
  // from edges, which is why `verify` distinguishes the two kinds instead of pretending every key is recomputable.
  const declaredCrossCapability = edges.filter((edge) => declaredModules.get(edge.fromFile) === edge.from && declaredModules.get(edge.toFile) === edge.to);
  const declaredPairSet = new Set();
  for (const [capability, dependencies] of declaredDependencies) {
    for (const dependency of dependencies) declaredPairSet.add(`${capability} -> ${dependency}`);
  }
  const realPairs = new Set(edges.map((edge) => edge.pair));
  const declaredRealPairs = [...realPairs].filter((pair) => declaredPairSet.has(pair));
  totals.fullyDeclaredCrossCapabilityEdges = declaredCrossCapability.length;
  totals.realPairsAlreadyDeclared = declaredRealPairs.length;
  totals.realPairsUndeclared = realPairs.size - declaredRealPairs.length;

  const compositionRootFiles = files.filter((file) => owner.get(file) === COMPOSITION_ROOT);
  return {
    schema: "city-phase2-pair-edges/1",
    measured: {
      filesOwned: files.length,
      capabilitiesWithKinds,
      declaredModulePaths: declaredModules.size,
      compositionRootFiles: compositionRootFiles.length,
    },
    totals,
    edges,
    pairCounts,
  };
}

/**
 * Summarise an edge list. The ONE place the totals are computed, so that `--verify` can re-summarise the edges it
 * was handed and compare that against both the summary it was handed and the inventory's. Without the recomputation
 * the gate compared a script's summary against the same script's edges and could not notice a mutation of the edges
 * at all -- which the falsification cases caught.
 */
function summarise(edges) {
  const COMPOSITION_ROOT = "<composition-root>";
  const pairCounts = new Map();
  for (const edge of edges) pairCounts.set(edge.pair, (pairCounts.get(edge.pair) ?? 0) + 1);
  const kernelToFeature = edges.filter((edge) => edge.fromKind === "kernel" && edge.toKind === "feature");
  const mutual = [];
  const seen = new Set();
  for (const pair of pairCounts.keys()) {
    const [a, b] = pair.split(" -> ");
    const reverse = `${b} -> ${a}`;
    if (seen.has(pair) || seen.has(reverse)) continue;
    if (pairCounts.has(reverse)) {
      mutual.push({ a, b, forward: pairCounts.get(pair), backward: pairCounts.get(reverse) });
      seen.add(pair);
      seen.add(reverse);
    }
  }
  return {
    pairCounts,
    totals: {
      totalCrossCapabilityFileEdges: edges.length,
      distinctCapabilityPairs: pairCounts.size,
      kernelToFeatureFileEdges: kernelToFeature.length,
      kernelToFeaturePairs: new Set(kernelToFeature.map((edge) => edge.pair)).size,
      mutualCapabilityPairs: mutual.length,
      edgesFromCompositionRoot: edges.filter((edge) => edge.from === COMPOSITION_ROOT).length,
      edgesToCompositionRoot: edges.filter((edge) => edge.to === COMPOSITION_ROOT).length,
      edgesToRoads: edges.filter((edge) => edge.to === ROAD).length,
      edgesFromRoads: edges.filter((edge) => edge.from === ROAD).length,
    },
  };
}

/** The totals that can be recomputed from an edge list alone. The manifest-derived ones cannot, and are named here
 * so that `--verify` treats the two kinds differently instead of pretending every key is recomputable. */
const RECOMPUTABLE = new Set([
  "totalCrossCapabilityFileEdges",
  "distinctCapabilityPairs",
  "kernelToFeatureFileEdges",
  "kernelToFeaturePairs",
  "mutualCapabilityPairs",
  "edgesFromCompositionRoot",
  "edgesToCompositionRoot",
  "edgesToRoads",
  "edgesFromRoads",
]);

/** Everything `--verify` compares, so the list cannot silently shrink. */
function verify(scanResult) {
  const report = inventory.report;
  const problems = [];
  const recomputed = summarise(scanResult.edges);

  for (const [key, value] of Object.entries(scanResult.measured)) {
    if (report.measured[key] !== value) problems.push(`measured.${key}: inventory ${report.measured[key]}, inspector ${value}`);
  }
  // The UNION of keys, so a total this inspector does not compute cannot be silently unchecked. Iterating only over
  // the inspector's own keys is how `edgesToRoads` and `edgesFromRoads` went unnoticed when the inventory grew
  // them: the loop simply never asked about them.
  const totalKeys = new Set([...Object.keys(report.edges), ...Object.keys(scanResult.totals)]);
  for (const key of totalKeys) {
    const value = scanResult.totals[key];
    if (value === undefined) {
      problems.push(`edges.${key}: the inventory publishes it (${report.edges[key]}) and this inspector does not compute it at all`);
      continue;
    }
    if (RECOMPUTABLE.has(key) && recomputed.totals[key] !== value) {
      problems.push(`edges.${key}: the edge list re-summarises to ${recomputed.totals[key]}, but the scan reported ${value}`);
    }
    if (report.edges[key] !== value) problems.push(`edges.${key}: inventory ${report.edges[key]}, inspector ${value}`);
  }
  const pairs = new Set([...report.allPairs.map((entry) => entry.pair), ...scanResult.pairCounts.keys()]);
  let mismatchedPairs = 0;
  for (const pair of pairs) {
    const expected = report.allPairs.find((entry) => entry.pair === pair)?.count ?? 0;
    const actual = scanResult.pairCounts.get(pair) ?? 0;
    const recomputedCount = recomputed.pairCounts.get(pair) ?? 0;
    if (actual !== recomputedCount) {
      mismatchedPairs += 1;
      if (mismatchedPairs <= 5) problems.push(`pair ${pair}: the edge list holds ${recomputedCount}, but the scan reported ${actual}`);
      continue;
    }
    if (expected !== actual) {
      mismatchedPairs += 1;
      if (mismatchedPairs <= 5) problems.push(`pair ${pair}: inventory ${expected}, inspector ${actual}`);
    }
  }
  return {
    schema: "city-phase2-pair-edges-verification/1",
    ok: problems.length === 0,
    pairsCompared: pairs.size,
    edgesCompared: scanResult.edges.length,
    mismatchedPairs,
    problems,
  };
}

/** The shape of a pair's targets: one directory means a bounded closure, scattered means it has none. */
function closureOf(edges) {
  const directories = [...new Set(edges.map((edge) => path.posix.dirname(edge.toFile)))].sort();
  const targets = [...new Set(edges.map((edge) => edge.toFile))].sort();
  let common = directories[0] ?? "";
  for (const directory of directories) {
    while (common && !(directory === common || directory.startsWith(`${common}/`))) common = path.posix.dirname(common) === "." ? "" : path.posix.dirname(common);
  }
  return { directories, targets, commonDirectory: common };
}

function renderPair(scanResult, pair) {
  const edges = scanResult.edges.filter((edge) => edge.pair === pair).sort((a, b) => a.fromFile.localeCompare(b.fromFile) || a.line - b.line);
  const lines = [];
  if (edges.length === 0) {
    lines.push(`[pair] ${pair}: no edge. Distinct pairs here: ${scanResult.pairCounts.size}`);
    return lines.join("\n");
  }
  const { directories, targets, commonDirectory } = closureOf(edges);
  const reverseKey = pair.split(" -> ").reverse().join(" -> ");
  const reverse = scanResult.pairCounts.get(reverseKey) ?? 0;
  lines.push(`[pair] ${pair}   ${edges.length} edge(s)   kinds ${edges[0].fromKind} -> ${edges[0].toKind}${reverse > 0 ? `   MUTUAL (reverse ${reverse})` : ""}`);
  lines.push(`[pair] source files ${new Set(edges.map((edge) => edge.fromFile)).size}; target files ${targets.length}; target directories ${directories.length}; common directory ${commonDirectory || "(none -- no bounded closure)"}`);
  const declared = edges.filter((edge) => edge.declared).length;
  lines.push(`[pair] the source manifest declares this dependency on ${declared} of ${edges.length} edge(s)`);
  for (const edge of edges) {
    lines.push(`[pair]   ${edge.fromFile}:${edge.line}  imports "${edge.specifier}"  ->  ${edge.toFile}${edge.targetDeclaredModule ? "  (declared module)" : ""}`);
  }
  for (const directory of directories) {
    lines.push(`[pair]   directory ${directory}: ${edges.filter((edge) => path.posix.dirname(edge.toFile) === directory).length} target file(s)`);
  }
  return lines.join("\n");
}

function renderKernelToFeature(scanResult) {
  const kf = scanResult.edges.filter((edge) => edge.fromKind === "kernel" && edge.toKind === "feature");
  const byPair = new Map();
  for (const edge of kf) {
    const entry = byPair.get(edge.pair) ?? { count: 0, edges: [] };
    entry.count += 1;
    entry.edges.push(edge);
    byPair.set(edge.pair, entry);
  }
  const lines = [`[pair] kernel -> feature: ${kf.length} edge(s) over ${byPair.size} pair(s)`];
  const ordered = [...byPair.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  for (const [pair, entry] of ordered) {
    const { directories, commonDirectory } = closureOf(entry.edges);
    lines.push(`[pair]   ${pair.padEnd(28)} ${String(entry.count).padStart(3)} edge(s)  ${String(directories.length).padStart(2)} target dir(s)  common ${commonDirectory || "(none)"}`);
  }
  return lines.join("\n");
}

/**
 * The evidence docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md sections 16 and 19 both turn on: for every file a KERNEL imports across a capability
 * boundary, who ELSE imports it?
 *
 * A target imported by one capability is that capability's private code and the edge is a real inversion. A target
 * imported by many capabilities, in both directions of the kernel/feature split, is shared surface, and the
 * question becomes which class should OWN it -- not whether the edge is real. This prints the measurement; it
 * deliberately does not make the call, because the call is the architecture decision.
 */
function renderKernelTargets(scanResult) {
  const kf = scanResult.edges.filter((edge) => edge.fromKind === "kernel" && edge.toKind === "feature");
  const targets = new Map();
  for (const edge of kf) {
    const entry = targets.get(edge.toFile) ?? { toFile: edge.toFile, to: edge.to, fromKernels: new Set(), edges: 0 };
    entry.fromKernels.add(edge.from);
    entry.edges += 1;
    targets.set(edge.toFile, entry);
  }
  const importers = new Map();
  for (const edge of scanResult.edges) {
    const set = importers.get(edge.toFile) ?? new Set();
    set.add(edge.from);
    importers.set(edge.toFile, set);
  }
  const lines = [`[pair] ${targets.size} file(s) are imported ACROSS a capability boundary by a kernel`];
  const ordered = [...targets.values()].sort((a, b) => (importers.get(b.toFile)?.size ?? 0) - (importers.get(a.toFile)?.size ?? 0) || a.toFile.localeCompare(b.toFile));
  for (const entry of ordered) {
    const all = [...(importers.get(entry.toFile) ?? new Set())].sort();
    lines.push(`[pair]   ${entry.toFile}  owned by ${entry.to}; imported by ${all.length} capabilit(ies): ${all.join(", ")}`);
    lines.push(`[pair]     ${entry.edges} kernel edge(s) from ${[...entry.fromKernels].sort().join(", ")}${all.every((capability) => capability === entry.to) ? "  -- PRIVATE to its owner" : ""}`);
  }
  return lines.join("\n");
}

/**
 * ROAD CANDIDATES -- the measured input to docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 19 (P2-E) and section 15.8.
 *
 * Section 22 says "shared road != automatic Core" and section 15.8 asks for an explicit road classification, but
 * the workbook never says how to tell a road from a building that is merely popular. The single measurement that
 * separates them was established by ledger CC-030, which REFUTED labelling `electron/commander/**` a road: a road
 * that imports a kernel is not a road, it is a feature with a lot of callers, and relabelling it would have HIDDEN
 * 39 edges onto kernels rather than classifying them.
 *
 * So the test here is LEAFNESS: does the candidate import any OTHER capability?
 *
 *   LEAF      imported across a boundary by two or more capabilities, and imports no other capability.
 *             Its own capability is the only thing that can be said about it, and every importer's edge onto it is
 *             an attribution question rather than an inversion.
 *   NOT LEAF  it reaches into other capabilities, so the CC-030 refutation applies and the repair is extraction.
 *
 * Deliberately NOT measured: file size. Section 15.2 says size is not itself a defect signal, so a candidate list
 * sorted by line count would encode the very rule the workbook forbids.
 */
function renderRoadCandidates(scanResult) {
  const importers = new Map();
  const outgoing = new Map();
  for (const edge of scanResult.edges) {
    const set = importers.get(edge.toFile) ?? { capabilities: new Set(), owners: new Set(), kernelEdges: 0, via: [] };
    set.capabilities.add(edge.from);
    if (edge.fromKind === "kernel") {
      set.kernelEdges += 1;
      set.via.push(`${edge.from}:${edge.fromFile}`);
    }
    importers.set(edge.toFile, set);
    const out = outgoing.get(edge.fromFile) ?? new Set();
    out.add(edge.to);
    outgoing.set(edge.fromFile, out);
  }
  const ownerOf = new Map();
  for (const edge of scanResult.edges) ownerOf.set(edge.toFile, edge.to);

  const candidates = [...importers.entries()]
    .filter(([, entry]) => entry.capabilities.size >= 2)
    .map(([file, entry]) => {
      const reaches = [...(outgoing.get(file) ?? new Set())].sort();
      return { file, owner: ownerOf.get(file) ?? null, importers: [...entry.capabilities].sort(), kernelEdges: entry.kernelEdges, leaf: reaches.length === 0, reaches };
    })
    .sort((a, b) => b.importers.length - a.importers.length || a.file.localeCompare(b.file));

  const leaves = candidates.filter((entry) => entry.leaf);
  const lines = [];
  lines.push(`[pair] ROAD CANDIDATES -- files imported across a capability boundary by 2 or more capabilities`);
  lines.push(`[pair] ${candidates.length} candidate(s); ${leaves.length} are LEAVES (import no other capability)`);
  lines.push(`[pair] kernel -> feature edge(s) landing on LEAVES: ${leaves.reduce((sum, entry) => sum + entry.kernelEdges, 0)}`);
  for (const entry of candidates) {
    lines.push(`[pair]   ${entry.leaf ? "LEAF    " : "NOT LEAF"} ${entry.file}  owned by ${entry.owner}`);
    lines.push(`[pair]     imported by ${entry.importers.length} capabilit(ies): ${entry.importers.join(", ")}`);
    lines.push(`[pair]     ${entry.kernelEdges} kernel edge(s)${entry.leaf ? "" : `; reaches ${entry.reaches.join(", ")}`}`);
  }
  return lines.join("\n");
}

function main(argv) {
  const result = scan();
  if (argv.includes("--verify")) {
    const verification = verify(result);
    if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    else {
      process.stdout.write(`[pair] compared ${verification.edgesCompared} edge(s) over ${verification.pairsCompared} pair(s) against the inventory\n`);
      if (verification.ok) process.stdout.write("[pair] VERDICT=AGREES (this inspector and the inventory measure the same graph, pair by pair)\n");
      else {
        process.stdout.write(`[pair] VERDICT=DISAGREES (${verification.problems.length} difference(s))\n`);
        for (const problem of verification.problems) process.stdout.write(`[pair]   - ${problem}\n`);
      }
    }
    return verification.ok ? 0 : 1;
  }
  if (argv.includes("--kernel-to-feature")) {
    process.stdout.write(`${renderKernelToFeature(result)}\n`);
    return 0;
  }
  if (argv.includes("--kernel-targets")) {
    process.stdout.write(`${renderKernelTargets(result)}\n`);
    return 0;
  }
  if (argv.includes("--road-candidates")) {
    process.stdout.write(`${renderRoadCandidates(result)}\n`);
    return 0;
  }
  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ ...result, pairCounts: Object.fromEntries(result.pairCounts) }, null, 2)}\n`);
    return 0;
  }
  const pair = argv.find((argument) => argument.includes(" -> "));
  if (!pair) {
    process.stdout.write(`${renderKernelToFeature(result)}\n`);
    process.stdout.write("[pair] pass a pair such as \"persistence -> tasks\", or --verify, --kernel-to-feature, --json\n");
    return 0;
  }
  const found = renderPair(result, pair);
  process.stdout.write(`${found}\n`);
  return found.includes("no edge.") ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`phase2-pair-edges failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, scan, verify, closureOf, renderPair, renderKernelToFeature, renderKernelTargets, renderRoadCandidates, IMPORT_PATTERN };
