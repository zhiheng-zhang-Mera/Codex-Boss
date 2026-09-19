import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSelfModel, type SelfFacts } from "../../../src/shared/self-cognition/anatomy";
import { measuredObservation, statedObservation, unknownObservation } from "../../../src/shared/self-diagnosis/observations";
import {
  DIAGNOSIS_ROLES,
  PRIOR_CONFIDENCE_WEIGHT,
  assignRoles,
  hypothesesOf,
  rankHypotheses,
  spreadOf,
  symptomsOf,
  type DiagnosisHypothesis,
  type DiagnosisRole,
  type PriorEvidence
} from "../../../src/shared/self-diagnosis/hypotheses";
import { DIAGNOSTIC_ACTIONS, planDiagnosis, type DiagnosticAction, type DiagnosticPlan, type DiagnosticPlanStep } from "../../../src/shared/self-diagnosis/plan";
import {
  OWNER_ONLY_AUTHORITIES,
  TREATMENT_KINDS,
  TREATMENT_RISK_LEVELS,
  proposeTreatments,
  type TreatmentKind,
  type TreatmentProposal,
  type TreatmentRisk
} from "../../../src/shared/self-diagnosis/treatment";
import { SELF_DIAGNOSIS_CAPABILITIES, SELF_DIAGNOSIS_SCHEMA_VERSION, diagnose, type DiagnosisReport } from "../../../src/shared/self-diagnosis/engine";

/**
 * The diagnosis engine.
 *
 * Four claims are structural rather than stylistic:
 *
 *   - several candidates are reported at once, with confidences, and no single root cause is
 *     asserted when the evidence supports more than one;
 *   - a downstream effect of a suspected component is a symptom of it, not a second cause;
 *   - the plan says what to check, and the treatments are advisory with a stated authority;
 *   - a boundary component is never proposed for automated treatment.
 */

const AT = "2026-09-20T10:00:00.000Z";
const REPO = path.resolve(__dirname, "..", "..", "..");

function capability(id: string, overrides: Partial<SelfFacts["capabilities"][number]> = {}): SelfFacts["capabilities"][number] {
  return { id, kind: "feature", provides: [`${id}.thing@1`], requires: [], optional: [], state: [], modules: [], bootModules: [], surface: [], critical: false, ...overrides };
}

const FACTS: SelfFacts = {
  capturedAt: AT,
  repositoryRoot: "C:/repo",
  capabilities: [
    capability("providers", { provides: ["provider.runtime@1"], critical: true }),
    // tasks provides the lifecycle contract the two capabilities below consume, so the dependency
    // chain providers -> tasks -> status is real and the roles can be checked against it.
    capability("tasks", { provides: ["task.lifecycle@1"], requires: [{ ref: "provider.runtime@1" }] }),
    capability("status", { requires: [{ ref: "task.lifecycle@1" }] }),
    // A capability whose owned paths reach the Root Trust Surface, so the treatment boundary has
    // something real to refuse.
    capability("promotion", { requires: [{ ref: "task.lifecycle@1" }] }),
    // A capability the anatomy does not connect to anything, so the "no path between the
    // candidates" case has a real pair to test.
    capability("theme", { provides: ["theme.registry@1"] })
  ],
  ownership: {
    capabilities: {
      providers: ["electron/runtimes"],
      tasks: ["electron/commander"],
      status: ["src/shared/doctor.ts"],
      promotion: ["electron/self-evolution"]
    },
    exempt: {}
  },
  bootWiring: [],
  scripts: [],
  authority: [
    { path: "electron/runtimes", surface: "PRODUCT_SURFACE", ownerReview: "ALLOW", detail: "PRODUCT_SURFACE" },
    { path: "electron/commander", surface: "PRODUCT_SURFACE", ownerReview: "ALLOW", detail: "PRODUCT_SURFACE" },
    { path: "src/shared/doctor.ts", surface: "PRODUCT_SURFACE", ownerReview: "ALLOW", detail: "PRODUCT_SURFACE" },
    { path: "electron/self-evolution", surface: "ROOT_TRUST_SURFACE", ownerReview: "REQUIRE_OWNER", detail: "ROOT_TRUST_SURFACE" }
  ],
  unreadable: []
};

