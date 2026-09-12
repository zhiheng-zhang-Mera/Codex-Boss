/**
 * Update-Plan/checkpoint-1.md §57/§58 + checkpoint-2.md §8 — the trusted Bootstrap
 * root audit.
 *
 * §57's black box is the whole product. Until checkpoint-2 this audit read the
 * reports the delivery chain wrote and judged them against a list of ids. That made
 * "the report file exists" and "a caller says the count is zero" load-bearing, which
 * they may not be (§2.1/§2.2/§2.5).
 *
 * The audit now accepts only evidence that carries its own provenance: a strict
 * report validation, a gate attestation bound to this session and this commit, and
 * the SHA-256 of the exact report bytes. Capabilities are derived from trusted PASS
 * evidence only, the Owner intervention count is the runtime ledger's own event
 * count, every source is listed with its hash, and the whole decision is sealed by a
 * root hash over that canonical manifest.
 *
 * Pure: no fs, no clock, no process.
 */
import { bootstrapCompletion, CRITICAL_CAPABILITIES, type BootstrapCompletionVerdict } from "./final-acceptance";
import {
  ACCEPTANCE_GATE_CONTRACTS,
  CAPABILITY_GATES,
  DESKTOP_BLACK_BOX_CONTRACT,
  DESKTOP_BLACK_BOX_GATE,
  GATE_REQUIREMENTS,
  type AcceptanceGateContract
} from "./acceptance-contracts";
import {
  canonicalSha256,
  sessionProblems,
  validateDesktopBlackBoxReport,
  validateGateReport,
  verifyGateAttestation,
  type AcceptanceSession,
  type StrictReportValidation
} from "./acceptance-evidence";
import { deriveOwnerInterventions, verifyOwnerLedger, type OwnerInterventionLedger } from "./owner-intervention";

export const BOOTSTRAP_AUDIT_VERSION = "bootstrap-audit-2" as const;

/** §57: the name of the desktop black-box gate. */
export const DESKTOP_BLACK_BOX = DESKTOP_BLACK_BOX_GATE;

/** §8.1: the sixteen gates whose trusted evidence the root audit requires. */
export { GATE_REQUIREMENTS, CAPABILITY_GATES };

/** One gate's evidence as the host read it from disk. */
export interface GateEvidence {
  gate: string;
  report_file: string;
  report: unknown;
  /** SHA-256 of the report file's exact bytes; "" when the file does not exist. */
  report_sha256: string;
  attestation_file: string;
  attestation: unknown;
  attestation_sha256: string;
}

export interface TrustedBootstrapInput {
  session?: AcceptanceSession;
  /** SHA-256 of the session manifest. */
  session_sha256: string;
  session_file?: string;
  gates: readonly GateEvidence[];
  desktop?: GateEvidence;
  ownerLedger?: OwnerInterventionLedger;
  ownerLedgerSha256: string;
  ownerLedgerFile?: string;
}

export interface TrustedEvidenceSource {
  kind: "gate" | "desktop" | "owner_ledger" | "session";
  gate: string;
  report_file: string;
  report_sha256: string;
  attestation_file: string;
  attestation_sha256: string;
  verdict: "PASS" | "FAIL" | "MISSING";
  required_ids: number;
  verified_ids: number;
  problems: string[];
}

export interface TrustedBootstrapAudit {
  schemaVersion: 2;
  version: typeof BOOTSTRAP_AUDIT_VERSION;
  session_id: string;
  commit_sha: string;
  decision: "BOOTSTRAP_COMPLETE" | "INCOMPLETE";
  gates_passed: number;
  gates_required: number;
  /** §8.2: one entry per delivery gate, with the reasons it did or did not pass. */
  gates: TrustedEvidenceSource[];
  /** §8.6: the real-application black box under its versioned claim contract. */
  desktop: TrustedEvidenceSource & { contract: string; verified_claims: number; required_claims: number };
  /** §8.6: 13/13 only when every mapped gate's evidence is trusted. */
  capabilities: { passed: number; required: number };
  capability_evidence: { capability: string; gates: string[]; established: boolean }[];
  completion: BootstrapCompletionVerdict;
  owner_interventions: number;
  owner_intervention_ledger: { session_id: string; commit_sha: string; events: number; hash: string; sha256: string };
  provenance: { same_session: boolean; same_commit: boolean; source_hashes_verified: boolean };
  /** §8.4/§2.7: the root evidence manifest — every source, with its hashes. */
  sources: TrustedEvidenceSource[];
  /** §2.1: every reason the run is not complete. Empty exactly when it is complete. */
  reasons: string[];
  /** The one-line record of what was proven, present when the decision is complete. */
  summary: string;
  /** §8.5: the digest that binds session, commit, sources, capabilities, ledger and decision. */
  root_hash: string;
  /** Convenience alias so existing readers of the record keep working. */
  hash: string;
}

