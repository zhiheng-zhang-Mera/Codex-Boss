/**
 * Update-Plan/checkpoint-2.md §2.1–§2.7, §5.3–§5.5 — the acceptance evidence layer.
 *
 * Three things live here, all pure:
 *
 *   1. `validateGateReport` — the strict report contract. A report is not trusted
 *      because it exists or because a caller says so: schema, unit, unique ids,
 *      required ids PASS, no FAIL, no undeclared NOT_RUN, `passed === true` and
 *      totals that agree with the results all have to hold.
 *   2. `buildGateAttestation` / `verifyGateAttestation` — the sidecar that binds a
 *      report to its SHA-256, its session, its commit and its contract version, so
 *      a raw report on its own is never evidence again.
 *   3. Canonical hashing, so a source file that changes invalidates every hash
 *      derived from it.
 *
 * Pure: no fs, no clock, no process.
 */
import { sha256Hex } from "./hash";
import {
  ACCEPTANCE_SUPPORTED_SCHEMA_VERSIONS,
  type AcceptanceGateContract
} from "./acceptance-contracts";

export const ACCEPTANCE_SESSION_SCHEMA_VERSION = 1 as const;
export const GATE_ATTESTATION_SCHEMA_VERSION = 1 as const;

/** §5.2 the manifest every authoritative Prestart run starts from. */
export interface AcceptanceSession {
  schemaVersion: 1;
  session_id: string;
  commit_sha: string;
  started_at: string;
  certification_mode: boolean;
  working_tree_clean: boolean;
  working_tree_status: string;
}

export type RequirementVerdict = "PASS" | "FAIL" | "NOT_RUN";

export interface ReportRequirementResult {
  id: string;
  verdict: string;
}

export interface GateReportLike {
  schemaVersion?: unknown;
  unit?: unknown;
  requirementResults?: unknown;
  totals?: unknown;
  passed?: unknown;
  generatedAt?: unknown;
}

/* ------------------------------------------------------------------ *
 * Canonical serialisation and hashing
 * ------------------------------------------------------------------ */

/**
 * Deterministic JSON: object keys are sorted at every depth, so the same value
 * always hashes to the same digest regardless of how it was built.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = canonicalize(source[key]);
    return sorted;
  }
  return value;
}

/** SHA-256 over any value's canonical serialisation. */
export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** §5.5: the hash of a contract's required id list, carried inside every attestation. */
export function requiredIdsHash(ids: readonly string[]): string {
  return canonicalSha256([...ids]);
}

/* ------------------------------------------------------------------ *
 * §5.4 the strict report contract
 * ------------------------------------------------------------------ */

export interface StrictReportValidation {
  gate: string;
  contract_version: string;
  verdict: "PASS" | "FAIL";
  /** Stable, machine-readable problems (`REQUIRED_ID_NOT_PASS:V-04=FAIL`, …). */
  reasons: string[];
  required_ids: string[];
  required_ids_hash: string;
  out_of_scope_ids: string[];
  /** True when the report's id set is exactly the contract's required set. */
  exact_id_set: boolean;
  ids: string[];
  counts: { results: number; pass: number; fail: number; notRun: number; extras: number; missing: number };
  hash: string;
}

export interface StrictValidationInput {
  gate: string;
  contract: AcceptanceGateContract;
  report: unknown;
  /**
   * §2.6/§6.3/§9.3: when true the report must carry *exactly* the contract's id
   * set — an extra or missing id is a failure even if every required id passed.
   */
  exact_ids?: boolean;
}

function problemText(key: string, detail?: string): string {
  return detail === undefined ? key : `${key}:${detail}`;
}

