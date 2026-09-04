import { isDeepStrictEqual } from "node:util";
import { TaskLedger } from "./task-ledger";
import { EngineeringRuntime, type GraphExecutor, type GraphResult } from "../engineering/engineering-runtime";
import { shouldReplan, validateGraph, type TaskIR, type TaskStep } from "../../src/shared/task-ir";
export class PlanRunner {
  private readonly active = new Map<string, Promise<GraphResult>>();
  constructor(private readonly ledger: TaskLedger) {}
  run(taskId: string, plan: TaskIR, executor: GraphExecutor,
    replan?: (plan: TaskIR, completed: TaskStep[], failure: string) => Promise<TaskIR>,
    savePlan: (plan: TaskIR) => void = () => {}): Promise<GraphResult> {
    const active = this.active.get(taskId); if (active) return active;
    const work = this.execute(taskId, plan, executor, replan, savePlan).finally(() => this.active.delete(taskId));
    this.active.set(taskId, work); return work;
  }
  private async execute(taskId: string, plan: TaskIR, executor: GraphExecutor,
    replan: ((plan: TaskIR, completed: TaskStep[], failure: string) => Promise<TaskIR>) | undefined,
    savePlan: (plan: TaskIR) => void): Promise<GraphResult> {
    for (let attempt = 0; ; attempt++) {
      const result = await new EngineeringRuntime(this.ledger).run(taskId, plan, executor);
      if (result.status !== "FAILED" || !replan || attempt >= 2 || !shouldReplan("verification_failed")) return result;
      const frozen = plan.steps.filter((step) => this.ledger.load(taskId)?.jobs["graph_" + step.id]?.state === "COMPLETED");
      const next = await replan(plan, frozen, result.evidence.filter((item) => !item.passed).map((item) => item.stepId + ": " + item.output).join("\n"));
      validateGraph(next.steps);
      for (const step of frozen) if (!isDeepStrictEqual(next.steps.find((item) => item.id === step.id), step)) throw new Error("Completed graph step changed during replan");
      this.ledger.update(taskId, "pending graph replanned", (state) => {
        state.jobs.graph.fingerprint = "graph_" + TaskLedger.fingerprint(next);
        state.pendingSteps = next.steps.filter((step) => !frozen.some((done) => done.id === step.id)).map((step) => step.id);
        for (const step of plan.steps.filter((item) => !frozen.some((done) => done.id === item.id))) delete state.jobs["graph_" + step.id];
      });
      plan = next; savePlan(plan);
    }
  }
}