function requiredProblems(validation: StrictReportValidation | undefined, required: number): number {
  if (!validation) return required;
  return validation.reasons.filter((reason) => reason.startsWith("REQUIRED_ID_MISSING") || reason.startsWith("REQUIRED_ID_NOT_PASS")).length;
}

/** §8.2: raw report + valid attestation + matching source SHA, all three. */
function judgeGateEvidence(input: {
  contract: AcceptanceGateContract;
  evidence: GateEvidence | undefined;
  session: AcceptanceSession | undefined;
  exact: boolean;
}): { source: TrustedEvidenceSource; validation?: StrictReportValidation } {
  const { contract, evidence, session } = input;
  const problems: string[] = [];
  let validation: StrictReportValidation | undefined;
  // "MISSING" means the file is not there at all. A file that exists but cannot be
  // understood is a FAIL: something was produced and it is not evidence.
  const fileMissing = !evidence || evidence.report_sha256 === "";
  if (!evidence) {
    problems.push("EVIDENCE_MISSING");
  } else {
    if (fileMissing) problems.push("REPORT_FILE_MISSING");
    validation = input.exact
      ? validateDesktopBlackBoxReport({ contract, report: evidence.report })
      : validateGateReport({ gate: contract.gate, contract, report: evidence.report });
    if (validation.verdict !== "PASS") problems.push(...validation.reasons.slice(0, 10));
    if (!session) problems.push("SESSION_MISSING");
    else {
      problems.push(...verifyGateAttestation({
        gate: contract.gate,
        contract,
        session,
        attestation: evidence.attestation,
        report: evidence.report,
        source_sha256: evidence.report_sha256
      }).slice(0, 10));
    }
    if (evidence.attestation_sha256 === "") problems.push("ATTESTATION_FILE_MISSING");
  }
  const required = contract.required_ids.length;
  const verdict: TrustedEvidenceSource["verdict"] = fileMissing ? "MISSING" : problems.length ? "FAIL" : "PASS";
  const source: TrustedEvidenceSource = {
    kind: contract.gate === DESKTOP_BLACK_BOX_GATE ? "desktop" : "gate",
    gate: contract.gate,
    report_file: evidence?.report_file ?? contract.report_file,
    report_sha256: evidence?.report_sha256 ?? "",
    attestation_file: evidence?.attestation_file ?? "",
    attestation_sha256: evidence?.attestation_sha256 ?? "",
    verdict,
    required_ids: required,
    verified_ids: verdict === "PASS" ? required : Math.max(0, required - requiredProblems(validation, required)),
    problems
  };
  return { source, ...(validation ? { validation } : {}) };
}

/**
 * §8.1/§8.2/§8.3: the trusted root audit. Complete requires trusted PASS evidence for
 * all sixteen gates and the black box, all thirteen capabilities derived from that
 * evidence, a session-bound ledger with zero events, and a verifiable source
 * manifest — otherwise the decision is honestly INCOMPLETE.
 */
