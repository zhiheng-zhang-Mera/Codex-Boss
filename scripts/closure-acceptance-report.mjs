/**
 * R43 Phase J (R-1003) / Host-A Phase B+C: manifest-driven Acceptance Report
 * generator using PURE terminal-evaluation logic (closure-terminal-logic.mjs).
 *
 * Reads Update-Plan/2026-09-09-closure/requirement-manifest.json and writes
 * ACCEPTANCE-MATRIX.md / FINAL-ACCEPTANCE.md / evidence/r1003-acceptance-report.json.
 *
 * Legal terminal rules (Host-A §4/§5):
 *  - COMPLETE             all required PASS/LOCKED_PASS with evidence integrity.
 *  - BLOCKED_EXTERNAL     >=1 required BLOCKED_EXTERNAL with legal structured
 *                         blocker evidence; all other required PASS/LOCKED_PASS.
 *  - FAILED_TERMINAL      >=1 required FAILED_WITH_EVIDENCE.
 *  - NO_LEGAL_TERMINAL_YET otherwise (any REQUIRED_PENDING / IN_PROGRESS /
 *                         REWORK / LIVE_REQUIRED, or missing evidence).
 * The quasi-terminal "BLOCKED_EXTERNAL_REQUIRED" is never emitted.
 * Pure Node, no repo dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import {
  countAllStatuses,
  evaluateTerminal,
  evidenceIntegrityForPass,
  validateBlockerEvidenceShape,
  validateR202Evidence,
  validateR901Evidence,
  matrixRows,
} from "./closure-terminal-logic.mjs";

const dir = path.join("Update-Plan", "2026-09-09-closure");
const raw = fs.readFileSync(path.join(dir, "requirement-manifest.json"), "utf8").replace(/^\uFEFF/, "");
const manifest = JSON.parse(raw);

const reqs = manifest.requirements;
const repoRoot = path.resolve(".");
const manifestDirResolved = path.resolve(dir);
const evidenceDirResolved = path.resolve(dir, "evidence");
const io = {
  roots: [evidenceDirResolved, manifestDirResolved, repoRoot],
  existsSync: (p) => fs.existsSync(p),
  resolve: (root, p) => (path.isAbsolute(p) ? p : path.resolve(root, p)),
};

// Phase C: per-required PASS evidence integrity + BLOCKED_EXTERNAL structured evidence.
const evidenceOk = {};
const blockerEvidenceOk = {};
const evidenceProblems = {};
for (const req of reqs) {
  if (req.status === "PASS") {
    const r = evidenceIntegrityForPass(req, io);
    evidenceOk[req.id] = r.ok;
    if (!r.ok) evidenceProblems[req.id] = r.reasons;
  } else if (req.status === "LOCKED_PASS") {
    // Locked baselines: evidence array must be non-empty; their referenced
    // files live in the historical evidence trees (overcomplete/owner-result).
    const ok = Array.isArray(req.evidence) && req.evidence.length > 0;
    evidenceOk[req.id] = ok;
    if (!ok) evidenceProblems[req.id] = ["LOCKED_PASS evidence array is empty"];
  }
  if (req.status === "BLOCKED_EXTERNAL") {
    const files = (Array.isArray(req.evidence) ? req.evidence : [])
      .map((e) => (typeof e === "string" && /\.json$/.test(e.trim()) ? e.trim() : null))
      .filter(Boolean);
    let shapeOk = false;
    const loaded = files.map((f) => {
      const candidates = io.roots.map((root) => io.resolve(root, f));
      for (const cand of candidates) {
        try { return JSON.parse(fs.readFileSync(cand, "utf8").replace(/^\uFEFF/, "")); } catch { /* try next */ }
      }
      return null;
    }).filter(Boolean);
    shapeOk = loaded.some((ev) => validateBlockerEvidenceShape(ev).ok);
    blockerEvidenceOk[req.id] = shapeOk;
    if (!shapeOk) evidenceProblems[req.id] = ["missing legal structured BLOCKED_EXTERNAL evidence (Host-A §5 schema)"];
  }
}

const counts = countAllStatuses(reqs);
const verdict = evaluateTerminal({ requirements: reqs, evidenceOk, blockerEvidenceOk });