const MODEL = buildSelfModel(FACTS);

/** A reading that names one component and reports a failure share over its limit. */
function degrading(componentId: string, signalId: string, measurement: number, source = "telemetry.json") {
  return measuredObservation({ componentId, signalId, measurement, expectedRange: { max: 0.3 }, at: AT, source });
}

describe("candidates, not a verdict", () => {
  it("produces one candidate per suspected component with its own confidence", () => {
    const symptoms = symptomsOf([degrading("providers", "web:chatgpt.providerFailureShare", 0.9, "telemetry.json"), degrading("tasks", "tasks.taskFailureShare", 0.4, "state.json")]);
    const hypotheses = hypothesesOf({ model: MODEL, symptoms, at: AT });
    expect(hypotheses).toHaveLength(2);
    const providers = hypotheses.find((hypothesis) => hypothesis.suspectedComponent === "providers");
    expect(providers?.failureMode).toBe("PROVIDER_FAILURE_SPIKE");
    expect(providers?.supportingEvidence[0]).toContain("reported web:chatgpt.providerFailureShare as UNHEALTHY");
    expect(providers?.confidence).toBeGreaterThan(0);
    expect(providers?.alternativeHypotheses).toEqual([]);
  });

  it("keeps several candidates credible at once and says so", () => {
    const symptoms = symptomsOf([degrading("providers", "a.timeout.rate", 0.9), degrading("status", "b.cache.staleAge", 0.9)]);
    const ranked = rankHypotheses(assignRoles({ model: MODEL, hypotheses: hypothesesOf({ model: MODEL, symptoms, at: AT }) }));
    expect(spreadOf(ranked)).toBe("MULTIPLE_HYPOTHESES");
    // Every candidate names the others, so a reader sees the choice rather than a single answer.
    expect(ranked[0].alternativeHypotheses).toHaveLength(1);
    expect(ranked[0].confidence).toBeGreaterThanOrEqual(ranked[1].confidence);
    expect(spreadOf([])).toBe("NO_HYPOTHESIS");
    expect(spreadOf([{ ...ranked[0], confidence: 0.1 }])).toBe("SINGLE_HYPOTHESIS");
  });

  it("refuses to call a downstream effect a second root cause", () => {
    // providers is upstream of tasks, which is upstream of status: one cause, two effects.
    const symptoms = symptomsOf([degrading("providers", "provider.timeout.rate", 0.9), degrading("tasks", "tasks.taskFailureShare", 0.9), degrading("status", "status.error.rate", 0.9)]);
    const ranked = rankHypotheses(assignRoles({ model: MODEL, hypotheses: hypothesesOf({ model: MODEL, symptoms, at: AT }) }));
    const roleOf = (component: string): DiagnosisRole | undefined => ranked.find((hypothesis) => hypothesis.suspectedComponent === component)?.role;
    expect(roleOf("providers")).toBe("ROOT_CAUSE");
    expect(roleOf("tasks")).toBe("DOWNSTREAM_SYMPTOM");
    expect(roleOf("status")).toBe("DOWNSTREAM_SYMPTOM");
    const downstream = ranked.find((hypothesis) => hypothesis.suspectedComponent === "tasks");
    expect(downstream?.supportingEvidence.join(" ")).toContain("is upstream of tasks in the anatomy, so this is more likely an effect than a second cause");
    // A single candidate with nothing else connected is a root cause by construction.
    expect(assignRoles({ model: MODEL, hypotheses: hypothesesOf({ model: MODEL, symptoms: symptomsOf([degrading("providers", "x.timeout", 0.9)]), at: AT }) })[0].role).toBe("ROOT_CAUSE");
    // Two candidates the anatomy does not connect are both contributing factors, which is the
    // honest answer when nothing explains the other.
    const unrelated = rankHypotheses(assignRoles({ model: MODEL, hypotheses: hypothesesOf({ model: MODEL, symptoms: symptomsOf([degrading("providers", "x.timeout", 0.9), degrading("theme", "y.stale", 0.9)]), at: AT }) }));
    expect(unrelated.map((hypothesis) => hypothesis.role).sort()).toEqual(["CONTRIBUTING_FACTOR", "CONTRIBUTING_FACTOR"]);
    expect(DIAGNOSIS_ROLES).toEqual(["ROOT_CAUSE", "CONTRIBUTING_FACTOR", "DOWNSTREAM_SYMPTOM", "UNRELATED", "UNKNOWN"]);
  });

  it("uses a closed case as a bounded prior, never as a verdict about now", () => {
    const symptoms = symptomsOf([degrading("providers", "provider.timeout.rate", 0.4)]);
    const without = hypothesesOf({ model: MODEL, symptoms, at: AT })[0];
    const priors: PriorEvidence[] = [{ caseId: "case-1", componentId: "providers", failureMode: "PROVIDER_TIMEOUT_SPIKE", closedAt: "2026-09-01T00:00:00.000Z", finalDisposition: "RESOLVED" }];
    const withPrior = hypothesesOf({ model: MODEL, symptoms, at: AT, priors })[0];
    expect(withPrior.confidence).toBeGreaterThan(without.confidence);
    expect(withPrior.confidence - without.confidence).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(PRIOR_CONFIDENCE_WEIGHT).toBe(0.1);
    expect(withPrior.supportingEvidence.join(" ")).toContain("evidence about the past and not about now");
  });
});

