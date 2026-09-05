import fs from "node:fs";
import path from "node:path";
import type { ResearchStageExecutor } from "./research-supervisor";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";
import { scanRepo } from "../engineering/repo-inspector";

/**
 * Default Level-B stage executor (plan 9-6 Phase 8). Deterministic offline
 * work where possible: PROJECT_INSPECTION scans the workspace repo (bounded),
 * READY/terminal stages are no-ops. Reviewer-gated stages (literature, RQ
 * selection, experiment design, analysis, manuscript) return an honest
 * "requires reviewer" summary instead of fabricating evidence — the live web-AI
 * wiring replaces this executor in the GUI session.
 */

export class DefaultLevelBExecutor implements ResearchStageExecutor {
  async run(input: { ir: ResearchIR; stage: ResearchState; workspace: string }): Promise<{ summary: string; evidenceRefs?: string[] }> {
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
      default:
        return { summary: `stage ${input.stage} requires web-AI reviewer (evidence > vote); not auto-executed by the default executor` };
    }
  }
}

/** Persists a research output tree stub (plan Phase 11 shape) for a ready run. */
export function researchOutputDir(directory: string, id: string): string {
  const dir = path.join(directory, id, "research");
  fs.mkdirSync(dir, { recursive: true });
  for (const sub of ["literature", "experiments", "analysis", "evidence", "manuscript/figures", "audit"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
}