/** §5.4 + §2.1 evaluated. Anything that cannot be proven is a FAIL, never a pass. */
export function validateGateReport(input: StrictValidationInput): StrictReportValidation {
  const { gate, contract, report } = input;
  const exactIds = input.exact_ids === true;
  const reasons: string[] = [];
  const required = [...contract.required_ids];
  const outOfScope = contract.out_of_scope_ids.map((entry) => entry.id);
  const requiredSet = new Set(required);
  const outOfScopeSet = new Set(outOfScope);
  const results: ReportRequirementResult[] = [];
  const seen = new Set<string>();
  const duplicateIds: string[] = [];

  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    reasons.push(problemText("REPORT_NOT_OBJECT", report === undefined ? "undefined" : Array.isArray(report) ? "array" : typeof report));
  } else {
    const view = report as GateReportLike;
    const schemaVersion = view.schemaVersion;
    if (typeof schemaVersion !== "number") reasons.push("SCHEMA_VERSION_MISSING");
    else if (!ACCEPTANCE_SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) reasons.push(problemText("SCHEMA_VERSION_UNSUPPORTED", String(schemaVersion)));
    if (typeof view.unit !== "string" || view.unit.trim() === "") reasons.push("UNIT_MISSING");

    if (!Array.isArray(view.requirementResults)) {
      reasons.push("RESULTS_NOT_ARRAY");
    } else if (view.requirementResults.length === 0) {
      reasons.push("RESULTS_EMPTY");
    } else {
      view.requirementResults.forEach((entry, index) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          reasons.push(problemText("RESULT_NOT_OBJECT", String(index)));
          return;
        }
        const record = entry as { id?: unknown; verdict?: unknown };
        if (typeof record.id !== "string" || record.id.trim() === "") {
          reasons.push(problemText("RESULT_ID_INVALID", String(index)));
          return;
        }
        if (record.verdict !== "PASS" && record.verdict !== "FAIL" && record.verdict !== "NOT_RUN") {
          reasons.push(problemText("RESULT_VERDICT_INVALID", `${record.id}=${String(record.verdict)}`));
          return;
        }
        if (seen.has(record.id)) duplicateIds.push(record.id);
        seen.add(record.id);
        results.push({ id: record.id, verdict: record.verdict });
      });
    }

    if (view.passed !== true) {
      reasons.push(view.passed === undefined ? "PASSED_MISSING" : problemText("PASSED_NOT_TRUE", String(view.passed)));
    }

    const totals = view.totals;
    if (totals === null || typeof totals !== "object" || Array.isArray(totals)) {
      reasons.push("TOTALS_MISSING");
    } else {
      const record = totals as { pass?: unknown; fail?: unknown; notRun?: unknown };
      for (const field of ["pass", "fail", "notRun"] as const) {
        if (typeof record[field] !== "number" || !Number.isFinite(record[field])) reasons.push(problemText("TOTALS_FIELD_INVALID", field));
      }
    }
  }

  for (const id of duplicateIds) reasons.push(problemText("DUPLICATE_ID", id));

  const verdictOf = new Map(results.map((entry) => [entry.id, entry.verdict]));
  for (const id of required) {
    const verdict = verdictOf.get(id);
    if (verdict === undefined) reasons.push(problemText("REQUIRED_ID_MISSING", id));
    else if (verdict !== "PASS") reasons.push(problemText("REQUIRED_ID_NOT_PASS", `${id}=${verdict}`));
  }
  for (const entry of results) {
    if (entry.verdict === "FAIL") reasons.push(problemText("FAIL_PRESENT", entry.id));
    if (entry.verdict === "NOT_RUN" && !outOfScopeSet.has(entry.id)) reasons.push(problemText("NOT_RUN_PRESENT", entry.id));
  }
  // An exclusion must be declared *and* reported: an id that quietly disappears
  // from the report is not the same thing as a documented Post-Prestart scope.
  for (const ids of outOfScope) {
    if (!verdictOf.has(ids)) reasons.push(problemText("OUT_OF_SCOPE_ID_MISSING", ids));
    else if (verdictOf.get(ids) !== "NOT_RUN") reasons.push(problemText("OUT_OF_SCOPE_ID_NOT_NOT_RUN", `${ids}=${verdictOf.get(ids)}`));
  }

  const actual = {
    results: results.length,
    pass: results.filter((entry) => entry.verdict === "PASS").length,
    fail: results.filter((entry) => entry.verdict === "FAIL").length,
    notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length,
    extras: results.filter((entry) => !requiredSet.has(entry.id) && !outOfScopeSet.has(entry.id)).length,
    missing: required.filter((id) => !verdictOf.has(id)).length
  };
  const idSetExact = results.length === required.length && results.every((entry) => requiredSet.has(entry.id)) && required.every((id) => verdictOf.has(id));

  const objectReport = report !== null && typeof report === "object" && !Array.isArray(report) ? report as GateReportLike : undefined;
  if (objectReport) {
    const totals = objectReport.totals;
    if (totals !== null && typeof totals === "object" && !Array.isArray(totals)) {
      const record = totals as { pass?: unknown; fail?: unknown; notRun?: unknown };
      if (typeof record.pass === "number" && record.pass !== actual.pass) reasons.push(problemText("TOTALS_PASS_MISMATCH", `${record.pass}!=${actual.pass}`));
      if (typeof record.fail === "number" && record.fail !== actual.fail) reasons.push(problemText("TOTALS_FAIL_MISMATCH", `${record.fail}!=${actual.fail}`));
      if (typeof record.notRun === "number" && record.notRun !== actual.notRun) reasons.push(problemText("TOTALS_NOTRUN_MISMATCH", `${record.notRun}!=${actual.notRun}`));
      if (typeof record.pass === "number" && typeof record.fail === "number" && typeof record.notRun === "number"
        && record.pass + record.fail + record.notRun !== actual.results) {
        reasons.push(problemText("TOTALS_SUM_MISMATCH", `${record.pass + record.fail + record.notRun}!=${actual.results}`));
      }
    }
  }

  if (exactIds) {
    const extras = results.filter((entry) => !requiredSet.has(entry.id)).map((entry) => entry.id);
    const missing = required.filter((id) => !verdictOf.has(id));
    if (extras.length) reasons.push(problemText("EXACT_IDS_EXTRA", extras.join(",")));
    if (missing.length) reasons.push(problemText("EXACT_IDS_MISSING", missing.join(",")));
    if (!idSetExact && !extras.length && !missing.length) reasons.push("EXACT_IDS_COUNT_MISMATCH");
  }

  const validation: Omit<StrictReportValidation, "hash"> = {
    gate,
    contract_version: contract.contract_version,
    verdict: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
    required_ids: required,
    required_ids_hash: requiredIdsHash(required),
    out_of_scope_ids: outOfScope,
    exact_id_set: exactIds,
    ids: results.map((entry) => entry.id),
    counts: actual
  };
  return { ...validation, hash: canonicalSha256(validation) };
}