export function evaluateTrustedBootstrap(input: TrustedBootstrapInput): TrustedBootstrapAudit {
  const reasons: string[] = [];
  const session = input.session;
  if (!session) reasons.push("§5.2: no acceptance session was found, so no evidence can be attributed to a run");
  else reasons.push(...sessionProblems(session).map((problem) => `§5.2: ${problem}`));
  if (input.session_sha256 === "") reasons.push("§5.2: the session manifest file is missing");

  const gateJudgements = ACCEPTANCE_GATE_CONTRACTS.map((contract) => judgeGateEvidence({
    contract,
    evidence: input.gates.find((entry) => entry.gate === contract.gate),
    session,
    exact: false
  }));
  const gateSources = gateJudgements.map((judgement) => judgement.source);
  const desktopJudgement = judgeGateEvidence({ contract: DESKTOP_BLACK_BOX_CONTRACT, evidence: input.desktop, session, exact: true });
  const desktopSource = desktopJudgement.source;
  for (const source of [...gateSources, desktopSource]) reasons.push(...source.problems.map((problem) => `${source.gate}: ${problem}`));

  const ledgerProblems = input.ownerLedger
    ? (session ? verifyOwnerLedger({ ledger: input.ownerLedger, session }) : ["LEDGER_SESSION_UNVERIFIABLE"])
    : ["OWNER_LEDGER_MISSING"];
  reasons.push(...ledgerProblems.map((problem) => `§7: ${problem}`));
  if (input.ownerLedgerSha256 === "") reasons.push("§7: the Owner intervention ledger file is missing");
  const ownerInterventions = input.ownerLedger ? deriveOwnerInterventions(input.ownerLedger) : 0;
  if (ownerInterventions > 0) reasons.push(`§57: ${ownerInterventions} Owner intervention(s) were needed; the black box forbids them`);

  const ledgerSource: TrustedEvidenceSource = {
    kind: "owner_ledger",
    gate: "owner-interventions",
    report_file: input.ownerLedgerFile ?? "",
    report_sha256: input.ownerLedgerSha256,
    attestation_file: "",
    attestation_sha256: "",
    verdict: ledgerProblems.length === 0 && input.ownerLedgerSha256 !== "" ? "PASS" : "FAIL",
    required_ids: 0,
    verified_ids: input.ownerLedger?.events.length ?? 0,
    problems: ledgerProblems
  };
  const sessionSource: TrustedEvidenceSource = {
    kind: "session",
    gate: "acceptance-session",
    report_file: input.session_file ?? "",
    report_sha256: input.session_sha256,
    attestation_file: "",
    attestation_sha256: "",
    verdict: session && sessionProblems(session).length === 0 && input.session_sha256 !== "" ? "PASS" : "FAIL",
    required_ids: 0,
    verified_ids: 0,
    problems: session ? sessionProblems(session) : ["SESSION_NOT_OBJECT"]
  };

  const trusted = new Set<string>([
    ...gateSources.filter((source) => source.verdict === "PASS").map((source) => source.gate),
    ...(desktopSource.verdict === "PASS" ? [DESKTOP_BLACK_BOX_GATE] : [])
  ]);
  const capabilityEvidence = CRITICAL_CAPABILITIES.map((capability) => {
    const proof = CAPABILITY_GATES[capability] ?? [];
    const provenBy = proof.filter((gate) => trusted.has(gate));
    return { capability, gates: [...proof], established: proof.length > 0 && provenBy.length === proof.length };
  });
  const established = capabilityEvidence.filter((entry) => entry.established).map((entry) => entry.capability);
  const completion = bootstrapCompletion(established);
  if (!completion.complete) reasons.push(completion.reason);

  const sources = [...gateSources, desktopSource, ledgerSource, sessionSource];
  const provenance = {
    same_session: !sources.some((source) => source.problems.some((problem) => problem.includes("SESSION_MISMATCH"))),
    same_commit: !sources.some((source) => source.problems.some((problem) => problem.includes("COMMIT_MISMATCH"))),
    source_hashes_verified: !sources.some((source) => source.problems.some((problem) => problem.includes("SOURCE_HASH_MISMATCH"))
      || source.problems.includes("REPORT_MISSING")
      || source.problems.includes("ATTESTATION_FILE_MISSING"))
  };
  if (!provenance.same_session) reasons.push("§2.3: the evidence does not all belong to this session");
  if (!provenance.same_commit) reasons.push("§2.4: the evidence does not all belong to this commit");
  if (!provenance.source_hashes_verified) reasons.push("§2.7: at least one source hash could not be verified");

  const gatesPassed = gateSources.filter((source) => source.verdict === "PASS").length;
  const decision: TrustedBootstrapAudit["decision"] = reasons.length === 0 ? "BOOTSTRAP_COMPLETE" : "INCOMPLETE";
  const rootHash = canonicalSha256({
    schema: "prestart-bootstrap-root-1",
    session_id: session?.session_id ?? "",
    commit_sha: session?.commit_sha ?? "",
    sources: sources.map((source) => ({
      kind: source.kind,
      gate: source.gate,
      report_file: source.report_file,
      report_sha256: source.report_sha256,
      attestation_file: source.attestation_file,
      attestation_sha256: source.attestation_sha256,
      verdict: source.verdict
    })),
    owner_interventions: ownerInterventions,
    capabilities: { passed: established.length, required: CRITICAL_CAPABILITIES.length },
    decision
  });

  const audit: Omit<TrustedBootstrapAudit, "hash" | "root_hash"> = {
    schemaVersion: 2,
    version: BOOTSTRAP_AUDIT_VERSION,
    session_id: session?.session_id ?? "",
    commit_sha: session?.commit_sha ?? "",
    decision,
    gates_passed: gatesPassed,
    gates_required: gateSources.length,
    gates: gateSources,
    desktop: {
      ...desktopSource,
      contract: DESKTOP_BLACK_BOX_CONTRACT.contract_version,
      verified_claims: desktopJudgement.validation?.counts.pass ?? 0,
      required_claims: desktopSource.required_ids
    },
    capabilities: { passed: established.length, required: CRITICAL_CAPABILITIES.length },
    capability_evidence: capabilityEvidence,
    completion,
    owner_interventions: ownerInterventions,
    owner_intervention_ledger: {
      session_id: input.ownerLedger?.session_id ?? "",
      commit_sha: input.ownerLedger?.commit_sha ?? "",
      events: ownerInterventions,
      hash: input.ownerLedger?.ledger_hash ?? "",
      sha256: input.ownerLedgerSha256
    },
    provenance,
    sources,
    reasons,
    summary: decision === "BOOTSTRAP_COMPLETE"
      ? `§57/§58: ${gatesPassed}/${gateSources.length} gates produced trusted evidence, the desktop black box satisfied its complete claim contract, all ${CRITICAL_CAPABILITIES.length} capabilities are established, and the Owner intervention ledger is empty`
      : `§57/§58: INCOMPLETE — ${reasons.length} reason(s)`
  };
  return { ...audit, root_hash: rootHash, hash: rootHash };
}
