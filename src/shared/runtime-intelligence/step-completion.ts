/**
 * Runtime Intelligence Plane — step completion capture.
 *
 * This is the missing half of the continuation replay. The plane records its shadow opinion,
 * but a false-stop rate needs to know whether the task was actually finished at the step the
 * opinion was given — and that was never recorded, which is why the benchmark could only ever
 * return `INSUFFICIENT_EVIDENCE`.
 *
 * The loop already knows. Every task-ledger checkpoint carries `completedSteps`,
 * `pendingSteps` and `nextAction`, which is exactly the state a continuation judgement needs.
 * This module derives the observation from those facts, and the rules below are derived from
 * the real checkpoints rather than assumed:
 *
 *   - `pending === 0` alone is NOT completion. In the real corpus the COMPILE checkpoint also
 *     has `pending 0`, before any work item exists, so completion additionally requires that
 *     work actually happened (`completed > 0`). Without that rule a task's very first step
 *     would read as finished;
 *   - an unknown `pendingSteps` is NOT completion. A loop that did not record its open work
 *     cannot be credited with having none;
 *   - `continuedAfterStep` is positional and needs no interpretation: another checkpoint
 *     exists after this one, so the loop took another step.
 *
 * `completionAgreesWithStatus` then checks the derivation against the task's own final status.
 * For all five real tasks the two agree, which is the evidence that the rule is right rather
 * than merely plausible.
 */

import type { StepCompletionObservation } from "./replay-corpus";

/** The loop's own state at one checkpoint, as the task ledger records it. */
export interface LoopCheckpointFact {
  /** Monotone checkpoint revision. */
  revision: number;
  capturedAt: string;
  /** `completedSteps.length`, or `undefined` when the ledger did not record it. */
  completedCount: number | undefined;
  /** `pendingSteps.length`, or `undefined` when the ledger did not record it. */
  pendingCount: number | undefined;
  nextAction: string | undefined;
  checkpointReason: string | undefined;
}

/** Task statuses that mean the task is over. A task in any other status may still be running. */
export const TERMINAL_TASK_STATUSES: readonly string[] = ["completed", "failed", "cancelled", "failed_permanent"];

/** The compile step's action and reason, which mark a checkpoint taken before any work exists. */
export const COMPILE_MARKERS: readonly string[] = ["COMPILE", "task compiled"];

export function isTerminalTaskStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_TASK_STATUSES.includes(status);
}

function isCompileStep(fact: LoopCheckpointFact): boolean {
  return COMPILE_MARKERS.includes(fact.nextAction ?? "") || COMPILE_MARKERS.includes(fact.checkpointReason ?? "");
}

/**
 * Derives one observation per checkpoint, in revision order.
 *
 * The returned `completionEvidence` string is what the corpus stores, so a reader can see the
 * three facts the judgement rested on instead of having to trust a boolean.
 */
export function deriveStepCompletion(input: { facts: readonly LoopCheckpointFact[]; taskStatus: string | undefined }): Array<{ fact: LoopCheckpointFact; observation: StepCompletionObservation; completionEvidence: string }> {
  const ordered = [...input.facts].sort((left, right) => left.revision - right.revision);
  const finalOutcomeKnown = isTerminalTaskStatus(input.taskStatus);
  return ordered.map((fact, index) => {
    const continuedAfterStep = index < ordered.length - 1;
    const workHappened = (fact.completedCount ?? 0) > 0;
    const noOpenWork = fact.pendingCount === 0;
    const taskComplete = !isCompileStep(fact) && noOpenWork && workHappened;
    const basis = isCompileStep(fact)
      ? "this is the compile step, which precedes any work item"
      : fact.pendingCount === undefined
        ? "the ledger did not record its open work, so completion is not claimed"
        : noOpenWork && !workHappened
          ? "no open work, but no completed work either"
          : `pending ${fact.pendingCount}, completed ${fact.completedCount ?? "unknown"}`;
    const observation: StepCompletionObservation = {
      stepIndex: fact.revision,
      taskComplete,
      unresolvedCount: fact.pendingCount,
      terminationReason: fact.nextAction ?? fact.checkpointReason ?? "UNKNOWN",
      continuedAfterStep,
      finalOutcomeKnown
    };
    return {
      fact,
      observation,
      completionEvidence: `checkpoint revision ${fact.revision} at ${fact.capturedAt}: ${basis}; the loop's next action was ${observation.terminationReason}`
    };
  });
}

export interface CompletionConsistencyProblem {
  taskId: string;
  kind: "TERMINAL_BUT_NOT_COMPLETE" | "RUNNING_BUT_COMPLETE" | "NO_STEPS";
  detail: string;
}

/**
 * Checks a derivation against the task's own status.
 *
 * A terminal task whose last step is not complete, or a still-running task whose last step
 * claims completion, means the derivation and the store disagree — and a disagreement about
 * whether a task finished is exactly what would make a false-stop rate meaningless.
 */
export function completionAgreesWithStatus(input: { taskId: string; taskStatus: string | undefined; observations: readonly StepCompletionObservation[] }): CompletionConsistencyProblem[] {
  if (input.observations.length === 0) {
    return [{ taskId: input.taskId, kind: "NO_STEPS", detail: "the task has no step observations, so its completion cannot be checked" }];
  }
  const last = input.observations[input.observations.length - 1];
  const terminal = isTerminalTaskStatus(input.taskStatus);
  if (terminal && !last.taskComplete) {
    return [{ taskId: input.taskId, kind: "TERMINAL_BUT_NOT_COMPLETE", detail: `the store says ${input.taskStatus} but the last step reports unresolved ${last.unresolvedCount ?? "unknown"} with next action ${last.terminationReason}` }];
  }
  if (!terminal && last.taskComplete) {
    return [{ taskId: input.taskId, kind: "RUNNING_BUT_COMPLETE", detail: `the store says ${input.taskStatus ?? "unknown"} but the last step reports completion` }];
  }
  return [];
}

/** The loop's own continuation signals, for a report: how often it chose to keep going after a finished step. */
export function continuationCensus(observations: readonly StepCompletionObservation[]): { steps: number; completeSteps: number; continuedAfterCompleteStep: number; pendingAtEnd: number | undefined } {
  const completeSteps = observations.filter((observation) => observation.taskComplete).length;
  const continuedAfterCompleteStep = observations.filter((observation) => observation.taskComplete && observation.continuedAfterStep).length;
  const last = observations[observations.length - 1];
  return { steps: observations.length, completeSteps, continuedAfterCompleteStep, pendingAtEnd: last?.unresolvedCount };
}
