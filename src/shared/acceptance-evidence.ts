/**
 * Update-Plan/checkpoint-2.md §2.1–§2.7, §5.3–§5.5 + Update-Plan/self-evlo.md §43/§44 —
 * the acceptance evidence layer.
 *
 * Three things live here, all pure:
 *
 *   1. `validateGateReport` — the strict report contract. A report is not trusted
 *      because it exists or because a caller says so: schema, unit, unique ids,
 *      required ids PASS, no FAIL, no undeclared NOT_RUN, `passed === true` and
 *      totals that agree with the results all have to hold.
 *   2. `buildGateAttestation` / `verifyGateAttestation` — the sidecar that binds a
 *      report to its SHA-256, its session, its commit, its tree and its contract
 *      version, so a raw report on its own is never evidence again.
 *   3. Canonical hashing, so a source file that changes invalidates every hash
 *      derived from it.
 *
 * §44: every problem is a structured `TrustProblem`; the `reasons` arrays are a
 * display projection and no control flow may branch on them.
 *
 * Pure: no fs, no clock, no process.
 */
import { sha256Hex } from "./hash";
import {
  ACCEPTANCE_SUPPORTED_SCHEMA_VERSIONS,
  type AcceptanceGateContract
} from "./acceptance-contracts";
import {
  DESKTOP_BLACK_BOX_CONTRACT_HASH,
  DESKTOP_BLACK_BOX_CONTRACT_VERSION,
  DESKTOP_BLACK_BOX_REQUIRED_CLAIMS
} from "./desktop-black-box-contract";
import {
  TRUST_CODES,
  renderTrustProblems,
  trustProblem,
  type TrustProblem
} from "./trust-problems";

export const ACCEPTANCE_SESSION_SCHEMA_VERSION = 1 as const;
export const GATE_ATTESTATION_SCHEMA_VERSION = 1 as const;

/** §5.2 the manifest every authoritative Prestart run starts from. */
export interface AcceptanceSession {
  schemaVersion: 1;
  session_id: string;
  commit_sha: string;
  /** §6: the commit's tree, so amended trees cannot reuse a session. */
  tree_sha?: string;
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
  /** §44: the structured truth. */
  problems: TrustProblem[];
  /** Display projection of `problems`; never used for control flow. */
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
   * Defaults to the contract's own `exact_ids` declaration.
   */
  exact_ids?: boolean;
}

