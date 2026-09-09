#!/usr/bin/env node
/**
 * Live acceptance report (milestone §33/§36). Reads one research run from the
 * Boss runtime-data tree (the ResearchService composition root layout) and
 * prints a human/agent-readable acceptance summary:
 *   - run identity/state/goal and the last recorded decision (why it stopped)
 *   - protocol frozen hash + snapshot binding
 *   - real recorded runs (count, distinct seeds, all bound to the hash)
 *   - manuscript + audit artifacts (paper.tex/.pdf, compile/repro/citations/
 *     final-audit)
 *   - acceptance metrics; manual-click counters are NOT machine-observable —
 *     the normal path is Start-once by construction, reported by the operator.
 *
 * Usage:
 *   node scripts/live-acceptance-report.cjs <researchId> [rootDir]
 * `<rootDir>` defaults to runtime-data/.boss/research next to this repo.
 * Exit 0 when the run is READY and the final audit passed, 1 otherwise.
 */
const fs = require('node:fs');
const path = require('node:path');

const researchId = process.argv[2];
if (!researchId) { console.error('Usage: node scripts/live-acceptance-report.cjs <researchId> [rootDir]'); process.exit(2); }
const repoRoot = path.resolve(__dirname, '..');
const rootArg = path.resolve(process.argv[3] || path.join(repoRoot, 'runtime-data', '.boss', 'research'));

const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const ok = (b) => (b ? 'PASS' : 'FAIL');

const ledger = read(path.join(rootArg, `${researchId}.json`));
if (!ledger) { console.error(`No research run ${researchId} under ${rootArg}`); process.exit(2); }
const ir = ledger.ir;
const last = ledger.decisions[ledger.decisions.length - 1];
const protocol = read(path.join(rootArg, researchId, 'protocol.json'));
const finalAudit = read(path.join(rootArg, researchId, 'audit', 'final-audit.json'));
const compile = read(path.join(rootArg, researchId, 'audit', 'compile.json'));
const repro = read(path.join(rootArg, researchId, 'audit', 'reproducibility.json'));
const citationAuditFile = read(path.join(rootArg, researchId, 'audit', 'citations.json'));
const evidenceDir = path.join(rootArg, 'evidence', researchId);
const runs = fs.existsSync(evidenceDir)
  ? fs.readdirSync(evidenceDir).filter((n) => n.startsWith('run-') && n.endsWith('.json')).map((n) => read(path.join(evidenceDir, n))).filter(Boolean)
  : [];
const manuscriptDir = path.join(rootArg, researchId, 'manuscript');
const artifactDir = path.join(rootArg, researchId, 'artifacts');
const artifacts = fs.existsSync(artifactDir) ? fs.readdirSync(artifactDir).filter((n) => n.endsWith('.json')).sort() : [];

const states = [];
const pdf = path.join(manuscriptDir, 'paper.pdf');
const tex = path.join(manuscriptDir, 'paper.tex');
states.push(['state-ready', ir.state === 'READY']);
states.push(['rq-anchored-immutable', ir.researchQuestions[0] && ir.researchQuestions[0] === ir.goal]);
states.push(['protocol-frozen', Boolean(ir.protocolHash && protocol && protocol.protocolHash === ir.protocolHash)]);
states.push(['real-recorded-runs', runs.length >= 2 && new Set(runs.map((r) => r.seed)).size >= 2 && runs.every((r) => r.protocolHash === ir.protocolHash)]);
states.push(['paper-tex', fs.existsSync(tex)]);
states.push(['paper-pdf', fs.existsSync(pdf) && fs.statSync(pdf).size > 0]);
states.push(['compile-pass', compile && compile.status === 'PASS']);
states.push(['reproduced', repro && repro.status === 'REPRODUCED']);
states.push(['citations-ok', !citationAuditFile || citationAuditFile.ok !== false]);
states.push(['final-audit-passed', finalAudit && finalAudit.passed === true]);
const ready = states.filter(([_, pass]) => pass).length;
const total = states.length;
const passed = ir.state === 'READY' && finalAudit?.passed === true && states.every(([, pass]) => pass === true);

const report = {
  schema: 'codex-boss/live-acceptance-report/v1',
  researchId,
  state: ir.state,
  goal: ir.goal.slice(0, 200),
  decidedAt: last ? { step: last.stepId, decision: last.decision, reason: last.reason.slice(0, 400) } : null,
  checks: states.map(([name, pass]) => ({ name, ok: Boolean(pass) })),
  summary: `${ready}/${total} acceptance checks ok`,
  artifacts: { count: artifacts.length, names: artifacts },
  details: {
    protocolHash: ir.protocolHash ?? null,
    runs: runs.length,
    distinctSeeds: runs.length ? new Set(runs.map((r) => r.seed)).size : 0,
    compile: compile ? { status: compile.status, engine: compile.engine, pdf: compile.pdf } : null,
    reproducibility: repro ? { status: repro.status, runsAnalyzed: repro.runsAnalyzed, distinctSeeds: repro.distinctSeeds } : null,
    finalAudit: finalAudit ? { passed: finalAudit.passed } : null
  },
  notes: {
    manualStepClicks: 'not machine-observable; normal path is Start-once (no Step/Resume) by design',
    manualResumeClicks: 'not machine-observable; WAITING_FOR_PROVIDER auto-recovery + Start-once by design'
  },
  acceptance: passed ? 'PASS' : 'FAIL'
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = passed ? 0 : 1;