/* ------------------------------------------------------------------ *
 * §5.5 gate attestation
 * ------------------------------------------------------------------ */

export interface GateAttestation {
  schemaVersion: 1;
  gate: string;
  contract_version: string;
  session_id: string;
  commit_sha: string;
  source_file: string;
  source_sha256: string;
  validation: "PASS" | "FAIL";
  validation_reasons: string[];
  required_ids: string[];
  required_ids_hash: string;
  out_of_scope_ids: string[];
  counts: StrictReportValidation["counts"];
  attested_at: string;
  attestation_hash: string;
}

export interface BuildAttestationInput {
  gate: string;
  contract: AcceptanceGateContract;
  session: AcceptanceSession;
  /** SHA-256 of the report file's exact bytes; "" when the report is missing. */
  source_sha256: string;
  validation: StrictReportValidation;
  attested_at: string;
}

/** The attestation's own digest, computed over everything except the digest field. */
export function attestationHashOf(attestation: Omit<GateAttestation, "attestation_hash"> | GateAttestation): string {
  const { attestation_hash: _ignored, ...rest } = attestation as GateAttestation;
  return canonicalSha256(rest);
}

export function buildGateAttestation(input: BuildAttestationInput): GateAttestation {
  const body: Omit<GateAttestation, "attestation_hash"> = {
    schemaVersion: GATE_ATTESTATION_SCHEMA_VERSION,
    gate: input.gate,
    contract_version: input.contract.contract_version,
    session_id: input.session.session_id,
    commit_sha: input.session.commit_sha,
    source_file: input.contract.report_file,
    source_sha256: input.source_sha256,
    validation: input.validation.verdict,
    validation_reasons: [...input.validation.reasons],
    required_ids: [...input.validation.required_ids],
    required_ids_hash: input.validation.required_ids_hash,
    out_of_scope_ids: [...input.validation.out_of_scope_ids],
    counts: input.validation.counts,
    attested_at: input.attested_at
  };
  return { ...body, attestation_hash: attestationHashOf(body) };
}

export interface VerifyAttestationInput {
  gate: string;
  contract: AcceptanceGateContract;
  session: AcceptanceSession;
  attestation: unknown;
  /** The report the attestation claims to describe. */
  report: unknown;
  /** SHA-256 of the report file's exact current bytes; "" when the file is gone. */
  source_sha256: string;
  /** §2.4: the exact-id contract (desktop black box) also re-checks the id set. */
  exact_ids?: boolean;
}

/**
 * §2.2/§2.4/§2.7: an attestation is only evidence when the raw report, the
 * provenance it claims and the report's current bytes all still agree.
 * Returns the problems found; an empty array means the evidence is trustworthy.
 */
