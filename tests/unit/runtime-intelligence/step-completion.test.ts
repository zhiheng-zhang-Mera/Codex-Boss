import { describe, expect, it } from "vitest";
import {
  COMPILE_MARKERS,
  TERMINAL_TASK_STATUSES,
  completionAgreesWithStatus,
  continuationCensus,
  deriveStepCompletion,
  isTerminalTaskStatus,
  type CompletionConsistencyProblem,
  type LoopCheckpointFact
} from "../../../src/shared/runtime-intelligence/step-completion";
import {
  CONTRIBUTION_SIGNALS,
  CONTRIBUTION_STATES,
  INFERRED_CONTRIBUTION_SIGNALS,
  NON_CONTRIBUTION_SIGNALS,
  OBSERVED_CONTRIBUTION_SIGNALS,
  classifyContribution,
  observeContextContributions,
  summariseContributions,
  type ContributionSignal,
  type ContributionState,
  type ContributionSummary,
  type ContextContributionObservation
} from "../../../src/shared/runtime-intelligence/context-contribution";
import type { StepCompletionObservation } from "../../../src/shared/runtime-intelligence/replay-corpus";

/**
 * Phases N5 and N6.
 *
 * The step-completion rules are tested against the SHAPE THE REAL CHECKPOINTS HAVE, including
 * the trap that made a naive rule wrong: the compile checkpoint also reports zero pending work.
 *
 * The contribution rules are tested on the plan's explicit line — being injected is not
 * contribution — and on keeping "injected and never seen used" apart from "no observation".
 */

const AT = "2026-01-01T00:00:00.000Z";

function fact(revision: number, overrides: Partial<LoopCheckpointFact> = {}): LoopCheckpointFact {
  return { revision, capturedAt: AT, completedCount: 0, pendingCount: 0, nextAction: "running", checkpointReason: "task/run transition", ...overrides };
}

/** The measured shape of the real 33-checkpoint task, abbreviated to its decisive rows. */
function realShapedFacts(): LoopCheckpointFact[] {
  return [
    fact(1, { nextAction: "COMPILE", checkpointReason: "task compiled", completedCount: 0, pendingCount: 0 }),
    fact(2, { nextAction: "queued", completedCount: 0, pendingCount: 3 }),
    fact(7, { nextAction: "IDLE", completedCount: 0, pendingCount: 3 }),
    fact(12, { nextAction: "IDLE", checkpointReason: "provider dispatch budget", completedCount: 0, pendingCount: 3 }),
    fact(18, { nextAction: "WAITING_FOR_RESPONSE", completedCount: 0, pendingCount: 3 }),
    fact(25, { nextAction: "REVIEW_GATE", completedCount: 0, pendingCount: 3 }),
    fact(26, { nextAction: "CONTINUE", completedCount: 1, pendingCount: 2 }),
    fact(29, { nextAction: "CONTINUE", completedCount: 2, pendingCount: 1 }),
    fact(32, { nextAction: "CONTINUE", completedCount: 3, pendingCount: 0 }),
    fact(33, { nextAction: "REPORT_EVIDENCE", completedCount: 3, pendingCount: 0 })
  ];
}

