#!/usr/bin/env node
/**
 * THE P2-B / P2-C REGRESSION RATCHET (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md: "Add a machine check
 * so this cannot silently regress"; the same workbook's next section for the cycle half).
 *
 * WHY IT IS A SEPARATE PROGRAM
 *
 *   `scripts/phase2-edge-inventory.cjs` measures and refuses to judge -- its own header says so: "It does not
 *   decide whether an edge is a defect ... this program stops at the measurement so the classification cannot be
 *   smuggled into the instrument." A ratchet IS a judgement, so it lives here instead. Splitting them keeps the
 *   instrument reusable by a report that has not yet decided anything, and keeps the threshold in one place that
 *   a reader can find.
 *
 * WHAT IT ADDS THAT THE LEGACY RATCHET CANNOT
 *
 *   `scripts/architecture.cjs ratchet` reads the MANIFESTS, which declare 25 module paths, so it sees 3
 *   capability edges and reports no violation while 82 kernel -> feature edges exist in the real graph. The
 *   legacy ratchet is not wrong; it is measuring a different tree. This one reads the OWNERSHIP MAP (597 files)
 *   through the inventory and therefore sees the edges the workbook's foundation/building rule is about.
 *
 * WHAT IT REFUSES TO LET HAPPEN
 *
 *   1  the kernel -> feature count RISING above the recorded value;
 *   2  the mutual-pair count rising above its recorded value;
 *   3  progress that comes from SCANNING FEWER FILES: `files_owned` has a floor, so a file cannot be deleted
 *      from the map -- or handed to the composition-root class to make it invisible -- to make the migration
 *      look finished;
 *   4  a KERNEL LOSING ITS KIND, which would silently stop it being counted, pinned by the kind count;
 *   5  the COMPOSITION ROOT being counted as a kernel, or disappearing.
 *
 * WHAT IT DOES NOT DO
 *
 *   It does not repair anything, rank the surviving inversions, or decide which of them is a genuine inversion
 *   rather than a misattribution. It records a floor and refuses a silent regression. Driving the number DOWN is
 *   the migration's work, and the case that reports an improvement is there so lowering the recorded value is
 *   the obvious next act rather than a discovery.
 *
 * READ-ONLY. Writes nothing; prints its decision and exits non-zero when the floor is violated.
 *
 * USAGE
 *
 *   node scripts/p2b-kernel-feature-ratchet.cjs            human report, exit 1 on any violation
 *   node scripts/p2b-kernel-feature-ratchet.cjs --json     the same decision as JSON
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const RATCHET_PATH = "config/p2b-kernel-feature-ratchet.json";

function readRatchet(root = ROOT) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, RATCHET_PATH), "utf8"));
  return { schema: raw.schema, measuredAt: raw.measured_at, ownershipModel: raw.ownership_model, recorded: raw.recorded ?? {}, target: raw.target ?? {}, reason: raw.reason };
}

/**
 * The decision, as a pure function of a measurement and a floor.
 *
 * Pure and exported so the test can exercise BOTH directions on constructed reports -- a ratchet that is only
 * ever observed passing has not been shown to ratchet anything.
 */
