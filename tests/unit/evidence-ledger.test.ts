/**
 * checkpoint-1 §31.3 — Evidence Ledger.
 */
import { describe, expect, it } from "vitest";
import {
  emptyLedger,
  evidenceForRequirements,
  evidenceKindForGate,
  highestPassingGate,
  ledgerForRequirement,
  outstandingEvidence,
  recordEvidence,
  summarizeLedger,
  type EvidenceEnvironment
} from "../../src/shared/evidence-ledger";
import { buildRequirementsGraph, type RequirementsGraph } from "../../src/shared/requirements-graph";
import type { CompiledTaskContract } from "../../src/shared/task-contract";

const ENV: EvidenceEnvironment = { host: "acceptance", platform: "win32", runtimes: { node: "24" } };

function declaration(kind: string, items: string[]) {
  return {
    kind: kind as never, authority: "WORKBOOK" as const, source_document_id: "doc-1",
    items, text: items.join("\n"), overridable: true,
    item_provenance: items.map((item) => ({ item, source_document_id: "doc-1", heading: kind }))
  };
}

function graph(): RequirementsGraph {
  const contract = {
    version: 1,
    goal: [declaration("GOAL", ["ship the latency guard"])],
    scope: [declaration("SCOPE", ["gateway adapter"])],
    constraints: [],
    inputs: [],
    dependencies: [],
    deliverables: [declaration("DELIVERABLES", ["latency guard module"])],
    acceptance_criteria: [declaration("ACCEPTANCE_CRITERIA", ["AC-1 the guard aborts a slow call"])],
    risk: [],
    permissions: [],
    execution_strategy: { mode: "WORK", analysis_only: false, requires_planning: false, required_capabilities: [], reference_sections: [], rationale: "fixture" },
    source_workbook: { document_ids: ["doc-1"], classifications: [], primary_document_id: "doc-1", has_workbook: true },
    overrides: [],
    diagnostics: { warnings: [], missing: [], analysis_only_reasons: [], classification_reasons: [] }
  } as unknown as CompiledTaskContract;
  return buildRequirementsGraph({ contract, now: "2026-01-01T00:00:00.000Z" });
}