describe("step completion is derived from what the loop recorded", () => {
  it("does not call the compile step complete, even though it reports zero pending work", () => {
    const derived = deriveStepCompletion({ facts: [fact(1, { nextAction: "COMPILE", checkpointReason: "task compiled", completedCount: 0, pendingCount: 0 })], taskStatus: "running" });
    expect(derived[0].observation.taskComplete).toBe(false);
    expect(derived[0].completionEvidence).toContain("compile step");
    expect(COMPILE_MARKERS).toContain("COMPILE");
  });

  it("does not claim completion when the ledger did not record the open work", () => {
    const derived = deriveStepCompletion({ facts: [fact(5, { pendingCount: undefined, completedCount: 2 })], taskStatus: "running" });
    expect(derived[0].observation.taskComplete).toBe(false);
    expect(derived[0].observation.unresolvedCount).toBeUndefined();
    expect(derived[0].completionEvidence).toContain("did not record its open work");
  });

  it("does not claim completion from no open work and no completed work", () => {
    const derived = deriveStepCompletion({ facts: [fact(4, { pendingCount: 0, completedCount: 0 })], taskStatus: "running" });
    expect(derived[0].observation.taskComplete).toBe(false);
    expect(derived[0].completionEvidence).toContain("no completed work either");
  });

  it("marks a step complete only when work happened and nothing is open", () => {
    const derived = deriveStepCompletion({ facts: [fact(33, { pendingCount: 0, completedCount: 3, nextAction: "REPORT_EVIDENCE" })], taskStatus: "completed" });
    expect(derived[0].observation.taskComplete).toBe(true);
    expect(derived[0].observation.terminationReason).toBe("REPORT_EVIDENCE");
    expect(derived[0].observation.finalOutcomeKnown).toBe(true);
  });

  it("derives the whole real-shaped task and finds the steps the loop continued past completion", () => {
    const derived = deriveStepCompletion({ facts: realShapedFacts(), taskStatus: "completed" });
    const observations: StepCompletionObservation[] = derived.map((entry) => entry.observation);
    expect(observations).toHaveLength(10);
    expect(observations.map((observation) => observation.taskComplete)).toEqual([false, false, false, false, false, false, false, false, true, true]);
    // Revision 32 had nothing open and the loop still said CONTINUE: that is the observation a
    // false-stop rate needs, and it exists in real data.
    expect(observations[8].taskComplete).toBe(true);
    expect(observations[8].continuedAfterStep).toBe(true);
    expect(observations[8].terminationReason).toBe("CONTINUE");
    const census = continuationCensus(observations);
    expect(census.steps).toBe(10);
    expect(census.completeSteps).toBe(2);
    expect(census.continuedAfterCompleteStep).toBe(1);
    expect(census.pendingAtEnd).toBe(0);
  });

  it("records the position of every step and marks the last as not continued", () => {
    const derived = deriveStepCompletion({ facts: realShapedFacts(), taskStatus: "completed" });
    expect(derived[0].observation.stepIndex).toBe(1);
    expect(derived[0].observation.continuedAfterStep).toBe(true);
    expect(derived.at(-1)!.observation.stepIndex).toBe(33);
    expect(derived.at(-1)!.observation.continuedAfterStep).toBe(false);
  });

  it("orders by revision regardless of input order", () => {
    const derived = deriveStepCompletion({ facts: [fact(3, { completedCount: 1, pendingCount: 0 }), fact(1, { nextAction: "COMPILE" }), fact(2)], taskStatus: "completed" });
    expect(derived.map((entry) => entry.observation.stepIndex)).toEqual([1, 2, 3]);
  });

  it("reports an unidentified termination reason as UNKNOWN rather than blank", () => {
    const derived = deriveStepCompletion({ facts: [fact(2, { nextAction: undefined, checkpointReason: undefined })], taskStatus: "running" });
    expect(derived[0].observation.terminationReason).toBe("UNKNOWN");
  });

  it("knows which task statuses are terminal", () => {
    expect(isTerminalTaskStatus("completed")).toBe(true);
    expect(isTerminalTaskStatus("failed")).toBe(true);
    expect(isTerminalTaskStatus("running")).toBe(false);
    expect(isTerminalTaskStatus(undefined)).toBe(false);
    expect(TERMINAL_TASK_STATUSES).not.toContain("running");
  });
});

describe("the derivation is checked against the task's own status", () => {
  const complete: StepCompletionObservation = { stepIndex: 33, taskComplete: true, unresolvedCount: 0, terminationReason: "REPORT_EVIDENCE", continuedAfterStep: false, finalOutcomeKnown: true };
  const incomplete: StepCompletionObservation = { stepIndex: 3, taskComplete: false, unresolvedCount: 3, terminationReason: "running", continuedAfterStep: false, finalOutcomeKnown: false };

  it("agrees for a terminal task whose last step is complete, and for a running one that is not", () => {
    expect(completionAgreesWithStatus({ taskId: "t", taskStatus: "completed", observations: [complete] })).toEqual([]);
    expect(completionAgreesWithStatus({ taskId: "t", taskStatus: "running", observations: [incomplete] })).toEqual([]);
  });

  it("reports a terminal task whose last step is not complete", () => {
    const problems: CompletionConsistencyProblem[] = completionAgreesWithStatus({ taskId: "t", taskStatus: "completed", observations: [incomplete] });
    expect(problems[0].kind).toBe("TERMINAL_BUT_NOT_COMPLETE");
    expect(problems[0].detail).toContain("unresolved 3");
  });

  it("reports a running task whose last step claims completion", () => {
    const problems = completionAgreesWithStatus({ taskId: "t", taskStatus: "running", observations: [complete] });
    expect(problems[0].kind).toBe("RUNNING_BUT_COMPLETE");
  });

  it("reports a task with no steps rather than passing vacuously", () => {
    expect(completionAgreesWithStatus({ taskId: "t", taskStatus: "completed", observations: [] })[0].kind).toBe("NO_STEPS");
  });
});

