/**
 * Closure terminal-evaluation PURE LOGIC (Host-A Phase B/C).
 *
 * No fs / no repo deps — fully unit-testable. The report generator
 * (scripts/closure-acceptance-report.mjs) and any validator consume this.
 *
 * Legal terminal semantics (Host-A §4/§5, R43 plan §17/§18):
 * - COMPLETE:            every required requirement is PASS or LOCKED_PASS
 *                        AND every required PASS passes evidence integrity.
 * - BLOCKED_EXTERNAL:    >=1 required BLOCKED_EXTERNAL with legal blocker
 *                        evidence, all other required PASS/LOCKED_PASS.
 * - FAILED_TERMINAL:     >=1 required FAILED_WITH_EVIDENCE (never COMPLETE).
 * - NO_LEGAL_TERMINAL_YET: any REQUIRED_PENDING / IN_PROGRESS / REWORK /
 *                        LIVE_REQUIRED, OR a blocker/PASS missing evidence.
 *
 * The quasi-terminal "BLOCKED_EXTERNAL_REQUIRED" is forbidden.
 */

export const TERMINAL_OK = ["PASS", "LOCKED_PASS"];
export const PENDING_STATES = ["REQUIRED_PENDING", "IN_PROGRESS", "REWORK", "LIVE_REQUIRED"];
export const BLOCKER_STATE = "BLOCKED_EXTERNAL";
export const FAILED_STATE = "FAILED_WITH_EVIDENCE";

/**
 * Pure evaluation of the requirement manifest terminal state.
 *
 * @param {object} input
 * @param {Array<{id:string, required:boolean, status:string, evidence?:Array}>} input.requirements
 * @param {Record<string, boolean>} [input.evidenceOk]    per-required-id PASS evidence integrity (Phase C)
 * @param {Record<string, boolean>} [input.blockerEvidenceOk] per-required-id BLOCKED_EXTERNAL structured evidence
 * @returns {{terminal:string, counts:Record<string,number>, pending:Array<string>,
 *            blockers:Array<string>, failed:Array<string>, reasons:Array<string>,
 *            incompleteEvidence:Array<string>}}
 */
export function evaluateTerminal({ requirements, evidenceOk = {}, blockerEvidenceOk = {} }) {
  const required = requirements.filter((r) => r.required);
  const counts = {};
  for (const r of required) counts[r.status] = (counts[r.status] || 0) + 1;

  const pending = required.filter((r) => PENDING_STATES.includes(r.status));
  const failed = required.filter((r) => r.status === FAILED_STATE);
  const blockers = required.filter((r) => r.status === BLOCKER_STATE);
  const passers = required.filter((r) => TERMINAL_OK.includes(r.status));

  const reasons = [];
  const incompleteEvidence = [];

  if (failed.length > 0) {
    reasons.push(`required FAILED_WITH_EVIDENCE present: ${failed.map((r) => r.id).join(", ")}`);
    return { terminal: "FAILED_TERMINAL", counts, pending: pending.map((r) => r.id), blockers: blockers.map((r) => r.id), failed: failed.map((r) => r.id), reasons, incompleteEvidence };
  }

  if (pending.length > 0) {
    reasons.push(`pending required items: ${pending.map((r) => `${r.id}(${r.status})`).join(", ")}`);
    return { terminal: "NO_LEGAL_TERMINAL_YET", counts, pending: pending.map((r) => r.id), blockers: blockers.map((r) => r.id), failed: [], reasons, incompleteEvidence };
  }

  // No pending, no failed. Remaining possibilities: blockers + passers, or passers only.
  const malformedBlockers = blockers.filter((b) => !blockerEvidenceOk[b.id]);
  for (const b of malformedBlockers) {
    incompleteEvidence.push(b.id);
    reasons.push(`BLOCKED_EXTERNAL ${b.id} lacks legal structured blocker evidence`);
  }

  const passersMissingEvidence = passers.filter((p) => !evidenceOk[p.id]);
  for (const p of passersMissingEvidence) {
    incompleteEvidence.push(p.id);
    reasons.push(`PASS ${p.id} fails evidence integrity (empty evidence or required evidence file missing)`);
  }

  if (blockers.length > 0) {
    if (malformedBlockers.length === 0 && passersMissingEvidence.length === 0) {
      return { terminal: "BLOCKED_EXTERNAL", counts, pending: [], blockers: blockers.map((r) => r.id), failed: [], reasons, incompleteEvidence };
    }
    return { terminal: "NO_LEGAL_TERMINAL_YET", counts, pending: [], blockers: blockers.map((r) => r.id), failed: [], reasons, incompleteEvidence };
  }

  if (passersMissingEvidence.length === 0) {
    return { terminal: "COMPLETE", counts, pending: [], blockers: [], failed: [], reasons, incompleteEvidence };
  }
  return { terminal: "NO_LEGAL_TERMINAL_YET", counts, pending: [], blockers: [], failed: [], reasons, incompleteEvidence };
}

