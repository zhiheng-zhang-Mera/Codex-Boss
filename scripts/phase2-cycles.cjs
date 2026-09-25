#!/usr/bin/env node
/**
 * PHASE 2 — the capability-level SCC and cycle measurement (P2-C; see
 * docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md, section 17).
 *
 * WHAT IT ANSWERS
 *
 *   Section 17 says: "Freshly compute capability-level SCCs and cycles. Historical baseline contained: 43
 *   capability-level 2-cycles, 1 SCC containing 25 of 27 capabilities. Those are historical values, not current
 *   truth." This program computes the current truth, and it is the "cycle/SCC validator" the final acceptance
 *   suite names.
 *
 * WHY THE SCC DECOMPOSITION IS THE DECISION-RELEVANT NUMBER
 *
 *   A count of 2-cycles says how many PAIRS are mutually dependent. The SCC decomposition says whether the graph
 *   is a knot: 38 mutual pairs spread over many small components is a list of pairwise repairs, while one
 *   component holding most capabilities means no pairwise repair changes the shape, because the component only
 *   dissolves when every internal mutual dependency does. The historical measurement was the second kind -- ONE
 *   SCC containing 25 of 27 -- and the current number decides which of those two programmes P2-C is.
 *
 * READ-ONLY. Writes nothing. Prints its measurement; the judgement lives in
 * `scripts/p2b-kernel-feature-ratchet.cjs`, which ratchets these numbers, and deliberately NOT here.
 *
 * WHAT IT DOES NOT DO
 *
 *   It does not decide which cycles to break, rank them, or propose a tactic. Section 17 lists the tactics
 *   (extract a road, invert dependency, event bus, explicit contract, split bundle, temporary bridge with a
 *   declared expiry); choosing among them is per-pair design work, and an instrument that ranked pairs would be
 *   making that decision invisibly.
 *
 * USAGE
 *
 *   node scripts/phase2-cycles.cjs            human summary
 *   node scripts/phase2-cycles.cjs --json     the same measurement as JSON
 */

"use strict";

const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const INVENTORY = "scripts/phase2-edge-inventory.cjs";

/**
 * Tarjan's algorithm, iteratively.
 *
 * Iterative rather than recursive because the graph is a MEASUREMENT of a repository that grows: a recursive
 * implementation is fine at 27 nodes and a stack overflow at thousands, and the failure would look like a
 * validator that stopped reporting rather than a graph that got big. Self-loops are dropped from the adjacency
 * because a node with a self-loop is still a component of size one, which the trivial/one-component distinction
 * already reports.
 */