/** §5.4 + §2.1 evaluated. Anything that cannot be proven is a FAIL, never a pass. */
export function validateGateReport(input: StrictValidationInput): StrictReportValidation {
  const { gate, contract, report } = input;
  const exactIds = input.exact_ids ?? contract.exact_ids === true;
  const problems: TrustProblem[] = [];
  const required = [...contract.required_ids];
  const outOfScope = contract.out_of_scope_ids.map((entry) => entry.id);
  const requiredSet = new Set(required);
  const outOfScopeSet = new Set(outOfScope);
  const results: ReportRequirementResult[] = [];
  const seen = new Set<string>();
  const duplicateIds: string[] = [];

  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    problems.push(trustProblem(TRUST_CODES.REPORT_NOT_OBJECT, report === undefined ? "undefined" : Array.isArray(report) ? "array" : typeof report));
  } else {
    const view = report as GateReportLike;
    const schemaVersion = view.schemaVersion;
    if (typeof schemaVersion !== "number") problems.push(trustProblem(TRUST_CODES.SCHEMA_VERSION_MISSING));
    else if (!ACCEPTANCE_SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) problems.push(trustProblem(TRUST_CODES.SCHEMA_VERSION_UNSUPPORTED, String(schemaVersion)));
    if (typeof view.unit !== "string" || view.unit.trim() === "") problems.push(trustProblem(TRUST_CODES.UNIT_MISSING));

    if (!Array.isArray(view.requirementResults)) {
      problems.push(trustProblem(TRUST_CODES.RESULTS_NOT_ARRAY));
    } else if (view.requirementResults.length === 0) {
      problems.push(trustProblem(TRUST_CODES.RESULTS_EMPTY));
    } else {
      view.requirementResults.forEach((entry, index) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          problems.push(trustProblem(TRUST_CODES.RESULT_NOT_OBJECT, String(index)));
          return;
        }
        const record = entry as { id?: unknown; verdict?: unknown };
        if (typeof record.id !== "string" || record.id.trim() === "") {
          problems.push(trustProblem(TRUST_CODES.RESULT_ID_INVALID, String(index)));
          return;
        }
        if (record.verdict !== "PASS" && record.verdict !== "FAIL" && record.verdict !== "NOT_RUN") {
          problems.push(trustProblem(TRUST_CODES.RESULT_VERDICT_INVALID, `${record.id}=${String(record.verdict)}`));
          return;
        }
        if (seen.has(record.id)) duplicateIds.push(record.id);
        seen.add(record.id);
        results.push({ id: record.id, verdict: record.verdict });
      });
    }

    if (view.passed !== true) {
      problems.push(view.passed === undefined ? trustProblem(TRUST_CODES.PASSED_MISSING) : trustProblem(TRUST_CODES.PASSED_NOT_TRUE, String(view.passed)));
    }

    const totals = view.totals;
    if (totals === null || typeof totals !== "object" || Array.isArray(totals)) {
      problems.push(trustProblem(TRUST_CODES.TOTALS_MISSING));
    } else {
      const record = totals as { pass?: unknown; fail?: unknown; notRun?: unknown };
      for (const field of ["pass", "fail", "notRun"] as const) {
        if (typeof record[field] !== "number" || !Number.isFinite(record[field])) problems.push(trustProblem(TRUST_CODES.TOTALS_FIELD_INVALID, field));
      }
    }
  }

  for (const id of duplicateIds) problems.push(trustProblem(TRUST_CODES.DUPLICATE_ID, id));

  const verdictOf = new Map(results.map((entry) => [entry.id, entry.verdict]));
  for (const id of required) {
    const verdict = verdictOf.get(id);
    if (verdict === undefined) problems.push(trustProblem(TRUST_CODES.REQUIRED_ID_MISSING, id));
    else if (verdict !== "PASS") problems.push(trustProblem(TRUST_CODES.REQUIRED_ID_NOT_PASS, `${id}=${verdict}`));
  }
  for (const entry of results) {
    if (entry.verdict === "FAIL") problems.push(trustProblem(TRUST_CODES.FAIL_PRESENT, entry.id));
    if (entry.verdict === "NOT_RUN" && !outOfScopeSet.has(entry.id)) problems.push(trustProblem(TRUST_CODES.NOT_RUN_PRESENT, entry.id));
  }
  // An exclusion must be declared *and* reported: an id that quietly disappears
  // from the report is not the same thing as a documented Post-Prestart scope.
  for (const id of outOfScope) {
    if (!verdictOf.has(id)) problems.push(trustProblem(TRUST_CODES.OUT_OF_SCOPE_ID_MISSING, id));
    else if (verdictOf.get(id) !== "NOT_RUN") problems.push(trustProblem(TRUST_CODES.OUT_OF_SCOPE_ID_NOT_NOT_RUN, `${id}=${verdictOf.get(id)}`));
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
      if (typeof record.pass === "number" && record.pass !== actual.pass) problems.push(trustProblem(TRUST_CODES.TOTALS_PASS_MISMATCH, `${record.pass}!=${actual.pass}`));
      if (typeof record.fail === "number" && record.fail !== actual.fail) problems.push(trustProblem(TRUST_CODES.TOTALS_FAIL_MISMATCH, `${record.fail}!=${actual.fail}`));
      if (typeof record.notRun === "number" && record.notRun !== actual.notRun) problems.push(trustProblem(TRUST_CODES.TOTALS_NOTRUN_MISMATCH, `${record.notRun}!=${actual.notRun}`));
      if (typeof record.pass === "number" && typeof record.fail === "number" && typeof record.notRun === "number"
        && record.pass + record.fail + record.notRun !== actual.results) {
        problems.push(trustProblem(TRUST_CODES.TOTALS_SUM_MISMATCH, `${record.pass + record.fail + record.notRun}!=${actual.results}`));
      }
    }
  }

  if (exactIds) {
    // Repeated occurrences of a required id are extras too: the contract fixes the
    // claim set, not just the claim names.
    const extras = [...new Set([
      ...results.filter((entry) => !requiredSet.has(entry.id)).map((entry) => entry.id),
      ...duplicateIds
    ])];
    const missing = required.filter((id) => !verdictOf.has(id));
    if (extras.length) problems.push(trustProblem(TRUST_CODES.EXACT_IDS_EXTRA, extras.join(",")));
    if (missing.length) problems.push(trustProblem(TRUST_CODES.EXACT_IDS_MISSING, missing.join(",")));
    if (!idSetExact && !extras.length && !missing.length) problems.push(trustProblem(TRUST_CODES.EXACT_IDS_COUNT_MISMATCH));
  }

  const validation: Omit<StrictReportValidation, "hash"> = {
    gate,
    contract_version: contract.contract_version,
    verdict: problems.length === 0 ? "PASS" : "FAIL",
    problems,
    reasons: renderTrustProblems(problems),
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
  /** §6: the tree the session was opened on. */
  tree_sha: string;
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
    tree_sha: input.session.tree_sha ?? "",
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
}

