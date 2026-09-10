#!/usr/bin/env node
/**
 * Host-A Phase K: final full regression + evidence hashes.
 *
 * Runs, in order:
 *   typecheck (renderer+shared, electron)
 *   full unit suite (vitest run)
 *   full build (vite renderer + tsc electron emit)
 *   R-202 evidence validator
 *   R-901 evidence validator
 *   manifest validator
 *   acceptance report validator
 *
 * Writes Update-Plan/2026-09-09-closure/evidence/final-regression.json with
 * gitHead, test files, test count, build result, evidence hashes, manifest hash.
 *
 * Usage: node scripts/closure-final-regression.mjs [--validators-only]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  evaluateTerminal,
  evidenceIntegrityForPass,
  validateBlockerEvidenceShape,
  validateManifestSchema,
  validateR202Evidence,
  validateR901Evidence,
} from "./closure-terminal-logic.mjs";

const dir = path.join("Update-Plan", "2026-09-09-closure");
const manifestPath = path.join(dir, "requirement-manifest.json");
const evidenceDir = path.join(dir, "evidence");
const validatorsOnly = process.argv.includes("--validators-only");
const outIndex = process.argv.indexOf("--out");
const outFile = outIndex >= 0 && process.argv[outIndex + 1]
  ? path.resolve(process.argv[outIndex + 1])
  : path.join(evidenceDir, "final-regression.json");

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function gitHead() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}
function run(cmd, args) {
  const started = Date.now();
  const res = spawnSync(cmd, args, { encoding: "utf8", cwd: path.resolve("."), maxBuffer: 64 * 1024 * 1024 });
  return { status: res.status ?? 1, durationMs: Date.now() - started, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const nodeBin = process.execPath;

// ---------- gates ----------
const gates = {};
if (!validatorsOnly) {
  const tc1 = run(nodeBin, [path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", "tsconfig.json"]);
  gates.typecheck = { status: tc1.status === 0 ? "PASS" : "FAIL", durationMs: tc1.durationMs, stderr: tc1.status === 0 ? undefined : tc1.stderr.slice(-1500) };
  const tc2 = run(nodeBin, [path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", "tsconfig.electron.json"]);
  gates.typecheck_electron = { status: tc2.status === 0 ? "PASS" : "FAIL", durationMs: tc2.durationMs, stderr: tc2.status === 0 ? undefined : tc2.stderr.slice(-1500) };

  const vitest = run(nodeBin, [path.join("node_modules", "vitest", "vitest.mjs"), "run"]);
  const vitestTail = vitest.stdout.split("\n").slice(-12).join("\n");
  const filesMatch = vitest.stdout.match(/Test Files\s+(\d+) passed/);
  const testsMatch = vitest.stdout.match(/Tests\s+(\d+) passed/);
  gates.unit = {
    status: vitest.status === 0 ? "PASS" : "FAIL",
    durationMs: vitest.durationMs,
    testFiles: filesMatch ? Number(filesMatch[1]) : null,
    testCount: testsMatch ? Number(testsMatch[1]) : null,
    tail: vitestTail,
  };

  const vite = run(nodeBin, [path.join("node_modules", "vite", "bin", "vite.js"), "build"]);
  const emit = run(nodeBin, [path.join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.electron.json"]);
  gates.build = {
    status: vite.status === 0 && emit.status === 0 ? "PASS" : "FAIL",
    renderer: vite.status === 0 ? "PASS" : "FAIL",
    electronEmit: emit.status === 0 ? "PASS" : "FAIL",
    durationMs: vite.durationMs + emit.durationMs,
    stderr: vite.status === 0 && emit.status === 0 ? undefined : `${vite.stderr.slice(-800)} ${emit.stderr.slice(-800)}`,
  };
} else {
  gates.skipped = "validators-only";
}

// ---------- validators ----------
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
const schemaErrors = validateManifestSchema(manifest);
const io = {
  roots: [path.resolve(evidenceDir), path.resolve(dir), path.resolve(".")],
  existsSync: (p) => fs.existsSync(p),
  resolve: (root, p) => (path.isAbsolute(p) ? p : path.resolve(root, p)),
};
const evidenceOk = {};
const blockerEvidenceOk = {};
const evidenceProblems = {};
for (const req of manifest.requirements) {
  if (req.status === "PASS") {
    const r = evidenceIntegrityForPass(req, io);
    evidenceOk[req.id] = r.ok;
    if (!r.ok) evidenceProblems[req.id] = r.reasons;
  } else if (req.status === "LOCKED_PASS") {
    const ok = Array.isArray(req.evidence) && req.evidence.length > 0;
    evidenceOk[req.id] = ok;
    if (!ok) evidenceProblems[req.id] = ["LOCKED_PASS evidence array is empty"];
  } else if (req.status === "BLOCKED_EXTERNAL") {
    const files = (req.evidence ?? []).filter((e) => typeof e === "string" && /\.json$/.test(e.trim()));
    const shapeOk = files.some((f) => {
      const cand = io.roots.map((r) => io.resolve(r, f)).find((p) => fs.existsSync(p));
      if (!cand) return false;
      try { return validateBlockerEvidenceShape(JSON.parse(fs.readFileSync(cand, "utf8").replace(/^\uFEFF/, ""))).ok; } catch { return false; }
    });
    blockerEvidenceOk[req.id] = shapeOk;
    if (!shapeOk) evidenceProblems[req.id] = ["missing legal structured BLOCKED_EXTERNAL evidence"];
  }
}
const verdict = evaluateTerminal({ requirements: manifest.requirements, evidenceOk, blockerEvidenceOk });

const r202 = manifest.requirements.find((r) => r.id === "R-202");
const r901 = manifest.requirements.find((r) => r.id === "R-901");
const r202Validator = (() => {
  const f = (r202?.evidence ?? []).find((e) => typeof e === "string" && /\.json$/.test(e.trim()));
  if (!f) return { ok: false, reasons: ["no R-202 evidence file referenced"] };
  const cand = io.roots.map((r) => io.resolve(r, f)).find((p) => fs.existsSync(p));
  if (!cand) return { ok: false, reasons: [`R-202 evidence missing: ${f}`] };
  try { return validateR202Evidence(JSON.parse(fs.readFileSync(cand, "utf8").replace(/^\uFEFF/, ""))); }
  catch (error) { return { ok: false, reasons: [String(error)] }; }
})();
const r901Validator = (() => {
  const f = (r901?.evidence ?? []).find((e) => typeof e === "string" && /r901-.+\.json$/.test(e.trim()));
  if (!f) return { ok: false, reasons: ["no R-901 evidence file referenced"] };
  const cand = io.roots.map((r) => io.resolve(r, f)).find((p) => fs.existsSync(p));
  if (!cand) return { ok: false, reasons: [`R-901 evidence missing: ${f}`] };
  try {
    const ev = JSON.parse(fs.readFileSync(cand, "utf8").replace(/^\uFEFF/, ""));
    const heartbeatFile = path.resolve(evidenceDir, `r901-${ev.runId}.heartbeat.jsonl`);
    const heartbeats = fs.existsSync(heartbeatFile)
      ? fs.readFileSync(heartbeatFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    return validateR901Evidence(ev, heartbeats, { formal: true });
  } catch (error) { return { ok: false, reasons: [String(error)] }; }
})();
const r1003 = (() => {
  const f = path.join(evidenceDir, "r1003-acceptance-report.json");
  if (!fs.existsSync(f)) return { ok: false, reasons: ["r1003-acceptance-report.json missing"] };
  try {
    const ev = JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
    const reasons = [];
    if (ev.requirement !== "R-1003") reasons.push("requirement must be R-1003");
    if (!ev.terminal) reasons.push("report must record the evaluated terminal");
    if (!fs.existsSync(path.join(dir, "ACCEPTANCE-MATRIX.md"))) reasons.push("ACCEPTANCE-MATRIX.md missing");
    if (!fs.existsSync(path.join(dir, "FINAL-ACCEPTANCE.md"))) reasons.push("FINAL-ACCEPTANCE.md missing");
    return { ok: reasons.length === 0, reasons };
  } catch (error) { return { ok: false, reasons: [String(error)] }; }
})();

// ---------- evidence hashes ----------
const evidenceFiles = fs.readdirSync(evidenceDir).filter((f) => f.endsWith(".json") || f.endsWith(".jsonl")).sort();
const evidenceHashes = {};
for (const f of evidenceFiles) evidenceHashes[f] = sha256File(path.join(evidenceDir, f));

const unitGate = gates.unit ?? {};
const report = {
  phase: "K",
  generatedAt: new Date().toISOString(),
  gitHead: gitHead(),
  gates,
  validators: {
    manifest: { ok: schemaErrors.length === 0, reasons: schemaErrors },
    r202: r202Validator,
    r901: r901Validator,
    acceptanceReport: r1003,
    terminal: { value: verdict.terminal, pending: verdict.pending, blockers: verdict.blockers, reasons: verdict.reasons },
    evidenceProblems,
  },
  testFiles: unitGate.testFiles ?? null,
  testCount: unitGate.testCount ?? null,
  buildResult: gates.build?.status ?? "unknown",
  manifestHash: sha256File(manifestPath),
  evidenceHashes,
  allGatesPass: !validatorsOnly
    ? Object.values(gates).every((g) => g.status === "PASS") && verdict.terminal !== "FAILED_TERMINAL"
    : undefined,
  terminal: verdict.terminal,
};
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({
  gitHead: report.gitHead, gates: Object.fromEntries(Object.entries(gates).map(([k, v]) => [k, v.status ?? v])),
  testFiles: report.testFiles, testCount: report.testCount, buildResult: report.buildResult,
  terminal: report.terminal, evidenceProblems: report.evidenceProblems,
  validators: { r202: r202Validator.ok, r901: r901Validator.ok, report: r1003.ok },
}, null, 2));
process.exit(0);
