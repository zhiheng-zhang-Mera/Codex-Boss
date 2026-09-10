#!/usr/bin/env node
/**
 * Host-A Phase F: manifest single-writer.
 *
 * The ONLY legal way to change a requirement status in
 * Update-Plan/2026-09-09-closure/requirement-manifest.json:
 *   1. read manifest            6. regenerate reports
 *   2. schema validate          7. re-read
 *   3. validate transition      8. JSON parse verify
 *   4. validate evidence        9. emit change log
 *   5. atomic write (tmp->rename)
 *
 * Usage:
 *   node scripts/closure-set-status.mjs <REQ-ID> <NEW-STATUS> \
 *       [--summary "..." --evidence evidence/rxxx.json --reason "..."]
 *   node scripts/closure-set-status.mjs --status <REQ-ID>      # print status
 *   node scripts/closure-set-status.mjs --transitions          # print allowed
 */
import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_MANIFEST_STATES,
  BLOCKER_STATE,
  MANIFEST_TRANSITIONS,
  transitionAllowed,
  validateBlockerEvidenceShape,
  evidenceIntegrityForPass,
  looksLikeEvidenceFileRef,
  validateManifestSchema,
  validateR901Evidence,
  validateR202Evidence,
} from "./closure-terminal-logic.mjs";

const MANIFEST = path.join("Update-Plan", "2026-09-09-closure", "requirement-manifest.json");
const dir = path.dirname(MANIFEST);
const evidenceDir = path.join(dir, "evidence");

function readManifest() {
  const raw = fs.readFileSync(MANIFEST, "utf8").replace(/^\uFEFF/, "");
  const manifest = JSON.parse(raw);
  return { manifest, raw };
}

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : null;
}

function hasFlag(name) { return process.argv.includes(name); }

function evidenceOkFor(req, newStatus) {
  // BLOCKED_EXTERNAL requires a legal structured blocker evidence file.
  if (newStatus === BLOCKER_STATE) {
    const files = (req.evidence ?? []).filter((e) => typeof e === "string" && looksLikeEvidenceFileRef(e) && /\.json$/.test(e.trim()));
    if (files.length === 0) return { ok: false, reasons: ["BLOCKED_EXTERNAL requires an evidence .json path entry"] };
    const ok = files.some((f) => {
      const candidate = [evidenceDir, path.resolve(".")].map((root) => path.resolve(root, f)).find((p) => fs.existsSync(p));
      if (!candidate) return false;
      try {
        const ev = JSON.parse(fs.readFileSync(candidate, "utf8").replace(/^\uFEFF/, ""));
        return validateBlockerEvidenceShape(ev).ok;
      } catch { return false; }
    });
    return ok ? { ok: true, reasons: [] } : { ok: false, reasons: ["no referenced file satisfies the Host-A §5 structured blocker evidence schema"] };
  }
  // PASS (and REWORK-with-evidence) requires a non-empty evidence list for R-202/R-901 paths.
  if (newStatus === "PASS") {
    const integrity = evidenceIntegrityForPass(req, { roots: [path.resolve(evidenceDir), path.resolve(".")], existsSync: (p) => fs.existsSync(p), resolve: (root, p) => path.resolve(root, p) });
    if (!integrity.ok) return { ok: false, reasons: integrity.reasons };
    if (req.id === "R-901") {
      const f = (req.evidence ?? []).find((e) => typeof e === "string" && /r901-.+\.json$/.test(e.trim()));
      if (!f) return { ok: false, reasons: ["R-901 PASS requires an r901-<runId>.json evidence reference"] };
      const cand = path.resolve(evidenceDir, f);
      if (!fs.existsSync(cand)) return { ok: false, reasons: [`r901 evidence file missing: ${f}`] };
      const ev = JSON.parse(fs.readFileSync(cand, "utf8").replace(/^\uFEFF/, ""));
      const runId = ev.runId ?? "unknown";
      const heartbeatFile = path.resolve(evidenceDir, `r901-${runId}.heartbeat.jsonl`);
      if (!fs.existsSync(heartbeatFile)) return { ok: false, reasons: [`r901 heartbeat jsonl missing: r901-${runId}.heartbeat.jsonl`] };
      const heartbeats = fs.readFileSync(heartbeatFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const verdict = validateR901Evidence(ev, heartbeats, { formal: true });
      if (!verdict.ok) return { ok: false, reasons: verdict.reasons };
      if (!verdict.qualifiesForAcceptance) return { ok: false, reasons: ["R-901 evidence does not qualify for acceptance"] };
    }
    if (req.id === "R-202") {
      const f = (req.evidence ?? []).find((e) => typeof e === "string" && /\.json$/.test(e.trim()));
      if (!f) return { ok: false, reasons: ["R-202 PASS requires a live repair evidence file"] };
      const cand = path.resolve(evidenceDir, f);
      if (!fs.existsSync(cand)) return { ok: false, reasons: [`R-202 evidence file missing: ${f}`] };
      const ev = JSON.parse(fs.readFileSync(cand, "utf8").replace(/^\uFEFF/, ""));
      const verdict = validateR202Evidence(ev);
      if (!verdict.ok) return { ok: false, reasons: verdict.reasons };
    }
    return { ok: true, reasons: [] };
  }
  return { ok: true, reasons: [] };
}

function atomicWrite(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: "utf8", flag: "w" });
  fs.renameSync(tmp, file);
}

