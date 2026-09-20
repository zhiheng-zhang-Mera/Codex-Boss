import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_CONFIDENCE,
  ATTRIBUTION_SOURCES,
  DIRECT_ATTRIBUTION_SOURCES,
  attributeStep,
  censusAttributions,
  type AttributionCensus,
  type AttributionSource,
  type StepAttributionInput,
  type StepDispatchAttribution
} from "../../../src/shared/runtime-intelligence/dispatch-attribution";

/**
 * Phase N-attribution. The rule under test is that a step's own worker sessions are direct
 * evidence of which provider it dispatched to, that a step with several sessions is several
 * dispatch decisions, and that anything weaker is labelled as weaker rather than averaged in.
 */

const AT = "2026-01-01T00:00:00.000Z";

function input(overrides: Partial<StepAttributionInput> = {}): StepAttributionInput {
  return { recordId: "t:rev1", stepIndex: 1, sessionProviders: [], ...overrides };
}

describe("the sources are ordered from direct evidence to a stated fallback", () => {
  it("declares the vocabulary and a confidence for each source", () => {
    expect(ATTRIBUTION_SOURCES).toEqual(["DIRECT_CHECKPOINT", "RUN_MATCH", "SESSION_MATCH", "TASK_FALLBACK", "UNKNOWN"]);
    for (const source of ATTRIBUTION_SOURCES) {
      expect(ATTRIBUTION_CONFIDENCE[source]).toBeGreaterThanOrEqual(0);
      expect(ATTRIBUTION_CONFIDENCE[source]).toBeLessThanOrEqual(1);
    }
    expect(ATTRIBUTION_CONFIDENCE.DIRECT_CHECKPOINT).toBe(1);
    expect(ATTRIBUTION_CONFIDENCE.TASK_FALLBACK).toBeLessThan(ATTRIBUTION_CONFIDENCE.SESSION_MATCH);
    expect(ATTRIBUTION_CONFIDENCE.UNKNOWN).toBe(0);
    expect(DIRECT_ATTRIBUTION_SOURCES).toEqual(["DIRECT_CHECKPOINT", "RUN_MATCH"]);
    expect(ATTRIBUTION_CONFIDENCE.UNKNOWN).toBe(0);
    expect(AT).toBeTruthy();
  });
});

describe("the step's own sessions are the direct evidence", () => {
  it("attributes a step to the providers its checkpoint recorded", () => {
    const attributions = attributeStep(input({ sessionProviders: ["web:chatgpt"] }));
    expect(attributions).toHaveLength(1);
    expect(attributions[0].attributionSource).toBe("DIRECT_CHECKPOINT");
    expect(attributions[0].provider).toBe("web:chatgpt");
    expect(attributions[0].confidence).toBe(1);
    expect(attributions[0].stepIndex).toBe(1);
    expect(attributions[0].recordId).toBe("t:rev1");
    // A web transport exposes no model version, so the model identity says unknown.
    expect(attributions[0].model).toBe("web:chatgpt:unknown");
  });

  it("treats three worker sessions as three dispatch decisions, not one ambiguity", () => {
    const attributions = attributeStep(input({ sessionProviders: ["web:chatgpt", "web:qwen", "web:grok"] }));
    expect(attributions).toHaveLength(3);
    expect(attributions.map((entry) => entry.provider)).toEqual(["web:chatgpt", "web:grok", "web:qwen"]);
    expect(attributions.every((entry) => entry.attributionSource === "DIRECT_CHECKPOINT")).toBe(true);
  });

  it("deduplicates and sorts providers so a report is deterministic", () => {
    const attributions = attributeStep(input({ sessionProviders: ["web:qwen", "web:chatgpt", "web:qwen"] }));
    expect(attributions.map((entry) => entry.provider)).toEqual(["web:chatgpt", "web:qwen"]);
  });

  it("ignores a blank provider rather than attributing to an empty string", () => {
    const attributions = attributeStep(input({ sessionProviders: ["", "  ", "web:gemini"] }));
    expect(attributions).toHaveLength(1);
    expect(attributions[0].provider).toBe("web:gemini");
  });

  it("falls back to a run interval, then to the task, in that order", () => {
    const byRun = attributeStep(input({ runProviders: ["web:claude"] }));
    expect(byRun[0].attributionSource).toBe("RUN_MATCH");
    expect(byRun[0].confidence).toBe(ATTRIBUTION_CONFIDENCE.RUN_MATCH);
    const byTask = attributeStep(input({ taskProviders: ["web:chatgpt"] }));
    expect(byTask[0].attributionSource).toBe("TASK_FALLBACK");
    expect(byTask[0].confidence).toBe(ATTRIBUTION_CONFIDENCE.TASK_FALLBACK);
    // A session outranks both, even when they are present.
    const preferred = attributeStep(input({ sessionProviders: ["web:gemini"], runProviders: ["web:claude"], taskProviders: ["web:chatgpt"] }));
    expect(preferred.map((entry) => entry.attributionSource)).toEqual(["DIRECT_CHECKPOINT"]);
  });

  it("returns an UNKNOWN attribution rather than an empty list when nothing is known", () => {
    const attributions = attributeStep(input());
    expect(attributions).toHaveLength(1);
    expect(attributions[0].attributionSource).toBe("UNKNOWN");
    expect(attributions[0].provider).toBeUndefined();
    expect(attributions[0].model).toBe("unknown:unknown");
  });
});

describe("the census says what the sample actually is", () => {
  function censusOf(entries: StepDispatchAttribution[]): AttributionCensus {
    return censusAttributions(entries);
  }

  it("counts by source and reports the direct share", () => {
    const attributions = [
      ...attributeStep(input({ recordId: "a", sessionProviders: ["web:chatgpt", "web:qwen"] })),
      ...attributeStep(input({ recordId: "b", taskProviders: ["web:chatgpt"] })),
      ...attributeStep(input({ recordId: "c" }))
    ];
    const census = censusOf(attributions);
    expect(census.total).toBe(4);
    expect(census.bySource.DIRECT_CHECKPOINT).toBe(2);
    expect(census.bySource.TASK_FALLBACK).toBe(1);
    expect(census.bySource.UNKNOWN).toBe(1);
    expect(census.directCount).toBe(2);
    expect(census.fallbackCount).toBe(1);
    expect(census.unknownCount).toBe(1);
    expect(census.providers).toEqual(["web:chatgpt", "web:qwen"]);
  });

  it("warns that a fallback must not be reported as per-dispatch evidence", () => {
    const census = censusOf(attributeStep(input({ taskProviders: ["web:chatgpt"] })));
    expect(census.notes.join(" ")).toContain("must not be reported as per-dispatch evidence");
    expect(census.directCount).toBe(0);
  });

  it("says a per-dispatch benchmark is impossible when nothing is direct", () => {
    const census = censusOf(attributeStep(input({ taskProviders: ["web:chatgpt"] })));
    expect(census.notes.join(" ")).toContain("cannot be computed from this corpus");
  });

  it("names the steps that recorded no provider", () => {
    const census = censusOf(attributeStep(input()));
    expect(census.notes.join(" ")).toContain("recorded no provider at all");
  });

  it("reports an empty census for no attributions", () => {
    const census = censusOf([]);
    expect(census.total).toBe(0);
    expect(census.directCount).toBe(0);
    expect(census.providers).toEqual([]);
    const source: AttributionSource = "DIRECT_CHECKPOINT";
    expect(census.bySource[source]).toBe(0);
  });
});
