/**
 * Update-Plan/checkpoint-1.md §57 + §58 — the Bootstrap Completion audit.
 *
 * §57's black box is the whole product: a real WorkBook driven through the app with
 * no human engineering, followed by the UI theme black box. Every stage of that path
 * already has its own gate in this repository, so the Completion audit does not
 * re-run them — it reads what they wrote and refuses to call the system complete
 * unless every gate passed, the desktop black box passed, and no Owner intervention
 * was needed.
 *
 * Pure: no fs, no clock, no process.
 */
import { bootstrapCompletion, CRITICAL_CAPABILITIES, type BootstrapCompletionVerdict } from "./final-acceptance";
import { contentHashOf } from "./workbook";

export const BOOTSTRAP_AUDIT_VERSION = "bootstrap-audit-1" as const;

/** Each gate of the delivery chain and the ids it must have passed. */
export const GATE_REQUIREMENTS: Readonly<Record<string, readonly string[]>> = {
  "acceptance-workbook": ["WB-01", "WB-02", "WB-03", "WB-04", "WB-05", "WB-06", "WB-07", "WB-08", "WB-09", "WB-10"],
  "acceptance-knowledge": ["K-01", "K-02", "K-03", "K-04"],
  "acceptance-architecture": ["A-01", "A-02", "A-03", "A-04", "A-05", "A-06", "A-07", "A-08", "A-09", "A-10"],
  "acceptance-theme": ["TH-01", "TH-02", "TH-03", "TH-04", "TH-05", "TH-06", "TH-07", "TH-08", "TH-09", "TH-10", "TH-11", "TH-12", "TH-13", "TH-14", "TH-15", "T-TOKENS"],
  "acceptance-requirements": ["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08"],
  "acceptance-plan": ["P-01", "P-02", "P-03", "P-04", "P-05", "P-06"],
  "acceptance-verify": ["V-01", "V-02", "V-03", "V-04", "V-05", "V-06", "V-07", "V-08", "V-09", "V-10"],
  "acceptance-review": ["C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "C-07", "C-08", "C-09", "C-10", "C-11"],
  "acceptance-self-healing": ["RC-01", "RC-02", "RC-03", "RC-04", "RC-05", "RC-06", "RC-07", "RC-08", "RC-09", "RC-10"],
  "acceptance-capability-gap": ["CG-01", "CG-02", "CG-03", "CG-04", "CG-05", "CG-06", "CG-07", "CG-08", "CG-09", "CG-10"],
  "acceptance-candidate": ["GD-01", "GD-02", "GD-03", "GD-04", "GD-05", "GD-06", "GD-07", "GD-08", "GD-09", "GD-10"],
  "acceptance-version-checkpoint": ["VC-01", "VC-02", "VC-03", "VC-04", "VC-05", "VC-06", "VC-07", "VC-08"],
  "acceptance-publish": ["PB-01", "PB-02", "PB-03", "PB-04", "PB-05", "PB-06", "PB-07", "PB-08", "PB-09", "PB-10"],
  "acceptance-ci-repair": ["CR-01", "CR-02", "CR-03", "CR-04", "CR-05", "CR-06", "CR-07", "CR-08"],
  "acceptance-final": ["FS-01", "FS-02", "FS-03", "FS-04", "FS-05", "FS-06", "FS-07", "FS-08"],
  "acceptance-soak": ["SK-01", "SK-02", "SK-03", "SK-04", "SK-05", "SK-06"]
};

/** §57: the black-box claims that prove the real application, not the units. */
export const DESKTOP_BLACK_BOX = "acceptance-desktop-workbook";

/** Which capability each gate's evidence establishes (for §43). */
const CAPABILITY_GATES: Readonly<Record<string, readonly string[]>> = {
  "knowledge foundation": ["acceptance-knowledge", "acceptance-final"],
  "architecture and UI discovery": ["acceptance-architecture"],
  "theme engine": ["acceptance-theme", DESKTOP_BLACK_BOX],
  "requirements graph": ["acceptance-requirements"],
  "execution planner": ["acceptance-plan"],
  "verification engine": ["acceptance-verify"],
  "review layers": ["acceptance-review"],
  "self-healing": ["acceptance-self-healing"],
  "capability gap loop": ["acceptance-capability-gap"],
  "candidate and Guardian gate": ["acceptance-candidate"],
  "version impact and Git checkpoint": ["acceptance-version-checkpoint"],
  "GitHub publishing": ["acceptance-publish"],
  "CI repair loop": ["acceptance-ci-repair"]
};

export interface GateReport {
  /** The gate's unit label, as its report writes it. */
  unit?: string;
  requirementResults?: { id: string; verdict: string }[];
  totals?: { pass?: number; fail?: number; notRun?: number };
  passed?: boolean;
}

export interface GateAudit {
  gate: string;
  verdict: "PASS" | "FAIL" | "MISSING";
  required: number;
  verified: number;
  missing_ids: string[];
  reasons: string[];
}

/** §57/§58: one gate's report judged against the ids it must have passed. */
export function auditGate(gate: string, report: GateReport | undefined, required: readonly string[]): GateAudit {
  if (!report) return { gate, verdict: "MISSING", required: required.length, verified: 0, missing_ids: [...required], reasons: [`${gate} wrote no report`] };
  const verdicts = new Map((report.requirementResults ?? []).map((entry) => [entry.id, entry.verdict]));
  const failed: string[] = [];
  const unverified: string[] = [];
  for (const id of required) {
    const verdict = verdicts.get(id);
    if (verdict === "PASS") continue;
    if (verdict === undefined) unverified.push(id);
    else failed.push(id);
  }
  const problems = [
    ...failed.map((id) => `${gate}:${id} was ${verdicts.get(id)}`),
    ...unverified.map((id) => `${gate}:${id} was not reported`)
  ];
  if (report.passed === false && !problems.length) problems.push(`${gate} reported passed=false`);
  return {
    gate,
    verdict: problems.length ? "FAIL" : "PASS",
    required: required.length,
    verified: required.length - problems.length,
    missing_ids: [...failed, ...unverified],
    reasons: problems.length ? problems.slice(0, 6) : [`${gate}: ${required.length} required id(s) passed`]
  };
}

export interface BootstrapAudit {
  schemaVersion: 1;
  version: typeof BOOTSTRAP_AUDIT_VERSION;
  decision: "BOOTSTRAP_COMPLETE" | "INCOMPLETE";
  gates: GateAudit[];
  gates_passed: number;
  gates_required: number;
  /** §43 over the capabilities the passing gates establish. */
  completion: BootstrapCompletionVerdict;
  capability_evidence: { capability: string; gates: string[]; established: boolean }[];
  /** §57: the real-application black box. */
  desktop: GateAudit;
  /** §53/§57: owner interventions must be zero. */
  owner_interventions: number;
  reasons: string[];
  hash: string;
}

/**
 * §57/§58 evaluated.
 *
 * Complete requires: every gate report present and passing, the desktop black box
 * passing (the real application, not the units), every critical capability
 * established, and zero Owner interventions — anything less is honestly INCOMPLETE.
 */
export function auditBootstrap(input: {
  reports: Readonly<Record<string, GateReport | undefined>>;
  owner_interventions?: number;
}): BootstrapAudit {
  const gates = Object.entries(GATE_REQUIREMENTS).map(([gate, required]) => auditGate(gate, input.reports[gate], required));
  const desktop = auditGate(DESKTOP_BLACK_BOX, input.reports[DESKTOP_BLACK_BOX], []);
  // The real application's black box is evidence for a capability too, so it counts
  // alongside the chain's gates when it passed.
  const established = new Set([
    ...gates.filter((audit) => audit.verdict === "PASS").map((audit) => audit.gate),
    ...(desktop.verdict === "PASS" ? [DESKTOP_BLACK_BOX] : [])
  ]);
  const capabilityEvidence = CRITICAL_CAPABILITIES.map((capability) => {
    const proof = CAPABILITY_GATES[capability] ?? [];
    const provenBy = proof.filter((gate) => established.has(gate));
    return { capability, gates: proof.filter((gate) => input.reports[gate] !== undefined), established: proof.length > 0 && provenBy.length === proof.length };
  });
  const completion = bootstrapCompletion(capabilityEvidence.filter((entry) => entry.established).map((entry) => entry.capability));
  const ownerInterventions = Math.max(0, input.owner_interventions ?? 0);
  const reasons: string[] = [];
  const failing = gates.filter((audit) => audit.verdict !== "PASS");
  for (const audit of failing) reasons.push(...audit.reasons);
  if (desktop.verdict !== "PASS") reasons.push(...desktop.reasons);
  if (!completion.complete) reasons.push(completion.reason);
  if (ownerInterventions > 0) reasons.push(`§57: ${ownerInterventions} Owner intervention(s) were needed; the black box forbids them`);
  const decision = reasons.length === 0 ? "BOOTSTRAP_COMPLETE" : "INCOMPLETE";
  const audit: Omit<BootstrapAudit, "hash"> = {
    schemaVersion: 1,
    version: BOOTSTRAP_AUDIT_VERSION,
    decision,
    gates,
    gates_passed: gates.filter((entry) => entry.verdict === "PASS").length,
    gates_required: gates.length,
    completion,
    capability_evidence: capabilityEvidence,
    desktop,
    owner_interventions: ownerInterventions,
    reasons: decision === "BOOTSTRAP_COMPLETE"
      ? [`§57/§58: every one of the ${gates.length} gates passed, the desktop black box passed, all ${CRITICAL_CAPABILITIES.length} capabilities are established and no Owner intervention was needed`]
      : reasons
  };
  return { ...audit, hash: contentHashOf(JSON.stringify(audit)) };
}