/**
 * §2.2/§2.4/§2.7: an attestation is only evidence when the raw report, the
 * provenance it claims and the report's current bytes all still agree.
 * Returns the structured problems found; an empty array means trustworthy.
 */
export function verifyGateAttestation(input: VerifyAttestationInput): TrustProblem[] {
  const problems: TrustProblem[] = [];
  const value = input.attestation;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [trustProblem(TRUST_CODES.ATTESTATION_NOT_OBJECT, value === undefined ? "missing" : typeof value)];
  }
  const attestation = value as GateAttestation;
  if (attestation.schemaVersion !== GATE_ATTESTATION_SCHEMA_VERSION) problems.push(trustProblem(TRUST_CODES.ATTESTATION_SCHEMA_UNSUPPORTED, String(attestation.schemaVersion)));
  if (attestation.gate !== input.gate) problems.push(trustProblem(TRUST_CODES.ATTESTATION_GATE_MISMATCH, String(attestation.gate)));
  if (attestation.contract_version !== input.contract.contract_version) problems.push(trustProblem(TRUST_CODES.ATTESTATION_CONTRACT_VERSION_MISMATCH, `${String(attestation.contract_version)}!=${input.contract.contract_version}`));
  if (attestation.session_id !== input.session.session_id) problems.push(trustProblem(TRUST_CODES.ATTESTATION_SESSION_MISMATCH, `${String(attestation.session_id)}!=${input.session.session_id}`));
  if (attestation.commit_sha !== input.session.commit_sha) problems.push(trustProblem(TRUST_CODES.ATTESTATION_COMMIT_MISMATCH, `${String(attestation.commit_sha)}!=${input.session.commit_sha}`));
  // §6: when the session knows its tree, the attestation must agree with it.
  if (typeof input.session.tree_sha === "string" && input.session.tree_sha !== "" && attestation.tree_sha !== input.session.tree_sha) {
    problems.push(trustProblem(TRUST_CODES.ATTESTATION_TREE_MISMATCH, `${String(attestation.tree_sha)}!=${input.session.tree_sha}`));
  }
  if (attestation.source_file !== input.contract.report_file) problems.push(trustProblem(TRUST_CODES.ATTESTATION_SOURCE_FILE_MISMATCH, String(attestation.source_file)));
  if (input.source_sha256 === "") problems.push(trustProblem(TRUST_CODES.ATTESTATION_SOURCE_MISSING));
  else if (attestation.source_sha256 !== input.source_sha256) problems.push(trustProblem(TRUST_CODES.SOURCE_HASH_MISMATCH, `${String(attestation.source_sha256).slice(0, 12)}…!=${input.source_sha256.slice(0, 12)}…`));
  if (attestation.validation !== "PASS") problems.push(trustProblem(TRUST_CODES.ATTESTATION_VALIDATION_NOT_PASS, String(attestation.validation)));
  if (attestation.required_ids_hash !== requiredIdsHash(input.contract.required_ids)) problems.push(trustProblem(TRUST_CODES.ATTESTATION_REQUIRED_IDS_HASH_MISMATCH));
  if (canonicalJson(attestation.required_ids ?? null) !== canonicalJson([...input.contract.required_ids])) problems.push(trustProblem(TRUST_CODES.ATTESTATION_REQUIRED_IDS_MISMATCH));
  const declaredOutOfScope = input.contract.out_of_scope_ids.map((entry) => entry.id);
  if (canonicalJson(attestation.out_of_scope_ids ?? null) !== canonicalJson(declaredOutOfScope)) problems.push(trustProblem(TRUST_CODES.ATTESTATION_OUT_OF_SCOPE_MISMATCH));
  if (typeof attestation.attestation_hash !== "string" || attestation.attestation_hash !== attestationHashOf(attestation)) problems.push(trustProblem(TRUST_CODES.ATTESTATION_HASH_MISMATCH));
  const revalidation = validateGateReport({
    gate: input.gate,
    contract: input.contract,
    report: input.report
  });
  if (revalidation.verdict !== "PASS") problems.push(...revalidation.problems.map((problem) => trustProblem(TRUST_CODES.REVALIDATION_FAILED, problem.detail === undefined ? problem.code : `${problem.code}:${problem.detail}`)));
  return problems;
}

/* ------------------------------------------------------------------ *
 * §2.6/§6.3 the desktop black-box contract
 * ------------------------------------------------------------------ */

export interface DesktopValidationInput {
  contract: AcceptanceGateContract;
  report: unknown;
}

