import type { ResearchCommandSpec } from "../../../src/shared/research-command";
import { runStructuredProcess, type ProcessResult } from "./process-runner";
import type { ResearchPurpose } from "../../../src/shared/research-command";

/**
 * Research runtime facade (plan 9-6 Phase 6). Purpose-routed structured
 * execution with an active-process budget: EXPERIMENT/ANALYSIS runs execute in
 * a dedicated `run` entry; the limiter prevents a research model from
 * exhausting the machine (max concurrent runs).
 */

export interface ResearchRuntimeOptions {
  maxConcurrent?: number;
  onProcess?: (spec: ResearchCommandSpec, result: ProcessResult) => void;
}

export class ResearchRuntime {
  private active = 0;
  private totalRuns = 0;
  private readonly maxConcurrent: number;
  constructor(private readonly options: ResearchRuntimeOptions = {}) {
    this.maxConcurrent = Math.max(1, Math.min(8, options.maxConcurrent ?? 2));
  }

  async run(spec: ResearchCommandSpec, signal?: AbortSignal): Promise<ProcessResult> {
    if (this.active >= this.maxConcurrent) throw new Error(`Research runtime busy: ${this.active}/${this.maxConcurrent} active`);
    this.active += 1;
    this.totalRuns += 1;
    try {
      const result = await runStructuredProcess(spec, signal);
      this.options.onProcess?.(spec, result);
      return result;
    } finally {
      this.active -= 1;
    }
  }

  static purposeOf(purpose: ResearchPurpose): string {
    return ({ EXPERIMENT: "experiment", ANALYSIS: "analysis", TEST: "test", BUILD: "build", DATA_PROCESSING: "data-processing" })[purpose];
  }

  stats(): { active: number; totalRuns: number; maxConcurrent: number } {
    return { active: this.active, totalRuns: this.totalRuns, maxConcurrent: this.maxConcurrent };
  }
}