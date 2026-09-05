import fs from "node:fs";
import path from "node:path";
import { scanRepo } from "../engineering/repo-inspector";
import { selectFalsifiableQuestion, type CandidateQuestion } from "../../src/shared/research-levelb";
import { buildExperimentSpec, levelAGate, noveltyReview, type LevelAPlan, type ProjectSignals, type ExperimentSpec } from "../../src/shared/research-levela";

/**
 * Level-A planner (plan 9-6 Phase 12). Given only a project goal, it observes
 * the workspace repo (bounded), scores web-AI-proposed candidate questions by
 * novelty + feasibility, picks the falsifiable one (evidence > vote discipline
 * applies downstream), and drafts a primary experiment spec with replication —
 * producing a LevelAPlan that a live executor later runs (real experiments are
 * never replaced by mocks).
 */

export function inspectProjectSignals(workspace: string): ProjectSignals {
  const snapshot = scanRepo(fs.realpathSync(workspace));
  const code = snapshot.files.filter((file) => /\.(?:[cm]?[jt]sx?|py|tsx|svelte|vue)$/.test(file));
  const languages = [...new Set(code.map((file) => {
    if (/\.py$/.test(file)) return "python";
    if (/\.(?:ts|tsx|mts|cts)$/.test(file)) return "typescript";
    if (/\.(?:js|jsx|mjs|cjs)$/.test(file)) return "javascript";
    return "other";
  }))];
  const testFiles = snapshot.files.filter((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)).length;
  const topModules = code.slice(0, 30).map((file) => path.posix.basename(file, path.posix.extname(file)));
  return { files: snapshot.files.length, testFiles, languages, topModules };
}

export interface LevelAPlannerOptions {
  /** Web-AI proposer: returns candidate questions for the project goal. */
  propose: (goal: string, signals: ProjectSignals) => Promise<CandidateQuestion[]>;
  primaryMetric?: ExperimentSpec["primaryMetric"];
}

export class LevelAPlanner {
  constructor(private readonly options: LevelAPlannerOptions) {}

  /** Runs Level-A planning end to end (project inspection → RQ → spec). */
  async plan(goal: string, workspace: string): Promise<LevelAPlan> {
    const signals = inspectProjectSignals(workspace);
    const candidates = await this.options.propose(goal, signals);
    const selection = selectFalsifiableQuestion(candidates);
    if (!selection.selectedId) throw new Error(`No falsifiable research question: ${selection.rejected.map((item) => item.reason).join("; ") || "no candidates"}`);
    const selected = candidates.find((candidate) => candidate.id === selection.selectedId)!;
    const review = noveltyReview(selected, signals);
    const gate = levelAGate(review);
    if (!gate.ok) throw new Error(`Question rejected by novelty/feasibility gate: ${gate.reason}`);
    const experiment = buildExperimentSpec({ id: `exp-${selected.id}`, primaryMetric: this.options.primaryMetric ?? "effect-size" });
    const plan: LevelAPlan = {
      selectedQuestion: selected,
      hypothesis: `H: ${selected.hypothesis ?? selected.question}`,
      novelty: review,
      experiment
    };
    return plan;
  }
}
