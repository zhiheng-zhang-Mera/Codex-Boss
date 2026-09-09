import fs from "node:fs";
import type { ResearchStageExecutor, StageOutcome } from "./research-supervisor";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";
import { scanRepo } from "../engineering/repo-inspector";

/**
 * Default Level-B stage executor (plan 9-6 Phase 8). Deterministic offline
 * work where possible: PROJECT_INSPECTION scans the workspace repo (bounded),
 * READY/terminal states are no-ops. Every stage that needs a reviewer, a live
 * semantic role, a real experiment, or real audit work returns an honest
 * pause outcome — the supervisor parks the run at WAITING_FOR_PROVIDER and
 * records the pending stage instead of advancing past a gate no executor
 * actually passed (evidence > vote; milestone §7: no placeholder stage may
 * auto-advance a live run). The live web-AI wiring / the research conductor
 * replace this executor in the GUI session and in the deterministic CI path.
 */

const REVIEWER_GATED: ReadonlySet<ResearchState> = new Set<ResearchState>([
  "LITERATURE_REVIEW",
  "QUESTION_FORMULATION",
  "EXPERIMENT_GENERATION",
  "ANALYSIS",
  "MANUSCRIPT"
]);

export class DefaultLevelBExecutor implements ResearchStageExecutor {
  async run(input: { ir: ResearchIR; stage: ResearchState; workspace: string }): Promise<StageOutcome> {
    switch (input.stage) {
      case "PROJECT_INSPECTION": {
        const root = fs.realpathSync(input.workspace);
        const snapshot = scanRepo(root);
        const entries = snapshot.files.slice(0, 50);
        return {
          summary: `inspected repo: ${snapshot.files.length} files, ${Object.keys(snapshot.testMap).length} test dirs, fingerprint ${snapshot.fingerprint.slice(0, 12)}; top-level: ${entries.slice(0, 10).join(", ") || "none"}`,
          evidenceRefs: ["repo:" + snapshot.fingerprint.slice(0, 16)]
        };
      }
      case "READY":
        return { summary: "research ready (no further autopilot steps)" };
      case "FAILED":
        return { summary: "research failed" };
      case "SCOPING":
        // Scope intake is supervisor/user bookkeeping, not a reviewer gate.
        return { summary: "scoping recorded at start (goal + workspace + reviewers)" };
      default:
        if (REVIEWER_GATED.has(input.stage)) {
          return {
            summary: `stage ${input.stage} requires web-AI reviewer (evidence > vote); not auto-executed by the default executor`,
            pause: true,
            pauseReason: `stage ${input.stage} requires web-AI reviewer (evidence > vote); default executor cannot fabricate this gate`
          };
        }
        // No placeholder advancement (milestone §7): the remaining stages
        // (protocol draft/freeze, experiment implementation/execution,
        // replication, claim review, citation/repro audit, manuscript, build)
        // need real work this executor cannot perform — pausing honestly is
        // safer than advancing a run on a "no-op" summary.
        return {
          summary: `stage ${input.stage} has no deterministic offline work in the default executor and must not auto-advance`,
          pause: true,
          pauseReason: `stage ${input.stage} needs a real stage executor (research conductor / live role worker); default executor cannot perform it (no placeholder advancement)`
        };
    }
  }
}
