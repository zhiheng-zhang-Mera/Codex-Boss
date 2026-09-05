/** Resource model + backpressure (plan §14 / §13.7). Pure and shareable. */

export interface PhysicalBudget {
  /** CPU-ish logical workers the host can run at once. */
  workers: number;
  memoryMb?: number;
  browserSlots?: number;
}

export interface ResourceDemand {
  /** Logical task capacity requested (e.g. plan.maxWorkers / degradation). */
  requestedWorkers: number;
  /** Whether execution needs a browser slot. */
  browser?: boolean;
}

export interface CapacityDecision {
  allowedWorkers: number;
  reason: "unlimited" | "logical_cap" | "physical_cap" | "no_workers";
}

/** Logical/physical concurrency gate (plan §14: physical may never exceed host budget). */
export function capacityFor(demand: ResourceDemand, budget?: PhysicalBudget, logicalCap = 3): CapacityDecision {
  if (demand.requestedWorkers <= 0 || logicalCap <= 0) return { allowedWorkers: 0, reason: "no_workers" };
  const physical = budget?.workers ?? Number.POSITIVE_INFINITY;
  const allowed = Math.min(demand.requestedWorkers, logicalCap, physical);
  if (!Number.isFinite(physical)) return { allowedWorkers: allowed, reason: allowed === demand.requestedWorkers ? "unlimited" : "logical_cap" };
  if (allowed === demand.requestedWorkers) return { allowedWorkers: allowed, reason: "unlimited" };
  return { allowedWorkers: allowed, reason: allowed === logicalCap && logicalCap < physical ? "logical_cap" : "physical_cap" };
}

export interface WorkerProfile {
  runtimeId: string;
  consumesModel: boolean;
  usesBrowser: boolean;
}

/** Capability matrix: how many eligible workers exist per behavior. */
export function workerCapabilityMatrix(workers: WorkerProfile[]): { modelWorkers: number; browserWorkers: number; nativeOnly: number } {
  return {
    modelWorkers: workers.filter((worker) => worker.consumesModel !== false).length,
    browserWorkers: workers.filter((worker) => worker.usesBrowser).length,
    nativeOnly: workers.filter((worker) => worker.consumesModel === false && !worker.usesBrowser).length
  };
}
