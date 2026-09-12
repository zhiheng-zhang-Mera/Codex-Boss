/**
 * checkpoint-1 §28 — requirement types, dependency edges and the state machine.
 */
import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_TRANSITIONS,
  bindAcceptance,
  buildRequirementsGraph,
  evidenceTemplate,
  findRequirementCycle,
  isOptionalRequirement,
  isVisualRequirement,
  readyRequirements,
  requiredEvidenceKinds,
  topologicalRequirementOrder,
  transitionRequirement,
  type RequirementEvidence,
  type RequirementsGraph
} from "../../src/shared/requirements-graph";
import { compileTaskContract, type CompiledTaskContract } from "../../src/shared/task-contract";
import { ingestDocuments } from "../../electron/ingestion/ingest";

const WORKBOOK = [
  "# Installment checkout",
  "",
  "## Goal",
  "Let users choose installments at checkout.",
  "",
  "## Scope",
  "- checkout page payment options",
  "",
  "## Deliverables",
  "- installment selector component",
  "- gateway adapter implementation",
  "",
  "## Dependencies",
  "- payment gateway sandbox credentials",
  "",
  "## Constraints",
  "- the selector must not slow checkout by more than 100 ms",
  "- the selector reuses the existing payment option markup",
  "",
  "## Risks",
  "- the gateway must not be called twice for one order",
  "",
  "## Acceptance Criteria",
  "- [ ] FR-1 the installment selector is visible at checkout",
  "- [ ] AC-2 gateway failure falls back to full payment",
  "- [ ] appearance matches the approved visual design (optional)"
].join("\n");

async function compile(text = WORKBOOK): Promise<CompiledTaskContract> {
  const ingested = await ingestDocuments([
    { file_name: "checkout.md", bytes: new Uint8Array(Buffer.from(text, "utf8")), created_at: "2026-01-01T00:00:00.000Z" }
  ]);
  return compileTaskContract({
    documents: ingested.documents,
    userText: "",
    analysisOnly: { kind: "EXECUTE", confidence: 0.9, reasons: [] }
  });
}

describe("§28.1 requirement types", () => {
  it("maps the contract onto the plan's requirement vocabulary", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    const types = new Set(graph.nodes.map((node) => node.type));
    expect(types.has("GOAL")).toBe(true);
    expect(types.has("FUNCTIONAL")).toBe(true);
    expect(types.has("DELIVERABLE")).toBe(true);
    expect(types.has("DEPENDENCY")).toBe(true);
    expect(types.has("CONSTRAINT")).toBe(true);
    expect(types.has("ACCEPTANCE")).toBe(true);
    expect(types.has("PROHIBITION") || types.has("CONSTRAINT")).toBe(true);
    // A "must not" constraint is typed as a prohibition, so a plain constraint
    // item is needed for the CONSTRAINT type to appear at all.
    expect(types.has("CONSTRAINT")).toBe(true);
    expect(types.has("PROHIBITION")).toBe(true);
    expect(types.has("OPTIONAL")).toBe(true);
    expect(graph.nodes.some((node) => node.visual)).toBe(true);
    expect(graph.counts.GOAL).toBe(1);
  });

  it("types a purely visual requirement as VISUAL", async () => {
    const text = [
      "# Theme refresh",
      "",
      "## Goal",
      "Make the interface feel calmer.",
      "",
      "## Scope",
      "- sidebar and card styling",
      "",
      "## Acceptance Criteria",
      "- [ ] the sidebar colour matches the approved palette"
    ].join("\n");
    const graph = buildRequirementsGraph({ contract: await compile(text) });
    const visual = graph.nodes.filter((node) => node.type === "VISUAL");
    expect(visual.length).toBeGreaterThan(0);
    expect(visual.every((node) => node.visual)).toBe(true);
    expect(graph.visual_requirements.length).toBeGreaterThan(0);
  });

  it("carries contract provenance on every node", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    for (const node of graph.nodes) {
      expect(node.provenance.document_id.length, node.id).toBeGreaterThan(0);
      expect(node.provenance.declaration_kind.length, node.id).toBeGreaterThan(0);
      expect(node.provenance.item_index, node.id).toBeGreaterThanOrEqual(0);
      expect(node.text.trim().length, node.id).toBeGreaterThan(0);
    }
  });

  it("detects visual and optional wording", () => {
    expect(isVisualRequirement("the sidebar colour must match the theme")).toBe(true);
    expect(isVisualRequirement("界面主题要偏冷")).toBe(true);
    expect(isVisualRequirement("the gateway adapter retries once")).toBe(false);
    expect(isOptionalRequirement("(optional) add a tooltip")).toBe(true);
    expect(isOptionalRequirement("可选：增加提示")).toBe(true);
  });

  it("turns a user override into a USER-authority requirement", async () => {
    const ingested = await ingestDocuments([{ file_name: "checkout.md", bytes: new Uint8Array(Buffer.from(WORKBOOK, "utf8")), created_at: "2026-01-01T00:00:00.000Z" }]);
    const contract = compileTaskContract({ documents: ingested.documents, userText: "不要修改 UI，其他按工作书执行", analysisOnly: { kind: "EXECUTE", confidence: 0.9, reasons: [] } });
    const graph = buildRequirementsGraph({ contract, now: "2026-01-01T00:00:00.000Z" });
    const override = graph.nodes.find((node) => node.authority === "USER");
    expect(override).toBeDefined();
    expect(override!.text).toContain("不要修改 UI");
    expect(override!.depends_on.length).toBeGreaterThanOrEqual(0);
  });
});