/**
 * Count statuses across all (not only required) requirements.
 * @param {Array<{status:string}>} requirements
 * @returns {Record<string, number>}
 */
export function countAllStatuses(requirements) {
  const counts = {};
  for (const r of requirements) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

/**
 * Decide whether a manifest evidence entry is a resolvable file reference.
 * Descriptive strings ("tests foo (+3)", "round-25 battery") are NOT file refs;
 * file refs end in a known file suffix or point into an evidence/ dir or an
 * absolute Windows path.
 * @param {string} trimmed
 * @returns {boolean}
 */
export function looksLikeEvidenceFileRef(trimmed) {
  return (
    /\.(json|md|txt|jsonl|log)$/.test(trimmed) ||
    /(^|[\\/])evidence[\\/]/.test(trimmed) ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  );
}

/**
 * Default evidence-integrity check for a PASS requirement (Phase C):
 * evidence array non-empty AND every file-like evidence entry exists under at
 * least one of the provided roots (manifest evidence dir and/or repo root).
 * Pure when `existsSync`/`resolve` are injected (tests inject stubs).
 *
 * @param {object} req requirement row {id, evidence}
 * @param {{roots:Array<string>, existsSync:(p:string)=>boolean, resolve:(root:string,p:string)=>string}} io
 * @returns {{ok:boolean, reasons:Array<string>}}
 */
export function evidenceIntegrityForPass(req, io) {
  const evidence = Array.isArray(req.evidence) ? req.evidence : [];
  const reasons = [];
  if (evidence.length === 0) reasons.push("evidence array is empty");
  const roots = Array.isArray(io.roots) && io.roots.length ? io.roots : [io.root || ""];
  const resolve = io.resolve || ((root, p) => (root ? `${root}/${p}` : p));
  for (const entry of evidence) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (!looksLikeEvidenceFileRef(trimmed)) continue;
    const found = roots.some((root) => io.existsSync(resolve(root, trimmed)));
    if (!found) reasons.push(`required evidence file missing: ${trimmed}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Validate structured BLOCKED_EXTERNAL evidence per Host-A §5 schema.
 * @param {object} ev evidence object (not the manifest row)
 * @returns {{ok:boolean, reasons:Array<string>}}
 */
export function validateBlockerEvidenceShape(ev) {
  const reasons = [];
  if (!ev || typeof ev !== "object") return { ok: false, reasons: ["blocker evidence is not an object"] };
  const requiredFields = [
    "requirement", "status", "attemptedAt", "externalDependency",
    "observedState", "operatorActionRequired", "retryCondition", "attemptEvidence",
  ];
  for (const field of requiredFields) {
    if (ev[field] === undefined || ev[field] === null || ev[field] === "") reasons.push(`missing field: ${field}`);
  }
  if (ev.status !== BLOCKER_STATE) reasons.push(`status must be ${BLOCKER_STATE}`);
  if (!Array.isArray(ev.attemptEvidence) || ev.attemptEvidence.length === 0) reasons.push("attemptEvidence must be a non-empty array");
  return { ok: reasons.length === 0, reasons };
}

/**
 * Generate an ASCII-safe markdown matrix row list (shared by report writers).
 * @param {Array<object>} requirements
 * @returns {string}
 */
export function matrixRows(requirements) {
  return requirements.map((req) => {
    const impl = Array.isArray(req.implementation) && req.implementation.length ? req.implementation.join("; ").slice(0, 180) : "-";
    const ev = Array.isArray(req.evidence) && req.evidence.length ? req.evidence.join("; ").slice(0, 180) : "-";
    return `| ${req.id} | ${req.status} | ${impl} | ${ev} |`;
  }).join("\n");
}