describe("the plan says what to check", () => {
  it("orders collection first and never proposes a repair", () => {
    const symptoms = symptomsOf([degrading("providers", "provider.timeout.rate", 0.9)]);
    const hypotheses = rankHypotheses(assignRoles({ model: MODEL, hypotheses: hypothesesOf({ model: MODEL, symptoms, at: AT }) }));
    const plan: DiagnosticPlan = planDiagnosis({ hypotheses, missingEvidence: ["the provider's own latency"], at: AT });
    expect(plan.kind).toBe("DIAGNOSTIC_PLAN");
    const first: DiagnosticPlanStep = plan.steps[0];
    const action: DiagnosticAction = first.action;
    expect(action).toBe("COLLECT");
    expect(plan.steps[0].action).toBe("COLLECT");
    expect(plan.steps[0].priority).toBe(1);
    expect(plan.blockedBy).toEqual(["the provider's own latency"]);
    expect(plan.steps.map((step) => step.action)).toContain("INSPECT");
    expect(plan.steps.map((step) => step.action)).toContain("COMPARE");
    expect(DIAGNOSTIC_ACTIONS).toEqual(["COLLECT", "INSPECT", "COMPARE", "REPRODUCE"]);
    const text = JSON.stringify(plan).toLowerCase();
    for (const verb of ["restart ", "rollback ", "apply ", "repair ", "fix "]) expect(text.includes(verb), `the plan must not propose ${verb}`).toBe(false);    expect(plan.note).toContain("this plan changes nothing and proposes no repair");
    expect(plan.steps.every((step) => step.wouldEstablish.length > 0)).toBe(true);
  });

  it("says what an empty plan does and does not mean", () => {
    const plan = planDiagnosis({ hypotheses: [], at: AT });
    expect(plan.steps).toEqual([]);
    expect(plan.note).toContain("no symptom was observed, which is not the same as the system being healthy");
  });
});