describe("being injected is not contribution", () => {
  it("declares the three states and the signal vocabulary", () => {
    expect(CONTRIBUTION_STATES).toEqual(["OBSERVED_CONTRIBUTION", "INFERRED_CONTRIBUTION", "UNKNOWN"]);
    expect(CONTRIBUTION_SIGNALS).toEqual(["cited-in-output", "matched-by-review", "used-by-tool", "referenced", "injected", "retrieved"]);
    expect(OBSERVED_CONTRIBUTION_SIGNALS).toEqual(["cited-in-output", "matched-by-review", "used-by-tool"]);
    expect(INFERRED_CONTRIBUTION_SIGNALS).toEqual(["referenced"]);
    expect(NON_CONTRIBUTION_SIGNALS).toEqual(["injected", "retrieved"]);
  });

  it("reports UNKNOWN for a record that was only retrieved and injected", () => {
    const observation: ContextContributionObservation = classifyContribution({ recordId: "c1", signals: ["retrieved", "injected"] });
    expect(observation.state).toBe("UNKNOWN");
    expect(observation.reasons.join(" ")).toContain("is not contribution");
  });

  it("reports UNKNOWN for a record with no signal at all", () => {
    const observation = classifyContribution({ recordId: "c2", signals: [] });
    expect(observation.state).toBe("UNKNOWN");
    expect(observation.reasons.join(" ")).toContain("no contribution signal was observed");
  });

  it("reports OBSERVED_CONTRIBUTION only for a signal something actually did", () => {
    for (const signal of OBSERVED_CONTRIBUTION_SIGNALS) {
      const observation = classifyContribution({ recordId: "c3", signals: [signal] });
      expect(observation.state).toBe("OBSERVED_CONTRIBUTION");
      expect(observation.reasons.join(" ")).toContain("observed:");
    }
  });

  it("reports INFERRED_CONTRIBUTION for a reference, and says it is a link and not an effect", () => {
    const observation = classifyContribution({ recordId: "c4", signals: ["referenced"] });
    expect(observation.state).toBe("INFERRED_CONTRIBUTION");
    expect(observation.reasons.join(" ")).toContain("not an effect");
  });

  it("lets an observed signal outrank an inference", () => {
    const observation = classifyContribution({ recordId: "c5", signals: ["referenced", "used-by-tool", "injected"] });
    expect(observation.state).toBe("OBSERVED_CONTRIBUTION");
    expect(observation.signals).toEqual(["used-by-tool", "referenced", "injected"]);
  });

  it("ignores a signal it does not recognise instead of treating it as weak evidence", () => {
    const observation = classifyContribution({ recordId: "c6", signals: ["felt-relevant" as ContributionSignal] });
    expect(observation.state).toBe("UNKNOWN");
    expect(observation.signals).toEqual([]);
  });

  it("builds observations from a signal table only, so a caller cannot assert a contribution", () => {
    const observations = observeContextContributions({ records: [{ recordId: "a", signals: ["injected"] }, { recordId: "b" }, { recordId: "c", signals: ["cited-in-output"] }] });
    expect(observations.map((observation) => observation.state)).toEqual(["UNKNOWN", "UNKNOWN", "OBSERVED_CONTRIBUTION"]);
  });
});

describe("the summary keeps measurable waste apart from an instrumentation gap", () => {
  const observations = observeContextContributions({
    records: [{ recordId: "used", signals: ["used-by-tool"] }, { recordId: "referenced", signals: ["referenced"] }, { recordId: "injected", signals: ["injected", "retrieved"] }, { recordId: "silent" }]
  });

  it("counts by state and names each set", () => {
    const summary: ContributionSummary = summariseContributions(observations);
    expect(summary.records).toBe(4);
    expect(summary.byState).toEqual({ OBSERVED_CONTRIBUTION: 1, INFERRED_CONTRIBUTION: 1, UNKNOWN: 2 });
    expect(summary.observedRecordIds).toEqual(["used"]);
    expect(summary.inferredRecordIds).toEqual(["referenced"]);
    expect(summary.injectedButUnattributed).toEqual(["injected"]);
    expect(summary.noSignalRecordIds).toEqual(["silent"]);
  });

  it("says plainly that injected-and-unattributed is waste and not proof of uselessness", () => {
    const summary = summariseContributions(observations);
    expect(summary.notes.join(" ")).toContain("measurable waste, not proof the record was useless");
    expect(summary.notes.join(" ")).toContain("instrumentation gap");
  });

  it("says the question cannot be answered yet when nothing was observed", () => {
    const summary = summariseContributions(observeContextContributions({ records: [{ recordId: "a", signals: ["injected"] }] }));
    expect(summary.notes.join(" ")).toContain("cannot be answered yet");
    const states: ContributionState[] = ["OBSERVED_CONTRIBUTION", "INFERRED_CONTRIBUTION", "UNKNOWN"];
    expect(states.map((state) => summary.byState[state])).toEqual([0, 0, 1]);
  });

  it("reports an empty summary for no observations", () => {
    const summary = summariseContributions([]);
    expect(summary.records).toBe(0);
    expect(summary.byState).toEqual({ OBSERVED_CONTRIBUTION: 0, INFERRED_CONTRIBUTION: 0, UNKNOWN: 0 });
  });
});
