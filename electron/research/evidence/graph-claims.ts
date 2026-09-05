import type { EvidenceGraph, EvidenceGraphFile } from "./evidence-graph";

/**
 * Evidence-graph → manuscript claim derivation (plan 9-6 Phase 11 glue). The
 * rounds 11–12 analysis writes claim + statistic nodes and run → statistic →
 * claim edges into the evidence graph. This helper derives the manuscript
 * `claims`/`evidenceIds` wiring from the graph itself, so a manuscript only
 * asserts claims that exist in the graph and each claim is bound to the real
 * evidence nodes upstream of it (claims traceable to evidence — by
 * construction, never hand-wired).
 */

export interface ManuscriptClaimsDerivation {
  /** claim id (as recorded in the graph, e.g. `claim:<id>`) → upstream evidence ids. */
  claims: Array<{ id: string; evidenceIds: string[] }>;
  /** All evidence node ids present in the graph (run/statistic/metric/…). */
  evidenceIds: string[];
}

const EVIDENCE_KINDS = new Set(["run", "statistic", "metric", "figure-table", "paper-sentence"]);

export function deriveManuscriptClaims(graph: EvidenceGraphFile): ManuscriptClaimsDerivation {
  const nodes = graph.nodes;
  const edges = graph.edges;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const upstream = new Map<string, string[]>();
  for (const edge of edges) {
    const list = upstream.get(edge.to) ?? [];
    if (!list.includes(edge.from)) list.push(edge.from);
    upstream.set(edge.to, list);
  }
  // BFS upstream from each claim node, collecting evidence-kind node ids.
  const collectEvidence = (claimId: string): string[] => {
    const found: string[] = [];
    const seen = new Set<string>([claimId]);
    const queue = [...(upstream.get(claimId) ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (node && EVIDENCE_KINDS.has(node.kind)) found.push(id);
      for (const parent of upstream.get(id) ?? []) if (!seen.has(parent)) queue.push(parent);
    }
    return found;
  };
  const claims = nodes.filter((node) => node.kind === "claim").map((node) => ({ id: node.id, evidenceIds: collectEvidence(node.id) }));
  return { claims, evidenceIds: nodes.filter((node) => EVIDENCE_KINDS.has(node.kind)).map((node) => node.id) };
}

/** Convenience: derive manuscript claims straight from a live evidence graph. */
export function manuscriptClaimsFromGraph(evidence: EvidenceGraph, researchId: string): ManuscriptClaimsDerivation {
  return deriveManuscriptClaims(evidence.graph(researchId));
}