describe("treatment is a suggestion with an authority", () => {
  it("maps a failure mode onto a treatment with its risk and reversibility", () => {
    const symptoms = symptomsOf([degrading("providers", "provider.timeout.rate", 0.9)]);
    const ranked = rankHypotheses(assignRoles({ model: MODEL, hypotheses: hypothesesOf({ model: MODEL, symptoms, at: AT }) }));
    const proposals: TreatmentProposal[] = proposeTreatments({ model: MODEL, hypotheses: ranked });
    expect(proposals).toHaveLength(1);
    const proposal: TreatmentProposal = proposals[0];
    const kind: TreatmentKind = proposal.treatment;
    expect(kind).toBe("RETRY");
    expect(proposal.treatment).toBe("RETRY");
    expect(proposal.risk).toBe("LOW");
    expect(proposal.reversible).toBe(true);
    expect(proposal.requiredAuthority).toBe("AUTONOMOUS_CANDIDATE");
    expect(proposal.executable).toBe(false);
    expect(proposal.expectedBenefit.length).toBeGreaterThan(0);
    expect(proposal.riskDetail.length).toBeGreaterThan(0);
    expect(proposal.blastRadius).toBeGreaterThan(0);
    expect(TREATMENT_KINDS).toContain(proposal.treatment);
    expect(TREATMENT_RISK_LEVELS).toContain(proposal.risk);
    const risk: TreatmentRisk = proposal.risk;
    expect(risk).toBe("LOW");
  });

  it("never proposes an automated treatment across a boundary", () => {
    // promotion is ROOT_TRUST_SURFACE and an owner must review it whatever the evidence says.
    const symptoms = symptomsOf([degrading("promotion", "promotion.ledger.writeFailure", 0.9)]);
    const hypotheses = rankHypotheses(assignRoles({ model: MODEL, hypotheses: hypothesesOf({ model: MODEL, symptoms, at: AT }) }));
    const proposal = proposeTreatments({ model: MODEL, hypotheses })[0];
    expect(proposal.treatment).toBe("REQUEST_OWNER_REVIEW");
    expect(proposal.risk).toBe("OWNER_ONLY");
    expect(proposal.requiredAuthority).toBe("OWNER");
    expect(proposal.executable).toBe(false);
    expect(proposal.riskDetail).toContain("ROOT_TRUST_SURFACE");
    expect(proposal.reason).toContain("never treated by this module");
    expect(OWNER_ONLY_AUTHORITIES).toEqual(["ROOT_TRUST_SURFACE", "EVOLUTION_ENGINE"]);
  });

  it("marks a downstream candidate HIGH whatever its failure mode", () => {
    const symptoms = symptomsOf([degrading("providers", "provider.timeout.rate", 0.9), degrading("tasks", "tasks.taskFailureShare", 0.9)]);
    const hypotheses = rankHypotheses(assignRoles({ model: MODEL, hypotheses: hypothesesOf({ model: MODEL, symptoms, at: AT }) }));
    const downstream = proposeTreatments({ model: MODEL, hypotheses }).find((proposal) => proposal.targetComponent === "tasks");
    expect(hypotheses.find((hypothesis) => hypothesis.suspectedComponent === "tasks")?.role).toBe("DOWNSTREAM_SYMPTOM");
    expect(downstream?.risk).toBe("HIGH");
    expect(downstream?.executable).toBe(false);
  });
});

describe("the engine reports what it can and cannot do", () => {
  it("diagnoses from observations and declares its limits as literals", () => {
    const report: DiagnosisReport = diagnose({ model: MODEL, at: AT, observations: [degrading("providers", "provider.timeout.rate", 0.9), unknownObservation({ componentId: "providers", signalId: "providers.latency", at: AT, source: "probe", reason: "not measured" })] });
    expect(report.kind).toBe("SELF_DIAGNOSIS_REPORT");
    expect(report.schemaVersion).toBe(SELF_DIAGNOSIS_SCHEMA_VERSION);
    expect(SELF_DIAGNOSIS_SCHEMA_VERSION).toBe(1);
    expect(report.observations).toBe(2);
    expect(report.unhealthyObservations).toBe(1);
    expect(report.symptoms).toHaveLength(1);
    expect(report.hypotheses).toHaveLength(1);
    expect(report.spread).toBe("SINGLE_HYPOTHESIS");
    expect(report.treatments).toHaveLength(1);
    expect(report.authority).toEqual({ canDiagnose: true, canProposeTreatment: true, canExecuteTreatment: false, mutatesAnatomy: false });
    expect(SELF_DIAGNOSIS_CAPABILITIES.canExecuteTreatment).toBe(false);
    // The report has no model field: it cannot hand back a changed anatomy.
    expect(Object.keys(report)).not.toContain("model");
    expect(Object.keys(report)).not.toContain("selfModel");
  });

  it("keeps a reading about a component the anatomy does not describe, and says so", () => {
    const report = diagnose({ model: MODEL, at: AT, observations: [unknownObservation({ componentId: "runtime:web:chatgpt", signalId: "x", at: AT, source: "probe", reason: "nobody looked" })] });
    expect(report.notes.join(" ")).toContain("which the anatomy does not describe");
    expect(report.observations).toBe(1);
  });

  it("turns an unreadable source into a symptom rather than a silence", () => {
    const report = diagnose({ model: MODEL, at: AT, sources: [{ id: "telemetry.json", observe: () => ({ observations: [], unreadable: [{ source: "telemetry.json", reason: "ENOENT" }] }) }] });
    expect(report.unreadable).toEqual([{ source: "telemetry.json", reason: "ENOENT" }]);
    expect(report.symptoms[0].kind).toBe("SOURCE_UNREADABLE");
    expect(report.notes.join(" ")).toContain("which is not the same as the system being healthy");
  });

  it("isolates a source that throws and reports it as a failure of the source", () => {
    const report = diagnose({ model: MODEL, at: AT, sources: [{ id: "broken", observe: () => { throw new Error("boom"); } }, { id: "fine", observe: () => ({ observations: [statedObservation({ componentId: "providers", signalId: "x", status: "HEALTHY", at: AT, source: "fine", detail: "ok" })], unreadable: [] }) }] });
    expect(report.sourceFailures).toEqual([{ source: "broken", reason: "boom" }]);
    expect(report.notes.join(" ")).toContain("the observation source broken threw and was isolated");
    expect(report.observations).toBe(1);
  });
});