function decide(report, ratchet, cycles) {
  const problems = [];
  const improvements = [];
  const recorded = ratchet.recorded ?? {};
  const model = ratchet.ownershipModel ?? "(ownership model not stated)";
  const edges = report?.edges ?? {};
  const measured = report?.measured ?? {};

  const risen = (name, actual, floor, consequence) => {
    if (typeof floor !== "number" || typeof actual !== "number") {
      problems.push(`${name}: not comparable (measured ${JSON.stringify(actual)}, recorded ${JSON.stringify(floor)})`);
      return;
    }
    if (actual > floor) problems.push(`${name} ROSE to ${actual}, above the recorded ${floor} (${consequence}); measured under ${model}`);
    else if (actual < floor) improvements.push(`${name} fell from ${floor} to ${actual} -- lower the recorded value in ${RATCHET_PATH} in this commit`);
  };
  const floor = (name, actual, minimum, consequence) => {
    if (typeof minimum !== "number" || typeof actual !== "number") {
      problems.push(`${name}: not comparable (measured ${JSON.stringify(actual)}, recorded ${JSON.stringify(minimum)})`);
      return;
    }
    if (actual < minimum) problems.push(`${name} FELL to ${actual}, below the recorded ${minimum} (${consequence}); measured under ${model}`);
  };

  risen("kernel -> feature file edges", edges.kernelToFeatureFileEdges, recorded.kernel_to_feature_file_edges, "workbook section 16's target is 0 and a rise is a new inversion or a re-attribution in the wrong direction");
  risen("kernel -> feature pairs", edges.kernelToFeaturePairs, recorded.kernel_to_feature_pairs, "a new kernel reaching a new feature");
  risen("mutual capability pairs", edges.mutualCapabilityPairs, recorded.mutual_capability_pairs, "workbook section 17's target is 0; a new pair is a new cycle");

  // Anti-gaming. A fall in the counts above is only progress if the instrument still saw the whole tree.
  floor("owned files", measured.filesOwned, recorded.files_owned, "fewer files scanned is not fewer inversions; a file removed from the map, or absorbed by another class to hide its edges, makes the migration look finished without being finished");
  floor("capabilities with a kind", measured.capabilitiesWithKinds, recorded.capabilities_with_kinds, "`kernel` is read from the manifests' kind field, so a kernel that lost its kind would stop being counted while still being a kernel");
  floor("composition-root files", measured.compositionRootFiles, recorded.composition_root_files, "the composition root must stay visible; removing it from the map instead of re-attributing it would make its ~95 outgoing edges disappear");
  // The RAW edge count: recorded as a CEILING, and corrected from a floor in ledger CC-046 after the floor fired on
  // the first genuine repair. The distinction the earlier rule missed is that a ROAD DECLARATION moves an edge from
  // one column to another and must leave the total untouched, while a REPAIR DELETES an edge outright -- re-pointing
  // an import at its owner, or inverting a dependency so the import disappears -- and section 16's target in docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md IS a falling
  // total. A floor would have failed the very migration this ratchet exists to drive, while still not catching what
  // it was written for: deleting an edge to hide an inversion also lowers the kernel -> feature count that is already
  // ratcheted, and dropping a file from the scan is already floored by `files_owned`.
  risen("total cross-capability file edges", edges.totalCrossCapabilityFileEdges, recorded.total_cross_capability_file_edges, "a new cross-capability edge appeared; no repair adds one, so this is a new dependency or a re-attribution in the wrong direction");
  // ---- Roads (workbook section 19; see docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md) ------------------
  //
  // A road declaration MOVES edges out of a building's column without deleting anything, so the two numbers it
  // affects are both floors: the declared road count, and the count of edges that now point at a road. A fall in
  // either, while the kernel -> feature count rises, is the signature of a re-attribution being reversed without
  // the consumers changing -- and a road that vanished from the declaration would otherwise be indistinguishable
  // from one that was never needed.
  if (typeof recorded.road_files === "number" || typeof recorded.edges_to_roads === "number") {
    floor("road files", measured.roadFiles, recorded.road_files, "a declared road cannot be un-declared to move its edges back into the owning capability's column; extract the file and record that instead");
    floor("edges to roads", edges.edgesToRoads, recorded.edges_to_roads, "the road edges are published on their own line precisely so they cannot vanish; a fall here is only legitimate when the consumers really stopped using the road");
    if (typeof edges.edgesFromRoads === "number" && edges.edgesFromRoads !== 0) {
      problems.push(`${edges.edgesFromRoads} edge(s) leave a road: a road that imports another capability is not a road, it is a building dependency, and attributing it to the road class would HIDE that edge (ledger CC-030)`);
    }
  }

  // ---- P2-C: the SCC decomposition, the decision-relevant half of the cycle section in
  // docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md (section 17) ------------------------------------
  //
  // A 2-cycle count says how many PAIRS are mutually dependent. The SCC size says whether the graph is a KNOT:
  // pairwise repairs do not split a large component, because it only dissolves when every internal mutual
  // dependency does. So the recorded floor is `largest_scc_size` -- a CEILING that must fall -- and the graph
  // itself gets FLOORS, because shrinking the component by losing edges or nodes from the measurement would be
  // the same fraud as shrinking the inversion count by scanning fewer files.
  if (typeof recorded.largest_scc_size === "number") {
    if (cycles === undefined || cycles === null) {
      problems.push(`largest SCC size: the recorded floor names it (${recorded.largest_scc_size}) but no cycle measurement was supplied, so the property cannot be checked; run scripts/phase2-cycles.cjs and pass its report`);
    } else {
      risen("largest SCC size", cycles.largestSccSize, recorded.largest_scc_size, "section 17's target is 0; a LARGER component means the knot grew even if the pair count fell, and pairwise repairs do not split a large component");
      risen("non-trivial SCCs", cycles.nonTrivialSccCount, recorded.non_trivial_scc_count, "a new multi-member component is a new knot, not a new cycle");
      risen("mutual capability pairs (cycles)", cycles.twoCyclePairCount, recorded.mutual_capability_pairs, "the same number as above, measured from the SCC's own edge list rather than from the inventory's pair rollup; if the two disagree the instruments disagree and neither should be trusted");
      floor("capability nodes", cycles.capabilityNodes, recorded.capability_nodes, "the SCC is computed over this node set; losing a node makes the component smaller without the architecture changing");
      floor("capability edges", cycles.capabilityEdges, recorded.capability_edges, "fewer edges in the graph means fewer cycles found, which is how a knot could be reported as dissolved without being touched");
      if (typeof recorded.scc_count === "number") {
        // NOT a ceiling: splitting one component RAISES the count while lowering the largest size, so a rise here
        // is progress. Recorded for the reader, asserted only to be present.
        if (typeof cycles.sccCount !== "number") problems.push("SCC count: the cycle measurement carries no SCC count");
      }
    }
  }

  // The composition root is NOT a kernel: the whole point of its own class (ledger CC-023).
  for (const entry of report?.kernelToFeaturePairs ?? []) {
    if (String(entry.pair).startsWith("<composition-root>")) {
      problems.push(`the composition root is counted as a kernel in the pair ${entry.pair}; its kind must never satisfy the kernel test`);
    }
  }

  return {
    schema: "city-p2b-ratchet-decision/1",
    ok: problems.length === 0,
    ownershipModel: model,
    recordedAt: ratchet.measuredAt ?? null,
    target: ratchet.target ?? {},
    problems,
    improvements,
    measured: {
      kernelToFeatureFileEdges: edges.kernelToFeatureFileEdges ?? null,
      kernelToFeaturePairs: edges.kernelToFeaturePairs ?? null,
      mutualCapabilityPairs: edges.mutualCapabilityPairs ?? null,
      filesOwned: measured.filesOwned ?? null,
      capabilitiesWithKinds: measured.capabilitiesWithKinds ?? null,
      compositionRootFiles: measured.compositionRootFiles ?? null,
      roadFiles: measured.roadFiles ?? null,
      edgesToRoads: edges.edgesToRoads ?? null,
      edgesFromRoads: edges.edgesFromRoads ?? null,
      largestSccSize: cycles?.largestSccSize ?? null,
      nonTrivialSccCount: cycles?.nonTrivialSccCount ?? null,
      sccCount: cycles?.sccCount ?? null,
      capabilityNodes: cycles?.capabilityNodes ?? null,
      capabilityEdges: cycles?.capabilityEdges ?? null,
    },
  };
}