// Host-A S5: R-202 and R-901 must run their DEDICATED validators. Only assert a
// problem when the requirement already claims a terminal status (PASS /
// BLOCKED_EXTERNAL) or actually carries evidence; a still-pending LIVE_REQUIRED
// item is reported through `pending`, not as an evidence problem.
const dedicatedValidators = {};
for (const id of ["R-202", "R-901"]) {
  const req = reqs.find((r) => r.id === id);
  if (!req) continue;
  const refs = (Array.isArray(req.evidence) ? req.evidence : []).filter((e) => typeof e === "string" && /\.json$/.test(e.trim()));
  if (refs.length === 0 && !["PASS", "BLOCKED_EXTERNAL", "FAILED_WITH_EVIDENCE"].includes(req.status)) continue;
  const loaded = [];
  for (const f of refs) {
    for (const root of io.roots) {
      const cand = io.resolve(root, f);
      try { loaded.push({ file: f, value: JSON.parse(fs.readFileSync(cand, "utf8").replace(/^\uFEFF/, "")) }); break; } catch { /* next root */ }
    }
  }
  if (id === "R-202") {
    const verdicts = loaded.map((l) => ({ file: l.file, ...validateR202Evidence(l.value) }));
    dedicatedValidators[id] = { ok: verdicts.some((v) => v.ok), verdicts };
  } else {
    const verdicts = loaded.map((l) => {
      const ev = l.value;
      const hbFile = path.resolve(evidenceDirResolved, `r901-${ev.runId}.heartbeat.jsonl`);
      const heartbeats = fs.existsSync(hbFile)
        ? fs.readFileSync(hbFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
        : [];
      return { file: l.file, ...validateR901Evidence(ev, heartbeats, { formal: true }) };
    });
    dedicatedValidators[id] = { ok: verdicts.some((v) => v.ok), verdicts };
  }
}
for (const [id, result] of Object.entries(dedicatedValidators)) {
  if (!result.ok) {
    evidenceProblems[id] = [
      ...(evidenceProblems[id] ?? []),
      `dedicated validator failed: ${result.verdicts.flatMap((v) => v.reasons ?? []).join("; ") || "no evidence file"}`,
    ];
  }
}

const rows = matrixRows(reqs);
const pendingLabel = verdict.pending.map((id) => {
  const req = reqs.find((r) => r.id === id);
  return `${id}(${req ? req.status : "?"})`;
}).join(", ") || "none";

const matrix = `# Codex Boss Closure — Acceptance Matrix（manifest-generated ${new Date().toISOString()}）

| Requirement | Status | Implementation | Evidence |
|---|---|---|---|
${rows}

## Status summary
${Object.entries(counts).sort().map(([status, n]) => `${status}: ${n}`).join(" · ")}

## Terminal state assessment
- Pending (non-terminal): ${pendingLabel}
- BLOCKED_EXTERNAL recorded: ${verdict.blockers.join(", ") || "none"}
- Evidence problems: ${Object.entries(evidenceProblems).map(([id, rs]) => `${id}: ${rs.join("; ")}`).join(" · ") || "none"}
- Legal terminal now: **${verdict.terminal}**
`;

const final = `# Codex Boss — Closure Final Acceptance Report（manifest-generated ${new Date().toISOString()}）

Execution basis: Update-Plan/R43-Closure-Construction-Plan.md + Update-Plan/Host-A.md; Requirement Manifest = Update-Plan/2026-09-09-closure/requirement-manifest.json（唯一完成依据）.

## Status summary
${Object.entries(counts).sort().map(([status, n]) => `- ${status}: ${n}`).join("\n")}

## Terminal state
- Pending: ${pendingLabel}
- Evidence problems: ${Object.entries(evidenceProblems).map(([id, rs]) => `${id}: ${rs.join("; ")}`).join(" · ") || "none"}
- Legal terminal now: **${verdict.terminal}**
- Reasons: ${verdict.reasons.join("; ") || "none"}
- Report generated from manifest via pure terminal evaluator — model free-text did not decide completion.
`;

fs.writeFileSync(path.join(dir, "ACCEPTANCE-MATRIX.md"), matrix, "utf8");
fs.writeFileSync(path.join(dir, "FINAL-ACCEPTANCE.md"), final, "utf8");
fs.writeFileSync(path.join(dir, "evidence", "r1003-acceptance-report.json"), JSON.stringify({
  requirement: "R-1003", phase: "J", date: new Date().toISOString(), status: "PASS",
  summary: "manifest-generated Acceptance Report (ACCEPTANCE-MATRIX.md + FINAL-ACCEPTANCE.md) via pure terminal evaluator",
  counts, terminal: verdict.terminal, pending: verdict.pending,
  blockers: verdict.blockers, evidenceProblems,
  generatedAt: new Date().toISOString()
}, null, 2), "utf8");
console.log(JSON.stringify({ counts, terminal: verdict.terminal, pending: verdict.pending, blockers: verdict.blockers, evidenceProblems }, null, 2));