describe("§31.3 evidence ledger", () => {
  const requirements = graph();
  const deliverable = requirements.nodes.find((node) => node.type === "DELIVERABLE")!;
  const acceptance = requirements.nodes.find((node) => node.type === "ACCEPTANCE")!;

  it("records an observation with everything a reviewer needs", () => {
    const ledger = emptyLedger();
    const { entry, appended } = recordEvidence(ledger, {
      requirement_ids: [deliverable.id], gate: "TYPECHECK", command: "pnpm run typecheck",
      environment: ENV, result: "PASS", captured_at: "2026-01-01T00:00:00.000Z", exit_code: 0, duration_ms: 4200
    });
    expect(appended).toBe(true);
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.id).toMatch(/^ev-[0-9a-f]{16}$/);
    expect(entry.environment.host).toBe("acceptance");
    expect(entry.exit_code).toBe(0);
    expect(entry.duration_ms).toBe(4200);
    expect(summarizeLedger(ledger).total).toBe(1);
  });

  it("does not append the same observation twice", () => {
    const ledger = emptyLedger();
    const input = { requirement_ids: [deliverable.id], gate: "UNIT" as const, command: "pnpm test", environment: ENV, result: "PASS" as const, captured_at: "2026-01-01T00:00:00.000Z" };
    expect(recordEvidence(ledger, input).appended).toBe(true);
    expect(recordEvidence(ledger, input).appended).toBe(false);
    expect(ledger.entries).toHaveLength(1);
  });

  it("filters by requirement and finds the strongest passing gate", () => {
    const ledger = emptyLedger();
    recordEvidence(ledger, { requirement_ids: [deliverable.id], gate: "SYNTAX", command: "node --check", environment: ENV, result: "PASS", captured_at: "2026-01-01T00:00:01.000Z" });
    recordEvidence(ledger, { requirement_ids: [deliverable.id], gate: "TYPECHECK", command: "pnpm run typecheck", environment: ENV, result: "PASS", captured_at: "2026-01-01T00:00:02.000Z" });
    recordEvidence(ledger, { requirement_ids: [acceptance.id], gate: "UNIT", command: "vitest run", environment: ENV, result: "FAIL", captured_at: "2026-01-01T00:00:03.000Z" });
    expect(ledgerForRequirement(ledger, deliverable.id)).toHaveLength(2);
    expect(highestPassingGate(ledger, deliverable.id).gate).toBe("TYPECHECK");
    expect(highestPassingGate(ledger, acceptance.id).rank).toBe(0);
    const summary = summarizeLedger(ledger);
    expect(summary.by_result.FAIL).toBe(1);
    expect(summary.requirements.find((entry) => entry.requirement_id === acceptance.id)?.failed).toBe(1);
  });

  it("maps gates to the evidence kinds the §28.4 binding understands", () => {
    expect(evidenceKindForGate("SYNTAX")).toEqual(["IMPLEMENTATION"]);
    expect(evidenceKindForGate("TYPECHECK")).toEqual(["IMPLEMENTATION"]);
    expect(evidenceKindForGate("UNIT")).toEqual(["TEST"]);
    expect(evidenceKindForGate("BUILD")).toEqual(["TEST"]);
    expect(evidenceKindForGate("VISUAL")).toEqual(["VISUAL_VERIFICATION"]);
  });

  it("never invents review, preview or screenshot evidence", () => {
    const ledger = emptyLedger();
    for (const gate of ["SYNTAX", "TYPECHECK", "UNIT", "BUILD", "RUNTIME", "VISUAL"] as const) {
      recordEvidence(ledger, { requirement_ids: [acceptance.id], gate, command: `run ${gate}`, environment: ENV, result: "PASS", captured_at: `2026-01-01T00:00:0${gate.length}.000Z` });
    }
    const kinds = new Set(evidenceForRequirements(ledger, requirements).map((entry) => entry.kind));
    expect(kinds.has("REVIEW")).toBe(false);
    expect(kinds.has("SCREENSHOT")).toBe(false);
    expect(kinds.has("PREVIEW")).toBe(false);
    const missing = outstandingEvidence(ledger, requirements).find((entry) => entry.requirement_id === acceptance.id)?.missing ?? [];
    expect(missing).toContain("REVIEW");
  });

  it("reports what the ledger still owes per requirement", () => {
    const ledger = emptyLedger();
    recordEvidence(ledger, { requirement_ids: [deliverable.id], gate: "TYPECHECK", command: "pnpm run typecheck", environment: ENV, result: "PASS", captured_at: "2026-01-01T00:00:00.000Z" });
    recordEvidence(ledger, { requirement_ids: [deliverable.id], gate: "UNIT", command: "pnpm test", environment: ENV, result: "PASS", captured_at: "2026-01-01T00:00:01.000Z" });
    const outstanding = outstandingEvidence(ledger, requirements);
    expect(outstanding.find((entry) => entry.requirement_id === deliverable.id)).toBeUndefined();
    expect(outstanding.length).toBeGreaterThan(0);
    expect(outstanding.every((entry) => entry.missing.length > 0)).toBe(true);
  });

  it("carries the artifact and its hash through to the §28.4 evidence", () => {
    const ledger = emptyLedger();
    recordEvidence(ledger, {
      requirement_ids: [deliverable.id], gate: "UNIT", command: "vitest run tests/unit/x.test.ts", environment: ENV,
      result: "PASS", captured_at: "2026-01-01T00:00:00.000Z", artifact: "artifacts/acceptance/unit.json", artifact_hash: "b".repeat(64)
    });
    const evidence = evidenceForRequirements(ledger, requirements).filter((entry) => entry.requirement_id === deliverable.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].kind).toBe("TEST");
    expect(evidence[0].artifact).toBe("artifacts/acceptance/unit.json");
    expect(evidence[0].hash).toBe("b".repeat(64));
    expect(evidence[0].command).toContain("vitest");
  });
});