describe("§28.2 dependency edges", () => {
  it("links requirements with an explanation for every edge", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      expect(edge.reason.length, `${edge.from}→${edge.to}`).toBeGreaterThan(0);
      expect(["DEPENDS_ON", "VERIFIES", "DERIVES"]).toContain(edge.kind);
    }
    expect(graph.edges.some((edge) => edge.kind === "VERIFIES")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "DERIVES")).toBe(true);
  });

  it("keeps depends_on and blocks consistent", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    for (const edge of graph.edges) {
      const from = graph.nodes.find((node) => node.id === edge.from)!;
      const to = graph.nodes.find((node) => node.id === edge.to)!;
      expect(from.depends_on).toContain(to.id);
      expect(to.blocks).toContain(from.id);
    }
  });

  it("is acyclic and yields a dependencies-first order", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    expect(findRequirementCycle(graph.nodes)).toEqual([]);
    const order = topologicalRequirementOrder(graph);
    expect(order.length).toBe(graph.nodes.length);
    const position = new Map(order.map((id, index) => [id, index]));
    for (const edge of graph.edges.filter((entry) => entry.kind === "DEPENDS_ON" || entry.kind === "VERIFIES")) {
      expect(position.get(edge.from)!, `${edge.from}→${edge.to}`).toBeGreaterThan(position.get(edge.to)!);
    }
  });

  it("reports a cycle as a diagnostic instead of crashing", () => {
    const graph: RequirementsGraph = {
      schemaVersion: 1, version: "requirements-graph-1", nodes: [
        { id: "A", type: "FUNCTIONAL", text: "a", provenance: { document_id: "d", declaration_kind: "SCOPE", item_index: 0 }, authority: "WORKBOOK", overridable: true, visual: false, state: "UNSTARTED", depends_on: ["B"], blocks: [], state_reason: "" },
        { id: "B", type: "FUNCTIONAL", text: "b", provenance: { document_id: "d", declaration_kind: "SCOPE", item_index: 1 }, authority: "WORKBOOK", overridable: true, visual: false, state: "UNSTARTED", depends_on: ["A"], blocks: [], state_reason: "" }
      ],
      edges: [{ from: "A", to: "B", kind: "DEPENDS_ON", reason: "test" }, { from: "B", to: "A", kind: "DEPENDS_ON", reason: "test" }],
      visual_requirements: [], counts: { FUNCTIONAL: 2 }, states: { UNSTARTED: 2 }, diagnostics: [], created_at: "2026-01-01T00:00:00.000Z"
    };
    expect(findRequirementCycle(graph.nodes).length).toBeGreaterThan(0);
  });

  it("lists only requirements whose dependencies are satisfied as ready", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    const ready = readyRequirements(graph);
    const goals = graph.nodes.filter((node) => node.type === "GOAL").map((node) => node.id);
    expect(ready.map((node) => node.id)).toContain(goals[0]);
    graph.nodes.find((node) => node.id === goals[0])!.state = "VERIFIED";
    const stillReady = readyRequirements(graph).map((node) => node.id);
    expect(stillReady.length).toBeGreaterThanOrEqual(ready.length);
  });
});

describe("§28.3 requirement state machine", () => {
  it("allows only the declared transitions", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    const id = graph.nodes[0].id;
    expect(transitionRequirement(graph, id, "RUNNING", "skip ahead").ok).toBe(false);
    expect(transitionRequirement(graph, id, "READY", "dependencies met").ok).toBe(true);
    expect(transitionRequirement(graph, id, "RUNNING", "worker started").ok).toBe(true);
    expect(transitionRequirement(graph, id, "IMPLEMENTED", "files changed").ok).toBe(true);
    expect(transitionRequirement(graph, id, "VERIFIED", "tests passed").ok).toBe(true);
    expect(transitionRequirement(graph, id, "READY", "cannot go back").ok).toBe(false);
    expect(REQUIREMENT_TRANSITIONS.SUPERSEDED).toEqual([]);
  });

  it("refuses an unknown requirement", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    expect(transitionRequirement(graph, "nope", "READY", "x").ok).toBe(false);
  });
});

