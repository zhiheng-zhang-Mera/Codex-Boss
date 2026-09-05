/** Policy optimizer interface (plan §29). Pure; research policies stay out of production. */

export interface PolicyContext {
  complexity: "L0" | "L1" | "L2" | "L3";
  /** Per-runtime observed stats (from ResourceController/telemetry aggregates). */
  runtimeStats: Array<{ runtimeId: string; samples: number; passRate: number }>;
  /** Physical worker budget, if any. */
  physicalWorkers?: number;
  nativeAvailable: boolean;
}

export interface PolicyDecision {
  workerCount: number;
  contextBudgetChars: number;
  decompositionDepth: number;
  verificationLevel: "fast" | "standard" | "full";
  parallelism: number;
}

export interface PolicyOptimizer {
  chooseWorkerCount(context: PolicyContext): number;
  chooseContextBudgetChars(context: PolicyContext): number;
  chooseDecompositionDepth(context: PolicyContext): number;
  chooseVerificationLevel(context: PolicyContext): "fast" | "standard" | "full";
  chooseParallelism(context: PolicyContext): number;
}

export function decide(context: PolicyContext, optimizer: PolicyOptimizer): PolicyDecision {
  return {
    workerCount: optimizer.chooseWorkerCount(context),
    contextBudgetChars: optimizer.chooseContextBudgetChars(context),
    decompositionDepth: optimizer.chooseDecompositionDepth(context),
    verificationLevel: optimizer.chooseVerificationLevel(context),
    parallelism: optimizer.chooseParallelism(context)
  };
}

const COMPLEXITY_WORKERS: Record<PolicyContext["complexity"], number> = { L0: 1, L1: 1, L2: 2, L3: 3 };
const COMPLEXITY_DEPTH: Record<PolicyContext["complexity"], number> = { L0: 0, L1: 1, L2: 1, L3: 2 };

/** Deterministic heuristic policy (plan §29 production default). */
export class HeuristicPolicy implements PolicyOptimizer {
  chooseWorkerCount(context: PolicyContext): number {
    if (context.complexity === "L0") return context.nativeAvailable ? 1 : 1;
    const cap = context.physicalWorkers ?? 3;
    return Math.min(COMPLEXITY_WORKERS[context.complexity], cap);
  }
  chooseContextBudgetChars(context: PolicyContext): number {
    return context.complexity === "L0" ? 4000 : context.complexity === "L1" ? 8000 : context.complexity === "L2" ? 16000 : 24000;
  }
  chooseDecompositionDepth(context: PolicyContext): number { return COMPLEXITY_DEPTH[context.complexity]; }
  chooseVerificationLevel(context: PolicyContext): "fast" | "standard" | "full" {
    if (context.complexity === "L0") return "fast";
    if (context.complexity === "L3") return "full";
    return "standard";
  }
  chooseParallelism(context: PolicyContext): number { return this.chooseWorkerCount(context) > 1 ? Math.min(3, this.chooseWorkerCount(context)) : 1; }
}

/** Simple statistical policy: prefers the runtime with the highest observed pass rate. */
export class StatisticalPolicy implements PolicyOptimizer {
  private readonly heuristic = new HeuristicPolicy();
  constructor(private readonly minSamples = 3) {}
  private bestRuntime(context: PolicyContext): string | undefined {
    const credible = context.runtimeStats.filter((stat) => stat.samples >= this.minSamples);
    if (!credible.length) return undefined;
    return [...credible].sort((a, b) => b.passRate - a.passRate)[0].runtimeId;
  }
  chooseWorkerCount(context: PolicyContext): number { return this.heuristic.chooseWorkerCount(context); }
  chooseContextBudgetChars(context: PolicyContext): number { return this.heuristic.chooseContextBudgetChars(context); }
  chooseDecompositionDepth(context: PolicyContext): number { return this.heuristic.chooseDecompositionDepth(context); }
  chooseVerificationLevel(context: PolicyContext): "fast" | "standard" | "full" {
    return this.bestRuntime(context) && context.complexity === "L3" ? "full" : this.heuristic.chooseVerificationLevel(context);
  }
  chooseParallelism(context: PolicyContext): number { return this.heuristic.chooseParallelism(context); }
}
