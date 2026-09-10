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

/* ------------------------------------------------------------------ *
 * Requirement-specific validators (Host-A §5: R-202 and R-901 must use
 * dedicated validators). All pure; IO injected.
 * ------------------------------------------------------------------ */

/**
 * Host-A §D4 required counter minimums for a qualifying R-901 run.
 */
export const R901_MIN_COUNTERS = {
  slowdownObserved: 1,
  retryObserved: 1,
  checkpointWritten: 1,
  checkpointResumed: 1,
  degradationObserved: 1,
  fallbackContinuationObserved: 1,
  providerRecoveryObserved: 1,
};

/**
 * Validate R-901 soak evidence (Host-A §D1/D2/D4/D5).
 * @param {object} ev evidence object r901-<runId>.json
 * @param {Array<object>} [heartbeats] parsed heartbeat jsonl rows
 * @param {{minAcceptanceSeconds?:number, formal?:boolean, allowSleep?:number}} [opts]
 * @returns {{ok:boolean, qualifiesForAcceptance:boolean, reasons:Array<string>}}
 */
export function validateR901Evidence(ev, heartbeats = [], opts = {}) {
  const reasons = [];
  const minSeconds = opts.minAcceptanceSeconds ?? 7200;
  const formal = opts.formal ?? ev?.formal === true;
  const heartbeatGapAllowMs = opts.allowSleepMs ?? 5 * 60 * 1000;

  if (!ev || typeof ev !== "object") return { ok: false, qualifiesForAcceptance: false, reasons: ["evidence is not an object"] };
  for (const field of ["requirement", "runId", "pid", "gitHead", "startedAt", "hostId", "nodeVersion", "harnessVersion", "status", "stats", "continuity", "schedule"]) {
    if (ev[field] === undefined || ev[field] === null) reasons.push(`missing field: ${field}`);
  }
  if (ev.requirement !== "R-901") reasons.push("requirement must be R-901");

  const stats = ev.stats ?? {};
  const durationSec = stats.durationSec ?? 0;
  if (formal && durationSec < minSeconds) reasons.push(`durationSec ${durationSec} < MIN_ACCEPTANCE_SECONDS ${minSeconds}`);
  if (!(stats.activeTaskCount > 0)) reasons.push("activeTaskCount must be > 0");
  if (!(stats.completed > 0)) reasons.push("completed must be > 0");
  if (stats.fatalFailed !== 0) reasons.push(`fatalFailed must be 0 (got ${stats.fatalFailed})`);
  for (const [counter, min] of Object.entries(R901_MIN_COUNTERS)) {
    if ((stats[counter] ?? 0) < min) reasons.push(`${counter} must be >= ${min} (got ${stats[counter] ?? 0})`);
  }

  // D5 continuity: heartbeat rows must be present and gaps explainable.
  const rows = Array.isArray(heartbeats) && heartbeats.length ? heartbeats : (Array.isArray(ev.heartbeats) ? ev.heartbeats : []);
  if (rows.length === 0 && formal) reasons.push("no heartbeat rows recorded (continuity unprovable)");
  if (rows.length >= 2) {
    let maxGapMs = 0;
    for (let i = 1; i < rows.length; i++) {
      const gap = new Date(rows[i].ts || rows[i].at || rows[i].updatedAt).getTime() - new Date(rows[i - 1].ts || rows[i - 1].at || rows[i - 1].updatedAt).getTime();
      if (Number.isFinite(gap) && gap > maxGapMs) maxGapMs = gap;
    }
    if (ev.continuity && maxGapMs > (ev.continuity.maxHeartbeatGapMs ?? 0)) {
      // Use the larger observed value so the validator never under-reports.
      maxGapMs = Math.max(maxGapMs, ev.continuity.maxHeartbeatGapMs ?? 0);
    }
    if (formal && maxGapMs > heartbeatGapAllowMs) reasons.push(`maxHeartbeatGapMs ${maxGapMs} exceeds allowed ${heartbeatGapAllowMs} (host suspend / process pause unproven continuous)`);
  }
  const continuity = ev.continuity ?? {};
  if (formal && continuity.endWallTime && continuity.startWallTime) {
    const wall = new Date(continuity.endWallTime).getTime() - new Date(continuity.startWallTime).getTime();
    if (Number.isFinite(wall) && wall / 1000 < minSeconds) reasons.push(`wall span ${Math.round(wall / 1000)}s < ${minSeconds}s`);
  }

  const ok = reasons.length === 0;
  return { ok, qualifiesForAcceptance: ok && formal, reasons };
}

/**
 * Validate R-202 live-provider-repair evidence (Host-A §E4) OR a legal
 * structured BLOCKED_EXTERNAL evidence (Host-A §5). Pure; shape-only.
 * @param {object} ev
 * @returns {{ok:boolean, reasons:Array<string>}}
 */
export function validateR202Evidence(ev) {
  if (!ev || typeof ev !== "object") return { ok: false, reasons: ["evidence is not an object"] };
  if (ev.status === BLOCKER_STATE) return validateBlockerEvidenceShape(ev);
  const reasons = [];
  if (ev.requirement !== "R-202") reasons.push("requirement must be R-202");
  const requiredLive = [
    "provider", "providerUrl", "authenticated", "initialAction", "recoveryEntered",
    "recoverySlot", "executor", "readinessPassed", "repairPlanSteps", "repairStatus",
    "postConditionVerified", "runId", "gitHead",
  ];
  for (const field of requiredLive) {
    if (ev[field] === undefined || ev[field] === null || ev[field] === "") reasons.push(`missing field: ${field}`);
  }
  if (ev.authenticated !== true) reasons.push("authenticated must be true for a REPAIRED PASS");
  if (!["FAILED", "UNVERIFIED"].includes(ev.initialAction)) reasons.push("initialAction must be FAILED or UNVERIFIED");
  if (ev.recoveryEntered !== true) reasons.push("recoveryEntered must be true");
  if (!(ev.repairStatus === "REPAIRED" || ev.repairStatus === "REPAIR_FAILED")) reasons.push("repairStatus must be REPAIRED or REPAIR_FAILED");
  if (ev.repairStatus === "REPAIRED" && ev.postConditionVerified !== true) reasons.push("postConditionVerified must be true when REPAIRED");
  if (!Array.isArray(ev.repairPlanSteps) || ev.repairPlanSteps.length === 0) reasons.push("repairPlanSteps must be a non-empty array");
  if (ev.runId && typeof ev.runId !== "string") reasons.push("runId must be a string");
  if (ev.gitHead && !/^[0-9a-f]{7,40}$/.test(ev.gitHead)) reasons.push("gitHead must be a commit sha");
  return { ok: reasons.length === 0, reasons };
}
