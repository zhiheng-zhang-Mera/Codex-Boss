import type { PrimaryRunRecord, EvidenceGraph } from "./evidence-graph";
import type { ReviewerVote } from "../../../src/shared/research-adjudicate";
import { adjudicateClaim } from "../../../src/shared/research-adjudicate";
import { describe as statsDescribe, confidenceInterval, mean, type DescriptiveStats, type ConfidenceInterval } from "../../../src/shared/research-statistics";

/**
 * Recorded-run analysis (plan 9-6 Phase 10→8 glue). Turns the real primary-run
 * records a PrimaryRunRecorder persisted into the EvidenceGraph into
 * deterministic statistics + an evidence>vote claim verdict. Fail-closed: no
 * recorded runs for the metric → throws (never fabricate statistics); runs bound
 * to a different protocol hash are excluded; independent replication means at
 * least two runs with distinct seeds under the same frozen protocol. The verdict
 * is added to the evidence graph as statistic + claim nodes with run→statistic
 * edges, keeping claims traceable to real runs.
 */

export interface RunAnalysisOptions {
  claimId: string;
  /** Metric key analyzed from each run's metrics record. */
  metric: string;
  /** Only runs bound to this frozen protocol hash are eligible. */
  protocolHash: string;
  /** Reference value the mean is compared against (claim direction: mean > baseline). */
  baseline?: number;
  votes?: ReviewerVote[];
  requiredVotes?: number;
}

export interface RunAnalysisResult {
  eligibleRuns: PrimaryRunRecord[];
  values: number[];
  describe: DescriptiveStats;
  ci: ConfidenceInterval;
  mean: number;
  independentReplication: boolean;
  verdict: ReturnType<typeof adjudicateClaim>;
}

export function analyzeRecordedRuns(evidence: EvidenceGraph, researchId: string, options: RunAnalysisOptions): RunAnalysisResult {
  // Failed runs (passed === false) never count as evidence — a crashed process
  // that still printed a METRICS line must not fabricate statistics. Runs
  // recorded before the passed flag existed (legacy) default to eligible.
  const eligible = evidence.runs(researchId).filter((run) => run.passed !== false && run.protocolHash === options.protocolHash && typeof run.metrics[options.metric] === "number");
  if (!eligible.length) throw new Error(`No recorded runs for metric ${options.metric} under the frozen protocol`);
  const values = eligible.map((run) => run.metrics[options.metric] as number);
  const describe = statsDescribe(values);
  const ci = confidenceInterval(values);
  const baseline = options.baseline ?? 0;
  const statisticSupported = !Number.isNaN(describe.mean) && describe.mean > baseline;
  const seeds = new Set(eligible.map((run) => run.seed));
  const independentReplication = seeds.size >= 2;
  const claimEvidence = { claimId: options.claimId, statisticSupported, independentReplication, verifiedCitations: 0 };
  const verdict = adjudicateClaim({ votes: options.votes ?? [], evidence: claimEvidence, requiredVotes: options.requiredVotes ?? 1 });

  // Traceability: run → statistic → claim nodes + edges in the evidence graph.
  // Node ids are namespaced exactly once: `stat:<claimId>` (matches the
  // pipeline's `stat:claim:pipeline` evidence refs) and the claim node id is
  // the claim id itself when already prefixed (claim:accuracy), prefixed once
  // otherwise.
  const statId = `stat:${options.claimId}`;
  const claimIdNode = options.claimId.startsWith("claim:") ? options.claimId : `claim:${options.claimId}`;
  evidence.addNode(researchId, { id: statId, kind: "statistic", label: `${options.metric} mean=${describe.mean.toFixed(3)}` });
  evidence.addNode(researchId, { id: claimIdNode, kind: "claim", label: options.claimId });
  for (const run of eligible) evidence.addEdge(researchId, `run:${run.runId}`, statId);
  evidence.addEdge(researchId, statId, claimIdNode);

  return { eligibleRuns: eligible, values, describe, ci, mean: describe.mean, independentReplication, verdict };
}
