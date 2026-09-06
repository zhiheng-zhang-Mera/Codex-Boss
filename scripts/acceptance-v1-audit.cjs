const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.resolve(process.argv[2] || path.join(projectRoot, 'artifacts', 'v1-acceptance-manifest.json'));
const outputPath = path.resolve(process.argv[3] || path.join(projectRoot, 'artifacts', 'v1-acceptance-audit.json'));

function projectFile(candidate) {
  const resolved = path.resolve(projectRoot, candidate);
  if (resolved !== projectRoot && !resolved.startsWith(projectRoot + path.sep)) throw new Error(`Evidence must stay inside the project: ${candidate}`);
  return resolved;
}

function valueAt(source, selector) {
  return selector.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], source);
}

function assertionPass(value, assertion) {
  if (Object.prototype.hasOwnProperty.call(assertion, 'equals')) return JSON.stringify(value) === JSON.stringify(assertion.equals);
  if (Object.prototype.hasOwnProperty.call(assertion, 'includes')) return Array.isArray(value) ? value.includes(assertion.includes) : String(value ?? '').includes(String(assertion.includes));
  if (Object.prototype.hasOwnProperty.call(assertion, 'atLeast')) return typeof value === 'number' && value >= assertion.atLeast;
  if (Object.prototype.hasOwnProperty.call(assertion, 'atMost')) return typeof value === 'number' && value <= assertion.atMost;
  if (assertion.exists === true) return value !== undefined && value !== null;
  if (assertion.truthy === true) return Boolean(value);
  throw new Error(`Unsupported assertion for ${assertion.path}`);
}

function evaluate(item) {
  const evidencePath = projectFile(item.evidence);
  const source = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const assertions = item.assertions.map((assertion) => {
    const actual = valueAt(source, assertion.path);
    return { ...assertion, actual, passed: assertionPass(actual, assertion) };
  });
  return { id: item.id, category: item.category, evidence: evidencePath, passed: assertions.every((entry) => entry.passed), assertions };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== 1) throw new Error(`Unsupported V1 acceptance manifest: ${manifest.version}`);
const cases = manifest.cases.map(evaluate);
const gates = manifest.gates.map(evaluate);
const categories = {};
for (const [category, policy] of Object.entries(manifest.completionTargets)) {
  const matches = cases.filter((item) => item.category === category);
  const passed = matches.filter((item) => item.passed).length;
  const observedPercent = matches.length ? (passed / matches.length) * 100 : null;
  categories[category] = {
    passed,
    cases: matches.length,
    observedPercent,
    targetPercent: policy.targetPercent,
    minimumCases: policy.minimumCases,
    sampleRequirementMet: matches.length >= policy.minimumCases,
    targetMet: observedPercent !== null && observedPercent >= policy.targetPercent && matches.length >= policy.minimumCases
  };
}
const allCasesPass = cases.every((item) => item.passed);
const allGatesPass = gates.every((item) => item.passed);
const allTargetsMet = Object.values(categories).every((item) => item.targetMet);
const report = {
  schema: 'codex-boss/v1-acceptance-audit/v1',
  status: allCasesPass && allGatesPass && allTargetsMet ? 'PASS' : 'FAIL',
  scope: manifest.scope,
  generatedAt: new Date().toISOString(),
  completion: categories,
  cases,
  gates,
  populationClaim: 'NOT_ESTABLISHED',
  limitations: manifest.limitations
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