describe("§28.4 acceptance binding", () => {
  function evidenceFor(graph: RequirementsGraph, kinds: Record<string, string[]> = {}): RequirementEvidence[] {
    const entries: RequirementEvidence[] = [];
    let counter = 0;
    for (const item of evidenceTemplate(graph)) {
      const wanted = kinds[item.requirement_id] ?? item.required;
      for (const kind of wanted) {
        counter += 1;
        entries.push({ id: `ev-${counter}`, requirement_id: item.requirement_id, kind: kind as RequirementEvidence["kind"], status: "PASS", source: "host:test", detail: `${kind} passed`, captured_at: "2026-01-01T00:00:00.000Z", command: "pnpm test" });
      }
    }
    return entries;
  }

  it("requires implementation, test and review evidence for an acceptance criterion", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    const acceptance = graph.nodes.find((node) => node.type === "ACCEPTANCE" && !node.visual)!;
    expect(requiredEvidenceKinds(acceptance)).toEqual(["IMPLEMENTATION", "TEST", "REVIEW"]);
    const report = bindAcceptance({ graph, evidence: [
      { id: "e1", requirement_id: acceptance.id, kind: "IMPLEMENTATION", status: "PASS", source: "worker", detail: "changed files", captured_at: "2026-01-01T00:00:00.000Z" },
      { id: "e2", requirement_id: acceptance.id, kind: "TEST", status: "PASS", source: "vitest", detail: "targeted test passed", captured_at: "2026-01-01T00:00:00.000Z" }
    ] });
    const binding = report.bindings.find((entry) => entry.requirement_id === acceptance.id)!;
    expect(binding.missing).toEqual(["REVIEW"]);
    expect(binding.verified).toBe(false);
    expect(acceptance.state).not.toBe("VERIFIED");
  });

  it("demands the visual branch for a VISUAL requirement", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    const visual = graph.nodes.find((node) => node.visual)!;
    expect(requiredEvidenceKinds(visual)).toEqual(["IMPLEMENTATION", "PREVIEW", "SCREENSHOT", "VISUAL_VERIFICATION"]);
    const report = bindAcceptance({ graph, evidence: [
      { id: "e1", requirement_id: visual.id, kind: "IMPLEMENTATION", status: "PASS", source: "worker", detail: "token added", captured_at: "2026-01-01T00:00:00.000Z" },
      { id: "e2", requirement_id: visual.id, kind: "PREVIEW", status: "PASS", source: "theme preview", detail: "preview rendered", captured_at: "2026-01-01T00:00:00.000Z" },
      { id: "e3", requirement_id: visual.id, kind: "SCREENSHOT", status: "NOT_RUN", source: "capture", detail: "capture skipped", captured_at: "2026-01-01T00:00:00.000Z" }
    ], apply: false });
    const binding = report.bindings.find((entry) => entry.requirement_id === visual.id)!;
    expect(binding.missing).toContain("VISUAL_VERIFICATION");
    expect(binding.provided.some((entry) => entry.status === "NOT_RUN")).toBe(true);
    expect(report.visual).toContain(visual.id);
  });

  it("verifies a requirement only when every required evidence kind passed", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    const report = bindAcceptance({ graph, evidence: evidenceFor(graph) });
    expect(report.totals.unverified).toBe(0);
    expect(report.totals.verified).toBe(graph.nodes.length);
    for (const node of graph.nodes) expect(node.state, node.id).toBe("VERIFIED");
  });

  it("never verifies on a claim: a FAIL or a missing entry keeps it open", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    const target = graph.nodes.find((node) => node.type === "DELIVERABLE")!;
    const evidence = evidenceFor(graph).map((entry) => entry.requirement_id === target.id && entry.kind === "TEST" ? { ...entry, status: "FAIL" as const, detail: "test failed" } : entry);
    const report = bindAcceptance({ graph, evidence });
    const binding = report.bindings.find((entry) => entry.requirement_id === target.id)!;
    expect(binding.verified).toBe(false);
    expect(binding.failed).toEqual(["TEST"]);
    expect(target.state).toBe("IMPLEMENTED");
    expect(report.unverified).toContain(target.id);
    expect(report.totals.verified).toBeLessThan(graph.nodes.length);
  });

  it("records implementation-only progress as IMPLEMENTED", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    const target = graph.nodes.find((node) => node.type === "FUNCTIONAL")!;
    const report = bindAcceptance({ graph, evidence: [
      { id: "e1", requirement_id: target.id, kind: "IMPLEMENTATION", status: "PASS", source: "worker", detail: "handler updated", captured_at: "2026-01-01T00:00:00.000Z" }
    ] });
    const binding = report.bindings.find((entry) => entry.requirement_id === target.id)!;
    expect(binding.implemented).toBe(true);
    expect(binding.verified).toBe(false);
    expect(target.state).toBe("IMPLEMENTED");
  });

  it("never verifies a quarantined requirement", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    const target = graph.nodes[1];
    target.state = "QUARANTINED";
    const report = bindAcceptance({ graph, evidence: evidenceFor(graph) });
    const binding = report.bindings.find((entry) => entry.requirement_id === target.id)!;
    expect(binding.verified).toBe(false);
    expect(binding.reason).toContain("quarantined");
    expect(report.totals.quarantined).toBe(1);
  });

  it("supports a dry report that does not mutate states", async () => {
    const graph = buildRequirementsGraph({ contract: await compile() });
    const before = graph.nodes.map((node) => node.state);
    bindAcceptance({ graph, evidence: evidenceFor(graph), apply: false });
    expect(graph.nodes.map((node) => node.state)).toEqual(before);
  });
});