function render(decision) {
  const lines = [];
  lines.push(`[p2b] ownership model: ${decision.ownershipModel}`);
  lines.push(`[p2b] recorded ${decision.recordedAt ?? "(no date)"}; targets ${JSON.stringify(decision.target)}`);
  lines.push(`[p2b] measured kernel -> feature file edges ${decision.measured.kernelToFeatureFileEdges} over ${decision.measured.kernelToFeaturePairs} pairs; mutual pairs ${decision.measured.mutualCapabilityPairs}`);
  lines.push(`[p2b] measured owned files ${decision.measured.filesOwned}; capabilities with a kind ${decision.measured.capabilitiesWithKinds}; composition-root files ${decision.measured.compositionRootFiles}`);
  if (decision.measured.roadFiles !== null && decision.measured.roadFiles !== undefined) {
    lines.push(`[p2b] measured roads ${decision.measured.roadFiles} file(s) carrying ${decision.measured.edgesToRoads} edge(s); ${decision.measured.edgesFromRoads} edge(s) leave a road (must be 0)`);
  }
  if (decision.measured.largestSccSize !== null) {
    lines.push(`[p2b] measured capability graph ${decision.measured.capabilityNodes} node(s) / ${decision.measured.capabilityEdges} edge(s); SCCs ${decision.measured.sccCount} (${decision.measured.nonTrivialSccCount} non-trivial); LARGEST SCC ${decision.measured.largestSccSize}`);
  }
  for (const line of decision.improvements) lines.push(`[p2b] IMPROVED ${line}`);
  if (decision.ok) {
    lines.push("[p2b] VERDICT=HOLDS (no recorded value was exceeded and nothing was hidden to achieve it)");
    return lines.join("\n");
  }
  lines.push(`[p2b] VERDICT=REGRESSED (${decision.problems.length} problem(s))`);
  for (const problem of decision.problems) lines.push(`[p2b]   - ${problem}`);
  return lines.join("\n");
}

function main(argv) {
  const report = require(path.join(ROOT, "scripts", "phase2-edge-inventory.cjs")).report;
  // The cycle measurement is a SEPARATE instrument (scripts/phase2-cycles.cjs); the judge reads both rather than
  // computing the SCCs itself, so the numbers it ratchets are the ones the instrument publishes.
  const cycles = require(path.join(ROOT, "scripts", "phase2-cycles.cjs")).report;
  const decision = decide(report, readRatchet(), cycles);
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  else process.stdout.write(`${render(decision)}\n`);
  return decision.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`p2b-kernel-feature-ratchet failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, decide, readRatchet, RATCHET_PATH };