function printStatus(id) {
  const { manifest } = readManifest();
  const req = manifest.requirements.find((r) => r.id === id);
  if (!req) { console.error(`unknown requirement ${id}`); process.exit(2); }
  console.log(JSON.stringify({ id: req.id, status: req.status, required: req.required, evidence: req.evidence }, null, 2));
}

if (hasFlag("--status")) { printStatus(getArg("--status")); process.exit(0); }
if (hasFlag("--transitions")) { console.log(JSON.stringify(MANIFEST_TRANSITIONS, null, 2)); process.exit(0); }

const id = process.argv[2];
const newStatus = process.argv[3];
const refreshMode = hasFlag("--refresh");
if (!id || (!newStatus && !refreshMode)) { console.error("usage: closure-set-status.mjs <REQ-ID> <NEW-STATUS> [--summary ..] [--evidence ..] [--reason ..] | closure-set-status.mjs <REQ-ID> --refresh [--summary ..] [--evidence ..] [--reason ..]"); process.exit(2); }
if (!refreshMode && !ALLOWED_MANIFEST_STATES.includes(newStatus)) { console.error(`invalid status ${newStatus}; allowed: ${ALLOWED_MANIFEST_STATES.join(", ")}`); process.exit(2); }

const { manifest, raw } = readManifest();
const schemaErrors = validateManifestSchema(manifest);
if (schemaErrors.length) { console.error("schema errors:", schemaErrors.join("; ")); process.exit(2); }

const req = manifest.requirements.find((r) => r.id === id);
if (!req) { console.error(`unknown requirement ${id}`); process.exit(2); }
const targetStatus = refreshMode ? req.status : newStatus;
if (!refreshMode) {
  const transition = transitionAllowed(req.status, newStatus);
  if (!transition.ok) {
    console.error(`illegal transition ${req.status} -> ${newStatus}: ${transition.reason}`);
    process.exit(2);
  }
}

const summary = getArg("--summary");
const reason = getArg("--reason");
const evidenceEntries = process.argv
  .filter((a, i) => i > 3 && (a === "--evidence" || process.argv[i - 1] === "--evidence"))
  .filter((a) => a !== "--evidence");

const nextReq = { ...req, status: targetStatus };
if (refreshMode) {
  if (!evidenceEntries.length) { console.error("--refresh requires at least one --evidence path"); process.exit(2); }
  nextReq.evidence = [...new Set(evidenceEntries)];
} else if (evidenceEntries.length) {
  nextReq.evidence = [...new Set([...(req.evidence ?? []), ...evidenceEntries])];
}
if (summary) nextReq.summary = summary;

const ev = evidenceOkFor(nextReq, targetStatus);
if (!ev.ok) { console.error(`evidence validation failed for ${id} -> ${targetStatus}: ${ev.reasons.join("; ")}`); process.exit(2); }

const index = manifest.requirements.findIndex((r) => r.id === id);
manifest.requirements[index] = nextReq;
const out = `${JSON.stringify(manifest, null, 2)}\n`;
atomicWrite(MANIFEST, out);

// Regenerate reports + evidence, then re-read & parse verify.
const { spawnSync } = await import("node:child_process");
const report = spawnSync(process.execPath, [path.join("scripts", "closure-acceptance-report.mjs")], { cwd: path.resolve("."), encoding: "utf8" });
if (report.status !== 0) { console.error("report regeneration failed:", report.stderr?.slice(0, 800)); process.exit(2); }

const rereadRaw = fs.readFileSync(MANIFEST, "utf8").replace(/^\uFEFF/, "");
JSON.parse(rereadRaw); // parse verify
const reread = JSON.parse(rereadRaw);
const finalReq = reread.requirements.find((r) => r.id === id);
if (finalReq.status !== targetStatus) { console.error("re-read verify failed"); process.exit(2); }

const log = {
  change: refreshMode ? `${id}: evidence refreshed (status stays ${req.status})` : `${id}: ${req.status} -> ${newStatus}`,
  at: new Date().toISOString(),
  summary: summary ?? null, reason: reason ?? null, evidence: [...new Set(evidenceEntries)],
  by: "closure-set-status.mjs",
};
console.log(JSON.stringify(log, null, 2));
console.log(`CHANGE_LOG ${JSON.stringify({ id, from: req.status, to: targetStatus, refresh: !!refreshMode, reason: reason ?? null })}`);
