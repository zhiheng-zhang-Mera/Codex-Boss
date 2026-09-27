import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HumanGuidanceGate } from "../../electron/commander/human-guidance-gate";
import { readInterventions } from "../../electron/bootstrap/host-status-ipc";
import {
  INTERVENTION_SCHEMA_VERSION,
  interventionFileDocument,
  parseInterventionFile,
  unresolvedInterventions
} from "../../src/shared/intervention-file";
import type { HumanInterventionRequest } from "../../src/shared/intervention";

/**
 * PF-DEBT-005 — the writer and the reader must agree, and the reader must not call a failure "nothing".
 *
 * The store was written as `{ schemaVersion, interventions: [...] }` and read as `{ items: [...] }`,
 * inside a `try/catch` that reported every problem as "interventions.json absent". The observation
 * surface therefore reported **zero** unresolved human interventions, always — invisible tasks, and a
 * defect that looked exactly like good news.
 *
 * WHY THE READ SIDE CHANGED (ledger CC-075). These cases used to obtain their read side from
 * `collectHostSnapshot` in `electron/host/host-observer-collector.ts`, which has NO production caller.
 * A guarantee about a read path the product never runs is not a guarantee, so the read side is now
 * `readInterventions` from the LIVE `status` module — the same code path the `boss:interventions`
 * channel returns. The defect, the writer, the parser and the assertions are unchanged; only the
 * surface being held to them is real now.
 *
 * These tests exercise BOTH sides against one file, so a future divergence fails here rather than
 * quietly emptying a report. They are deliberately two-way: it is not enough that an unresolved pause
 * is collected, a resolved one must NOT be, or the surface would cry wolf forever.
 */

const AT = "2026-09-16T00:00:00.000Z";
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-intervention-contract-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const storePath = (): string => path.join(dir, ".boss", "interventions.json");

function request(overrides: Partial<HumanInterventionRequest> = {}): Omit<HumanInterventionRequest, "id" | "createdAt"> {
  return {
    taskId: "task-1",
    kind: "LOGIN",
    question: "Sign in to the provider so the run can continue.",
    blockingStepId: "step-login",
    contextSummary: "the provider page is waiting at the sign-in screen",
    ...overrides
  };
}

/** The unresolved interventions the LIVE production read side reports for this data root. */
function collectedInterventions(): Array<{ taskId: string; kind: string; question: string }> {
  return readInterventions(dir).unresolved;
}

/** The degradation the live read side reports, as a single string. */
function degradationNote(): string {
  const model = readInterventions(dir);
  return model.unreadable ? `interventions: ${model.reason ?? "unreadable"}` : "";
}

describe("Phase 06 — interventions.json is one contract with two consumers", () => {
  it("collects an UNRESOLVED intervention the gate wrote", async () => {
    const gate = new HumanGuidanceGate(storePath());
    gate.raise(request());

    const collected = await collectedInterventions();
    expect(collected).toHaveLength(1);
    expect(collected[0].taskId).toBe("task-1");
    expect(collected[0].kind).toBe("LOGIN");
    // The detail is the question the task is actually waiting on — the field the old reader expected
    // the writer to have named differently.
    expect(collected[0].question).toContain("Sign in to the provider");
  });

  it("does NOT collect an intervention after it is resolved", async () => {
    const gate = new HumanGuidanceGate(storePath());
    gate.raise(request());
    expect(await collectedInterventions()).toHaveLength(1);

    gate.resolve("task-1", "LOGIN", "signed in");
    // The other direction of the same contract: a resolved pause must disappear from the surface, or
    // the report cries wolf and stops being read.
    expect(await collectedInterventions()).toHaveLength(0);
  });

  it("round-trips the gate's own file through the shared parser", () => {
    const gate = new HumanGuidanceGate(storePath());
    const raised = gate.raise(request());
    const parsed = parseInterventionFile(fs.readFileSync(storePath(), "utf8"));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.interventions).toHaveLength(1);
    // Every field the reader surfaces survives the round trip.
    expect(parsed.interventions[0]).toMatchObject({
      id: raised.id,
      taskId: "task-1",
      kind: "LOGIN",
      question: raised.question,
      blockingStepId: "step-login"
    });
  });

  it("restores the gate from a file the shared document builder wrote", () => {
    // The writer's shape and the builder's shape are the same shape, asserted rather than assumed.
    const document = interventionFileDocument([{ id: "i-1", createdAt: AT, ...request() }]);
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(document, null, 2), "utf8");
    expect(document.schemaVersion).toBe(INTERVENTION_SCHEMA_VERSION);

    const reopened = new HumanGuidanceGate(storePath());
    expect(reopened.activeFor("task-1")?.id).toBe("i-1");
  });

  it("treats a MISSING file as 'no interventions', which is not a degradation", async () => {
    // A fresh install has no pauses. This is the one case where empty is the truth.
    expect(fs.existsSync(storePath())).toBe(false);
    expect(collectedInterventions()).toHaveLength(0);
    expect(degradationNote()).toBe("");
  });

  it("reports an UNREADABLE store as a degradation instead of as nothing", async () => {
    // The heart of the defect: "I could not read the pauses" and "there are no pauses" are opposite
    // facts, and only one of them is safe to assume.
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), "{ this is not json", "utf8");

    expect(collectedInterventions()).toHaveLength(0);
    expect(degradationNote()).toContain("interventions");
  });

  it("reports an unrecognised schema version rather than reading it as empty", () => {
    const parsed = parseInterventionFile(JSON.stringify({ schemaVersion: 99, interventions: [] }));
    expect(parsed.status).toBe("unreadable");
    if (parsed.status === "unreadable") expect(parsed.reason).toContain("schemaVersion");
    // And the flat projection of an unreadable store is empty WITHOUT claiming the store is empty —
    // the caller reads `status` to tell the difference, which is why the status exists.
    expect(unresolvedInterventions(parsed)).toEqual([]);
  });

  it("refuses a document whose entry violates the intervention contract", () => {
    // A pause that cannot be validated is a task that cannot be resumed, so it fails the whole read
    // rather than being dropped entry by entry.
    const broken = JSON.stringify({ schemaVersion: 1, interventions: [{ id: "x", taskId: "t", kind: "NONSENSE", question: "q", blockingStepId: "s" }] });
    const parsed = parseInterventionFile(broken);
    expect(parsed.status).toBe("unreadable");
    if (parsed.status === "unreadable") expect(parsed.reason).toContain("invalid intervention entry");
  });

  it("fails closed when the gate cannot understand its own store", () => {
    // The gate must never start from an empty map when a pause exists but is unreadable.
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), "not json at all", "utf8");
    expect(() => new HumanGuidanceGate(storePath())).toThrow(/interventions\.json/);
  });

  it("names the question field the same on both sides, so the reader cannot look for the wrong one", () => {
    const gate = new HumanGuidanceGate(storePath());
    const raised = gate.raise(request({ question: "Which direction should the research take?" }));
    const written = JSON.parse(fs.readFileSync(storePath(), "utf8")) as { interventions: Array<Record<string, unknown>> };
    expect(Object.keys(written.interventions[0])).toContain("question");
    expect(written.interventions[0].question).toBe(raised.question);
  });
});