describe("CAN_DIAGNOSE and the one thing it cannot do", () => {
  const modules = ["observations.ts", "hypotheses.ts", "plan.ts", "treatment.ts", "engine.ts"];
  const code = modules
    .map((name) => fs.readFileSync(path.join(REPO, "src", "shared", "self-diagnosis", name), "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("has no behaviour that could execute a treatment", () => {
    for (const call of ["writeFileSync", "appendFileSync", "rmSync", "unlinkSync", "mkdirSync", "renameSync", "child_process", "execSync", "spawn"]) {
      expect(code.includes(call), `${call} must not appear in the diagnostic engine`).toBe(false);
    }
    // No export can perform a treatment: the engine's whole surface is diagnose, plan and propose.
    for (const verb of ["execute", "perform", "applyTreatment", "applyFix"]) {
      expect(new RegExp(`export (function|const) \\w*${verb}`, "i").test(code), `no ${verb} export`).toBe(false);
    }
    for (const call of ["rollback(", "restart(", "switchProvider(", "clearCache("]) {
      expect(code.includes(call), `${call} would be an action the diagnosis may not take`).toBe(false);
    }
    expect(code).toContain("canExecuteTreatment: false");
    expect(code).toContain("mutatesAnatomy: false");
    expect(code).toContain("executable: false");
  });

  it("does not write to the anatomy it was given", () => {
    const before = JSON.stringify(MODEL);
    const symptoms = symptomsOf([degrading("providers", "provider.timeout.rate", 0.9)]);
    const hypotheses = rankHypotheses(assignRoles({ model: MODEL, hypotheses: hypothesesOf({ model: MODEL, symptoms, at: AT }) }));
    proposeTreatments({ model: MODEL, hypotheses });
    planDiagnosis({ hypotheses, at: AT });
    diagnose({ model: MODEL, at: AT, observations: [degrading("providers", "provider.timeout.rate", 0.9)] });
    // The anatomy is a value the diagnosis reads: after all of that, it is byte-identical.
    expect(JSON.stringify(MODEL)).toBe(before);
  });

  it("names no module that belongs to qualification or the evolution engine as treatable", () => {
    const proposal = proposeTreatments({ model: MODEL, hypotheses: [{ schemaVersion: 1, hypothesisId: "h", suspectedComponent: "absent-from-anatomy", failureMode: "PROVIDER_TIMEOUT_SPIKE", role: "ROOT_CAUSE", supportingEvidence: [], contradictingEvidence: [], confidence: 0.9, affectedComponents: [], affectedCapabilities: [], blastRadius: 0, alternativeHypotheses: [], missingEvidence: [], source: "test" } as DiagnosisHypothesis] })[0];
    // An unknown authority is not a licence: `UNKNOWN` is not in the owner-only list, but the
    // proposal still cannot be executed, and the report says which authority was consulted.
    expect(proposal.executable).toBe(false);
    expect(["AUTONOMOUS_CANDIDATE", "OWNER"]).toContain(proposal.requiredAuthority);
    expect(proposal.riskDetail.length).toBeGreaterThan(0);
  });
});