/**
 * §2.6: the desktop black box is not "a report exists". It must declare the
 * versioned claim contract it ran under, carry that contract's exact claim set,
 * and pass every one of its claims. A report under a different contract version,
 * a different claim digest, or a subset of the claims is refused.
 */
export function validateDesktopBlackBoxReport(input: DesktopValidationInput): StrictReportValidation {
  const validation = validateGateReport({ gate: input.contract.gate, contract: input.contract, report: input.report });
  const problems = [...validation.problems];
  const report = input.report !== null && typeof input.report === "object" && !Array.isArray(input.report)
    ? input.report as { contract?: unknown }
    : undefined;
  const declared = report?.contract;
  if (declared === null || typeof declared !== "object" || Array.isArray(declared)) {
    problems.push(trustProblem(TRUST_CODES.DESKTOP_CONTRACT_MISSING));
  } else {
    const value = declared as { version?: unknown; required_claims?: unknown; claim_ids_hash?: unknown; required_ids_hash?: unknown };
    if (value.version !== DESKTOP_BLACK_BOX_CONTRACT_VERSION) problems.push(trustProblem(TRUST_CODES.DESKTOP_CONTRACT_VERSION_MISMATCH, String(value.version)));
    if (value.required_claims !== DESKTOP_BLACK_BOX_REQUIRED_CLAIMS) problems.push(trustProblem(TRUST_CODES.DESKTOP_CONTRACT_COUNT_MISMATCH, String(value.required_claims)));
    const declaredHash = typeof value.claim_ids_hash === "string" ? value.claim_ids_hash : value.required_ids_hash;
    if (declaredHash !== DESKTOP_BLACK_BOX_CONTRACT_HASH) problems.push(trustProblem(TRUST_CODES.DESKTOP_CONTRACT_HASH_MISMATCH, String(declaredHash)));
  }
  const validationOut: StrictReportValidation = {
    ...validation,
    problems,
    reasons: renderTrustProblems(problems),
    verdict: problems.length === 0 ? "PASS" : "FAIL"
  };
  const { hash: _discarded, ...body } = validationOut;
  return { ...body, hash: canonicalSha256(body) };
}

/* ------------------------------------------------------------------ *
 * §5.2 session integrity
 * ------------------------------------------------------------------ */

/** Structural problems in a session manifest; empty means the session is well formed. */
export function sessionProblems(session: unknown): TrustProblem[] {
  const problems: TrustProblem[] = [];
  if (session === null || typeof session !== "object" || Array.isArray(session)) return [trustProblem(TRUST_CODES.SESSION_NOT_OBJECT)];
  const value = session as Partial<AcceptanceSession>;
  if (value.schemaVersion !== ACCEPTANCE_SESSION_SCHEMA_VERSION) problems.push(trustProblem(TRUST_CODES.SESSION_SCHEMA_UNSUPPORTED, String(value.schemaVersion)));
  if (typeof value.session_id !== "string" || value.session_id.trim() === "") problems.push(trustProblem(TRUST_CODES.SESSION_ID_MISSING));
  if (typeof value.commit_sha !== "string" || !/^[0-9a-f]{40}$/.test(value.commit_sha)) problems.push(trustProblem(TRUST_CODES.SESSION_COMMIT_INVALID, String(value.commit_sha)));
  if (typeof value.started_at !== "string" || Number.isNaN(Date.parse(value.started_at))) problems.push(trustProblem(TRUST_CODES.SESSION_STARTED_AT_INVALID));
  if (typeof value.certification_mode !== "boolean") problems.push(trustProblem(TRUST_CODES.SESSION_CERTIFICATION_MODE_MISSING));
  if (typeof value.working_tree_clean !== "boolean") problems.push(trustProblem(TRUST_CODES.SESSION_WORKING_TREE_FLAG_MISSING));
  if (value.certification_mode === true && value.working_tree_clean !== true) problems.push(trustProblem(TRUST_CODES.SESSION_CERTIFICATION_ON_DIRTY_TREE));
  // §6: a certification session must know the tree it certifies.
  if (value.certification_mode === true) {
    if (typeof value.tree_sha !== "string" || value.tree_sha === "") problems.push(trustProblem(TRUST_CODES.SESSION_TREE_MISSING));
    else if (!/^[0-9a-f]{40}$/.test(value.tree_sha)) problems.push(trustProblem(TRUST_CODES.SESSION_TREE_INVALID, value.tree_sha));
  } else if (typeof value.tree_sha === "string" && value.tree_sha !== "" && !/^[0-9a-f]{40}$/.test(value.tree_sha)) {
    problems.push(trustProblem(TRUST_CODES.SESSION_TREE_INVALID, value.tree_sha));
  }
  return problems;
}