export function verifyGateAttestation(input: VerifyAttestationInput): string[] {
  const problems: string[] = [];
  const value = input.attestation;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [problemText("ATTESTATION_NOT_OBJECT", value === undefined ? "missing" : typeof value)];
  }
  const attestation = value as GateAttestation;
  if (attestation.schemaVersion !== GATE_ATTESTATION_SCHEMA_VERSION) problems.push(problemText("ATTESTATION_SCHEMA_UNSUPPORTED", String(attestation.schemaVersion)));
  if (attestation.gate !== input.gate) problems.push(problemText("ATTESTATION_GATE_MISMATCH", String(attestation.gate)));
  if (attestation.contract_version !== input.contract.contract_version) problems.push(problemText("ATTESTATION_CONTRACT_VERSION_MISMATCH", `${String(attestation.contract_version)}!=${input.contract.contract_version}`));
  if (attestation.session_id !== input.session.session_id) problems.push(problemText("ATTESTATION_SESSION_MISMATCH", `${String(attestation.session_id)}!=${input.session.session_id}`));
  if (attestation.commit_sha !== input.session.commit_sha) problems.push(problemText("ATTESTATION_COMMIT_MISMATCH", `${String(attestation.commit_sha)}!=${input.session.commit_sha}`));
  if (attestation.source_file !== input.contract.report_file) problems.push(problemText("ATTESTATION_SOURCE_FILE_MISMATCH", String(attestation.source_file)));
  if (input.source_sha256 === "") problems.push("ATTESTATION_SOURCE_MISSING");
  else if (attestation.source_sha256 !== input.source_sha256) problems.push(problemText("SOURCE_HASH_MISMATCH", `${String(attestation.source_sha256).slice(0, 12)}…!=${input.source_sha256.slice(0, 12)}…`));
  if (attestation.validation !== "PASS") problems.push(problemText("ATTESTATION_VALIDATION_NOT_PASS", String(attestation.validation)));
  if (attestation.required_ids_hash !== requiredIdsHash(input.contract.required_ids)) problems.push("ATTESTATION_REQUIRED_IDS_HASH_MISMATCH");
  if (canonicalJson(attestation.required_ids ?? null) !== canonicalJson([...input.contract.required_ids])) problems.push("ATTESTATION_REQUIRED_IDS_MISMATCH");
  const declaredOutOfScope = input.contract.out_of_scope_ids.map((entry) => entry.id);
  if (canonicalJson(attestation.out_of_scope_ids ?? null) !== canonicalJson(declaredOutOfScope)) problems.push("ATTESTATION_OUT_OF_SCOPE_MISMATCH");
  if (typeof attestation.attestation_hash !== "string" || attestation.attestation_hash !== attestationHashOf(attestation)) problems.push("ATTESTATION_HASH_MISMATCH");
  const revalidation = validateGateReport({
    gate: input.gate,
    contract: input.contract,
    report: input.report,
    ...(input.exact_ids ? { exact_ids: true } : {})
  });
  if (revalidation.verdict !== "PASS") problems.push(...revalidation.reasons.map((reason) => problemText("REVALIDATION_FAILED", reason)));
  return problems;
}

/* ------------------------------------------------------------------ *
 * §5.2 session integrity
 * ------------------------------------------------------------------ */

/** Structural problems in a session manifest; empty means the session is well formed. */
export function sessionProblems(session: unknown): string[] {
  const problems: string[] = [];
  if (session === null || typeof session !== "object" || Array.isArray(session)) return ["SESSION_NOT_OBJECT"];
  const value = session as Partial<AcceptanceSession>;
  if (value.schemaVersion !== ACCEPTANCE_SESSION_SCHEMA_VERSION) problems.push(problemText("SESSION_SCHEMA_UNSUPPORTED", String(value.schemaVersion)));
  if (typeof value.session_id !== "string" || value.session_id.trim() === "") problems.push("SESSION_ID_MISSING");
  if (typeof value.commit_sha !== "string" || !/^[0-9a-f]{40}$/.test(value.commit_sha)) problems.push(problemText("SESSION_COMMIT_INVALID", String(value.commit_sha)));
  if (typeof value.started_at !== "string" || Number.isNaN(Date.parse(value.started_at))) problems.push("SESSION_STARTED_AT_INVALID");
  if (typeof value.certification_mode !== "boolean") problems.push("SESSION_CERTIFICATION_MODE_MISSING");
  if (typeof value.working_tree_clean !== "boolean") problems.push("SESSION_WORKING_TREE_FLAG_MISSING");
  if (value.certification_mode === true && value.working_tree_clean !== true) problems.push("SESSION_CERTIFICATION_ON_DIRTY_TREE");
  return problems;
}