function stronglyConnectedComponents(nodes, edges) {
  const adjacency = new Map();
  const vertices = new Set(nodes);
  for (const [from, to] of edges) { vertices.add(from); vertices.add(to); }
  for (const vertex of vertices) adjacency.set(vertex, []);
  for (const [from, to] of edges) if (from !== to) adjacency.get(from).push(to);
  for (const list of adjacency.values()) list.sort();

  let index = 0;
  const indices = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];

  for (const root of [...vertices].sort()) {
    if (indices.has(root)) continue;
    const work = [{ node: root, next: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const node = frame.node;
      if (frame.next === 0) {
        indices.set(node, index);
        low.set(node, index);
        index += 1;
        stack.push(node);
        onStack.add(node);
      }
      const neighbours = adjacency.get(node) ?? [];
      let descended = false;
      while (frame.next < neighbours.length) {
        const neighbour = neighbours[frame.next];
        frame.next += 1;
        if (!indices.has(neighbour)) { work.push({ node: neighbour, next: 0 }); descended = true; break; }
        if (onStack.has(neighbour)) low.set(node, Math.min(low.get(node), indices.get(neighbour)));
      }
      if (descended) continue;
      if (low.get(node) === indices.get(node)) {
        const component = [];
        for (;;) {
          const member = stack.pop();
          onStack.delete(member);
          component.push(member);
          if (member === node) break;
        }
        components.push(component.sort());
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
    }
  }
  return components.sort((left, right) => (right.length - left.length) || left[0].localeCompare(right[0]));
}

/** The capability graph the inventory measured: its FULL pair list, not the truncated human summary. */
function capabilityGraph(pairs) {
  const edges = [];
  for (const entry of pairs) {
    const [from, to] = String(entry.pair).split(" -> ");
    if (from && to) edges.push([from, to]);
  }
  const nodes = [...new Set(edges.flat())].sort();
  return { nodes, edges };
}

function measure(inventoryReport) {
  const pairs = inventoryReport.allPairs ?? [];
  const { nodes, edges } = capabilityGraph(pairs);
  const components = stronglyConnectedComponents(nodes, edges);
  const edgeSet = new Set(edges.map(([from, to]) => `${from}\u0000${to}`));
  const mutualNames = edges
    .filter(([from, to]) => from !== to && edgeSet.has(`${to}\u0000${from}`))
    .map(([from, to]) => `${from} -> ${to}`)
    .sort();
  const selfLoops = edges.filter(([from, to]) => from === to).map(([from]) => from).sort();
  const nonTrivial = components.filter((component) => component.length > 1);
  const largest = components[0] ?? [];

  return {
    schema: "city-phase2-cycles/1",
    ownershipModel: "config/capability-modules.json -- the OWNERSHIP MAP, not the manifests",
    measuredBy: INVENTORY,
    capabilityNodes: nodes.length,
    capabilityEdges: edges.length,
    pairsInInventoryReport: pairs.length,
    sccCount: components.length,
    nonTrivialSccCount: nonTrivial.length,
    largestSccSize: largest.length,
    largestSccMembers: largest,
    components: components.map((component) => ({ size: component.length, members: component })),
    // A 2-cycle is TWO directed pairs, so the pair count is the list halved. Reported as the number of mutual
    // PAIRS because that is the unit the workbook counts, in
  // docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md (section 17), and the unit the ratchet records.
    twoCyclePairCount: mutualNames.length / 2,
    mutualPairs: mutualNames,
    selfLoopCount: selfLoops.length,
    selfLoops,
  };
}

function render(report) {
  const lines = [];
  lines.push(`[p2c] ownership model: ${report.ownershipModel}`);
  lines.push(`[p2c] capability graph: ${report.capabilityNodes} node(s), ${report.capabilityEdges} directed edge(s), from ${report.pairsInInventoryReport} measured pair(s)`);
  lines.push(`[p2c] SCCs: ${report.sccCount} (${report.nonTrivialSccCount} with more than one member; ${report.sccCount - report.nonTrivialSccCount} trivial)`);
  lines.push(`[p2c] LARGEST SCC: ${report.largestSccSize} of ${report.capabilityNodes} capabilities`);
  if (report.largestSccMembers.length > 0) lines.push(`[p2c]   ${report.largestSccMembers.join(", ")}`);
  lines.push(`[p2c] mutual capability pairs (section 17's 2-cycles): ${report.twoCyclePairCount}   (target 0)`);
  lines.push(`[p2c] self-loops: ${report.selfLoopCount}${report.selfLoops.length > 0 ? ` -- ${report.selfLoops.join(", ")}` : ""}`);
  lines.push("[p2c] components by size:");
  for (const component of report.components.slice(0, 12)) {
    lines.push(`[p2c]   ${String(component.size).padStart(3)}  ${component.members.slice(0, 8).join(", ")}${component.members.length > 8 ? ` ... (+${component.members.length - 8})` : ""}`);
  }
  return lines.join("\n");
}

const report = measure(require(path.join(ROOT, INVENTORY)).report);

if (require.main === module) {
  process.stdout.write(process.argv.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : `${render(report)}\n`);
}

module.exports = { report, measure, render, stronglyConnectedComponents, capabilityGraph };
