import fs from "node:fs";
import type { ResearchStageExecutor, StageOutcome } from "./research-supervisor";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";
import { scanRepo } from "../engineering/repo-inspector";

/**
 * Default Level-B stage executor (plan 9-6 Phase 8). Deterministic offline
 * work where possible: PROJECT_INSPECTION scans the workspace repo (bounded),
 * READY/terminal stages are no-ops. Reviewer-gated stages (literature review,
 * RQ formulation, experiment design, analysis, manuscript) return an honest
 * pause outcome — the supervisor parks the run at WAITING_FOR_PROVIDER and
 * records the pending stage instead of advancing past a gate no executor
 * actually passed (evidence > vote; no fabricated advancement). The live
 * web-AI wiring replaces this executor in the GUI session.
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
        // Remaining stages have no deterministic offline work in this executor
        // but are not reviewer gates (protocol bookkeeping, runtime execution,
        // citation/audit, build…); record a no-op summary and let the autopilot
        // pass them as placeholders.
        return { summary: `stage ${input.stage} has no deterministic offline work in the default executor; recorded as placeholder` };
    }
  }
}
