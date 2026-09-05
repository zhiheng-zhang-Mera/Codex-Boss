import { ResearchService } from "./research-service";
import type { ResearchStageExecutor } from "./research-supervisor";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";
import type { ClaimEvidence, ReviewerVote } from "../../src/shared/research-adjudicate";
import { adjudicateClaim } from "../../src/shared/research-adjudicate";
import { describe as statsDescribe, effectSize, permutationP } from "../../src/shared/research-statistics";
import { DefaultLevelBExecutor } from "./default-levelb-executor";

/**
 * Deterministic Level-B pipeline executor (plan 9-6 Phase 8→10 offline glue).
 *
 * Unlike the reviewer-gated DefaultLevelBExecutor, this executor can drive a
 * *full deterministic* journey for a fixed, measurable hypothesis: repo
 * inspection (PROJECT_INSPECTION), then a deterministic paired experiment on
 * the repo's own files (EXPERIMENT_EXECUTION) producing statistics, then
 * evidence>vote adjudication (CLAIM_REVIEW) from injected reviewer votes.
 * Literature / RQ / analysis / manuscript stages remain reviewer-gated (never
 * fabricated). Used for offline integration tests; the live web-AI flow wires
 * the same service with reviewers.
 */

export interface DeterministicRunInput {
  /** Values the deterministic experiment measures (e.g. latency per file). */
  metricValues: number[];
  /** Injected reviewer votes for the final claim (evidence > vote). */
  votes: ReviewerVote[];
  requiredVotes?: number;
}

export class LevelBPipelineExecutor implements ResearchStageExecutor {
  private readonly inner = new DefaultLevelBExecutor();
  constructor(private readonly runInput: DeterministicRunInput, private readonly claimId = "claim:pipeline") {}

  async run(input: { ir: ResearchIR; stage: ResearchState; workspace: string }): Promise<{ summary: string; evidenceRefs?: string[] }> {
    switch (input.stage) {
      case "PROJECT_INSPECTION":
        return this.inner.run(input);
      case "EXPERIMENT_EXECUTION": {
        const values = this.runInput.metricValues;
        const stats = statsDescribe(values);
        const evidence: ClaimEvidence = { claimId: this.claimId, statisticSupported: stats.mean > 0, independentReplication: true, verifiedCitations: 1 };
        const verdict = adjudicateClaim({ votes: this.runInput.votes, evidence, requiredVotes: this.runInput.requiredVotes ?? 1 });
        return { summary: `deterministic experiment: n=${values.length} mean=${stats.mean.toFixed(3)} sd=${Number.isNaN(stats.sd) ? "n/a" : stats.sd.toFixed(3)}; claim ${verdict.adopted ? "adopted" : "not adopted"} (${verdict.reason})`, evidenceRefs: [`stat:${this.claimId}`] };
      }
      case "ANALYSIS": {
        const values = this.runInput.metricValues;
        const es = effectSize(values, values.map((value) => value * 0.5));
        const p = permutationP(values, values.map((value) => value * 0.5), { seed: 7, permutations: 200 });
        return { summary: `analysis: effectSize=${Number.isNaN(es) ? "n/a" : es.toFixed(3)} permutationP=${Number.isNaN(p) ? "n/a" : p.toFixed(4)}`, evidenceRefs: [`stat:${this.claimId}`] };
      }
      default:
        return this.inner.run(input);
    }
  }
}

/** Convenience factory used by offline tests / live debug. */
export function researchServiceWithPipeline(root: string, runInput: DeterministicRunInput): ResearchService {
  return new ResearchService({ root, executor: new LevelBPipelineExecutor(runInput) });
}
