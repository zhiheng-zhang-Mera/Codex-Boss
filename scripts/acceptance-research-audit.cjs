#!/usr/bin/env node
/**
 * Research run acceptance audit (plan 9-6 Final Acceptance I + J).
 *
 * Verifies one research run's artifact tree deterministically:
 *
 *   I. Research integrity
 *      - research-ir.json + protocol.json snapshots exist and the IR protocolHash
 *        matches protocol.json.protocolHash (round 24 snapshots)
 *      - audit/final-audit.json passed (sections REVISED + citations ok)
 *      - audit/reproducibility.json status === "REPRODUCED" (round 12)
 *      - audit/citations.json ok (no UNSUPPORTED/CONTRADICTED bound)
 *      - paper sentences traceable: evidence graph has claim + paper nodes when
 *        the run recorded experiments (rounds 22/28/31)
 *
 *   J. Artifact
 *      - manuscript/paper.md, paper.tex, references.bib present
 *      - manuscript/figures/ has >= 1 figure when figures were supplied
 *      - paper.md references the figures that exist on disk
 *
 * Usage:
 *   node scripts/acceptance-research-audit.cjs <researchRoot> <researchId> [outputPath]
 *
 * `<researchRoot>` is the root that holds `research/<id>/` (e.g. the ResearchService
 * root or `userData/.boss`). Exits 0 when the run passes all checks, 1 otherwise.
 */

const fs = require('node:fs');
const path = require('node:path');

const rootArg = path.resolve(process.argv[2] || '.');
const researchId = process.argv[3];
if (!researchId) {
  console.error('Usage: node scripts/acceptance-research-audit.cjs <researchRoot> <researchId> [outputPath]');
  process.exit(2);
}
const outputPath = process.argv[4] ? path.resolve(process.argv[4]) : path.join(rootArg, 'artifacts', `research-audit-${researchId}.json`);

const runDir = path.join(rootArg, researchId);
const safeRead = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function check(name, ok, detail = '') {
  return { name, ok: Boolean(ok), detail: String(detail || '') };
}

const checks = [];
const ir = safeRead(path.join(runDir, 'research-ir.json'));
const protocol = safeRead(path.join(runDir, 'protocol.json'));
const finalAudit = safeRead(path.join(runDir, 'audit', 'final-audit.json'));
const reproducibility = safeRead(path.join(runDir, 'audit', 'reproducibility.json'));
const citations = safeRead(path.join(runDir, 'audit', 'citations.json'));
const evidence = safeRead(path.join(path.join(rootArg, 'evidence', researchId), 'evidence-graph.json'));

// I. snapshots + freeze binding.
checks.push(check('I1-ir-snapshot', ir && typeof ir.id === 'string' && ir.id === researchId, ir ? `state=${ir.state}` : 'missing research-ir.json'));
checks.push(check('I2-protocol-snapshot', protocol && ir && ir.protocolHash && protocol.protocolHash === ir.protocolHash, protocol && ir ? `hash=${ir.protocolHash}` : 'protocol hash mismatch or missing'));
checks.push(check('I3-final-audit', finalAudit && finalAudit.passed === true, finalAudit ? `passed=${finalAudit.passed} reproducibility=${finalAudit.reproducibility ?? 'n/a'}` : 'missing final-audit.json'));
checks.push(check('I4-reproduced', reproducibility && reproducibility.status === 'REPRODUCED', reproducibility ? `status=${reproducibility.status}` : 'missing reproducibility.json'));

// Citations.json is PENDING when no citations were recorded; only fail when a
// real audit exists and is not ok.
if (citations && citations.ok === false) {
  checks.push(check('I5-citations', false, 'unsupported/contradicted citations bound'));
} else {
  checks.push(check('I5-citations', true, citations ? `ok=${citations.ok ?? 'n/a'} verified=${citations.verified ?? 0}` : 'no citations recorded (PENDING ok)'));
}

// I. claims traceable to evidence — when experiments were recorded the graph
// must carry claim + paper-sentence nodes (rounds 22/28/31).
const hasRuns = evidence && Array.isArray(evidence.nodes) && evidence.nodes.some((node) => node.kind === 'run');
if (hasRuns) {
  checks.push(check('I6-claim-nodes', evidence.nodes.some((node) => node.kind === 'claim'), 'claims recorded by the analyzer'));
  checks.push(check('I7-paper-nodes', evidence.nodes.some((node) => node.kind === 'paper-sentence'), 'paper sentences recorded (round 28)'));
} else {
  checks.push(check('I6-claim-nodes', true, 'no runs recorded yet (live experiment pending)'));
  checks.push(check('I7-paper-nodes', true, 'no runs recorded yet (live experiment pending)'));
}

// J. artifact files.
checks.push(check('J1-paper-md', fs.existsSync(path.join(runDir, 'manuscript', 'paper.md'))));
checks.push(check('J2-paper-tex', fs.existsSync(path.join(runDir, 'manuscript', 'paper.tex'))));
checks.push(check('J3-references-bib', fs.existsSync(path.join(runDir, 'manuscript', 'references.bib'))));

const figuresDir = path.join(runDir, 'manuscript', 'figures');
const figureFiles = fs.existsSync(figuresDir) ? fs.readdirSync(figuresDir).filter((name) => /\.(svg|png|pdf|jpg)$/i.test(name)) : [];
const paperMd = fs.existsSync(path.join(runDir, 'manuscript', 'paper.md')) ? fs.readFileSync(path.join(runDir, 'manuscript', 'paper.md'), 'utf8') : '';
checks.push(check('J4-figures-dir', figureFiles.length >= 1, `${figureFiles.length} figure file(s)`));
checks.push(check('J5-figures-embedded', figureFiles.every((figure) => paperMd.includes(`figures/${figure}`)), 'paper.md references every figure file'));

const report = {
  schema: 'codex-boss/research-acceptance-audit/v1',
  researchId,
  status: checks.every((item) => item.ok) ? 'PASS' : 'FAIL',
  generatedAt: new Date().toISOString(),
  checks,
  note: 'Live items (web-AI reviewer evidence, real experiment metrics, paper.pdf via LaTeX) must be recorded by the GUI session; this audit verifies the deterministic artifact tree + integrity flags only.'
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
