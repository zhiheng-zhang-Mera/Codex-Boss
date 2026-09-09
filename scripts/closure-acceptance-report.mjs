/**
 * R43 Phase J (R-1003): manifest-driven Acceptance Report generator.
 * Reads Update-Plan/2026-09-09-closure/requirement-manifest.json and writes
 * ACCEPTANCE-MATRIX.md / FINAL-ACCEPTANCE.md. Allowed final statuses are
 * PASS / LOCKED_PASS / BLOCKED_EXTERNAL / FAILED_WITH_EVIDENCE; any remaining
 * REQUIRED_PENDING / IN_PROGRESS / REWORK / LIVE_REQUIRED means NO legal
 * terminal yet. Pure Node, no repo dependencies.
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.join("Update-Plan", "2026-09-09-closure");
const raw = fs.readFileSync(path.join(dir, "requirement-manifest.json"), "utf8").replace(/^\uFEFF/, "");
const manifest = JSON.parse(raw);

const reqs = manifest.requirements;
const allowedTerminal = ["PASS", "LOCKED_PASS", "BLOCKED_EXTERNAL", "FAILED_WITH_EVIDENCE"];
const pendingStates = ["REQUIRED_PENDING", "IN_PROGRESS", "REWORK", "LIVE_REQUIRED"];
const counts = {};
for (const req of reqs) counts[req.status] = (counts[req.status] || 0) + 1;
const pending = reqs.filter((req) => req.required && pendingStates.includes(req.status));
const blockedExternal = reqs.filter((req) => req.required && req.status === "BLOCKED_EXTERNAL");
const othersPending = pending.filter((req) => req.status !== "LIVE_REQUIRED");
const legalTerminal = pending.length === 0 ? "COMPLETE" : othersPending.length === 0 && pending.length > 0 ? "BLOCKED_EXTERNAL_REQUIRED (live/external items remaining)" : "NO_LEGAL_TERMINAL_YET";

const rows = reqs.map((req) => {
  const impl = Array.isArray(req.implementation) && req.implementation.length ? req.implementation.join("; ").slice(0, 180) : "-";
  const ev = Array.isArray(req.evidence) && req.evidence.length ? req.evidence.join("; ").slice(0, 180) : "-";
  return `| ${req.id} | ${req.status} | ${impl} | ${ev} |`;
}).join("\n");

const matrix = `# Codex Boss Closure — Acceptance Matrix（manifest-generated ${new Date().toISOString()}）

| Requirement | Status | Implementation | Evidence |
|---|---|---|---|
${rows}

## Status summary
${Object.entries(counts).sort().map(([status, n]) => `${status}: ${n}`).join(" · ")}

## Terminal state assessment
- Pending (non-terminal): ${pending.map((req) => `${req.id}(${req.status})`).join(", ") || "none"}
- BLOCKED_EXTERNAL recorded: ${blockedExternal.map((req) => req.id).join(", ") || "none"}
- Legal terminal now: **${legalTerminal}**
`;

const final = `# Codex Boss — Closure Final Acceptance Report（manifest-generated ${new Date().toISOString()}）

Execution basis: Update-Plan/R43-Closure-Construction-Plan.md; Requirement Manifest = Update-Plan/2026-09-09-closure/requirement-manifest.json（唯一完成依据）.

## Status summary
${Object.entries(counts).sort().map(([status, n]) => `- ${status}: ${n}`).join("\n")}

## Terminal state
- Pending: ${pending.map((req) => `${req.id}(${req.status})`).join(", ") || "none"}
- Legal terminal now: **${legalTerminal}**
- Report generated from manifest — model free-text did not decide completion.
`;

fs.writeFileSync(path.join(dir, "ACCEPTANCE-MATRIX.md"), matrix, "utf8");
fs.writeFileSync(path.join(dir, "FINAL-ACCEPTANCE.md"), final, "utf8");
fs.writeFileSync(path.join(dir, "evidence", "r1003-acceptance-report.json"), JSON.stringify({
  requirement: "R-1003", phase: "J", date: new Date().toISOString(), status: "PASS",
  summary: "manifest-generated Acceptance Report (ACCEPTANCE-MATRIX.md + FINAL-ACCEPTANCE.md)",
  counts, legalTerminal, pending: pending.map((req) => req.id), generatedAt: new Date().toISOString()
}, null, 2), "utf8");
console.log(JSON.stringify({ counts, legalTerminal, pending: pending.map((r) => r.id) }, null, 2));
