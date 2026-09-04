import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "../runtimes/runtime";

export interface DispatchPolicy {
  maxParallel: number;
  timeoutMs: number;
  maxRetries: number;
  allowFallback: boolean;
  requireAll: boolean;
  minSuccess?: number;
}

export interface ScheduledJob { request: RuntimeRequest; candidates: RuntimeAdapter[]; }
export interface ScheduleBatchResult {
  results: PromiseSettledResult<RuntimeResult>[];
  state: "READY_TO_COMMIT" | "RECONCILIATION_REQUIRED";
  successCount: number;
}

export class Scheduler {
  async dispatch(job: ScheduledJob, policy: DispatchPolicy): Promise<RuntimeResult> {
    if (!Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 3 || !Number.isFinite(policy.timeoutMs) || policy.timeoutMs <= 0) throw new Error("Invalid dispatch bounds");
    if (job.candidates.length === 0) return failureResult(job.request, "UNSUPPORTED", "No eligible runtime remains", false);
    const candidates = policy.allowFallback ? job.candidates : job.candidates.slice(0, 1);
    let last = failureResult(job.request, "UNKNOWN", "Runtime did not execute", true);
    for (const runtime of candidates) {
      for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
        last = await this.executeWithTimeout(runtime, job.request, policy.timeoutMs);
        if (last.status === "SUCCESS" || last.status === "CANCELLED") return last;
        if (["TIMEOUT", "UNKNOWN"].includes(last.failure?.code ?? "") && !job.request.replaySafe) return last;
        if (last.failure?.code === "AUTH_REQUIRED" || last.failure?.code === "USER_ACTION_REQUIRED") return last;
        if (last.status === "PERMANENT_FAILURE" || !last.failure?.retryable) break;
      }
    }
    return last;
  }

  async runBatch(jobs: ScheduledJob[], policy: DispatchPolicy): Promise<ScheduleBatchResult> {
    if (!Number.isInteger(policy.maxParallel) || policy.maxParallel < 1) throw new Error("Invalid parallel bound");
    const results: PromiseSettledResult<RuntimeResult>[] = new Array(jobs.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const index = cursor++;
        try { results[index] = { status: "fulfilled", value: await this.dispatch(jobs[index], policy) }; }
        catch (reason) { results[index] = { status: "rejected", reason }; }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(3, policy.maxParallel, jobs.length)) }, worker));
    const successCount = results.filter((item) => item.status === "fulfilled" && item.value.status === "SUCCESS").length;
    const required = policy.requireAll ? jobs.length : Math.max(1, policy.minSuccess ?? 1);
    return { results, successCount, state: successCount >= required ? "READY_TO_COMMIT" : "RECONCILIATION_REQUIRED" };
  }

  private async executeWithTimeout(runtime: RuntimeAdapter, request: RuntimeRequest, timeoutMs: number): Promise<RuntimeResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<RuntimeResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ runtimeId: runtime.id, jobId: request.jobId, status: "RETRYABLE_FAILURE", failure: { code: "TIMEOUT", message: `Runtime timed out after ${timeoutMs}ms`, retryable: true } });
      }, timeoutMs);
    });
    try { return await Promise.race([runtime.execute(request, controller.signal), timeout]); }
    catch (error) { return { runtimeId: runtime.id, jobId: request.jobId, status: "RETRYABLE_FAILURE", failure: { code: "UNKNOWN", message: String(error), retryable: true } }; }
    finally { if (timer) clearTimeout(timer); }
  }
}

function failureResult(request: RuntimeRequest, code: "UNSUPPORTED" | "UNKNOWN", message: string, retryable: boolean): RuntimeResult {
  return { runtimeId: "none", jobId: request.jobId, status: retryable ? "RETRYABLE_FAILURE" : "PERMANENT_FAILURE", failure: { code, message, retryable } };
}
