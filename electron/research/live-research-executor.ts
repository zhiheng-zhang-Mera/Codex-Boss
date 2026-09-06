/**
 * LiveResearchExecutor (plan 9-7 §27). Replaces DefaultLevelBExecutor in live
 * research flows: a supervisor-injected stage executor that (1) routes every
 * stage to a research role (role router, shared), (2) records a typed stage
 * artifact (kind + role + summary + evidence refs — never prose-only), and
 * (3) delegates the actual stage work to an inner executor (live web-AI roles
 * in the GUI session, deterministic pipeline in offline tests).
 */
import { artifactKindForStage, roleForStage, stageArtifact, type ResearchStageArtifact } from "../../src/shared/research-roles";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";
import type { ResearchStageExecutor, StageOutcome } from "./research-supervisor";

export interface LiveResearchExecutorOptions {
  /** Inner executor that performs the real stage work. */
  inner: ResearchStageExecutor;
  /** Optional artifact sink (ledger/evidence graph) receiving typed artifacts. */
  onArtifact?: (artifact: ResearchStageArtifact) => void;
}

export class LiveResearchExecutor implements ResearchStageExecutor {
  private readonly inner: ResearchStageExecutor;
  private readonly onArtifact?: (artifact: ResearchStageArtifact) => void;

  constructor(options: LiveResearchExecutorOptions) {
    this.inner = options.inner;
    this.onArtifact = options.onArtifact;
  }

  async run(input: { ir: ResearchIR; stage: ResearchState; workspace: string }): Promise<StageOutcome> {
    const role = roleForStage(input.stage);
    const kind = artifactKindForStage(input.stage);
    const outcome = await this.inner.run(input);
    // Every stage emits a typed artifact record: role route + kind + evidence
    // refs, so consumers never see bare prose (plan §27 "禁止只有 prose").
    const artifact = stageArtifact({
      stage: input.stage,
      summary: outcome.summary,
      evidenceRefs: outcome.evidenceRefs
    });
    this.onArtifact?.(artifact);
    return {
      summary: `[${role}/${kind}] ${outcome.summary}`,
      evidenceRefs: [...(outcome.evidenceRefs ?? []), artifact.artifactId],
      ...(outcome.pause ? { pause: true as const, pauseReason: outcome.pauseReason } : {}),
      ...(outcome.fail ? { fail: { reason: outcome.fail.reason } } : {})
    };
  }
}
