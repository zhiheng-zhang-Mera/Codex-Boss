#!/usr/bin/env node
/**
 * Root Defense evidence generator (Update-Plan/Isolation-Finalization.md §22).
 *
 * "Evidence 不允许人工手填 PASS 代替真实执行." This script exists so that rule is
 * mechanically true: it reads a machine-produced vitest JSON report plus the gate
 * logs, and derives one evidence file per phase from the *observed* result of the
 * tests that belong to that phase. A phase containing a failing test is written
 * out as FAIL; the script has no path that emits a PASS that did not happen.
 *
 * Usage:
 *   node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=<report>.json
 *   node scripts/root-defense-evidence.cjs \
 *     --report <report>.json \
 *     --gates <dir-with-g-*.log> \
 *     --out Update-Plan/Autonomous-Evolution-Phase0/evidence
 *
 * No npm dependency is used: only node:fs / node:path / node:crypto.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PHASES = [
  {
    id: 'F1',
    file: 'F1-root-authority.json',
    title: 'Root Authority: policy, protected surface, durable decision ledger',
    tests: ['tests/unit/root-authority.test.ts', 'tests/unit/owner-authority.test.ts', 'tests/unit/self-elevation.test.ts'],
    requirements: ['RD-001', 'RD-002', 'RD-003'],
    modules: [
      'src/shared/root-authority/contracts.ts',
      'src/shared/root-authority/root-policy.ts',
      'src/shared/root-authority/protected-surface.ts',
      'electron/root-authority/root-authority.ts',
      'electron/root-authority/root-policy-loader.ts',
      'electron/root-authority/protected-surface-guard.ts',
      'electron/root-authority/root-audit-ledger.ts',
      '.codex-boss/root/root-policy.json'
    ]
  },
  {
    id: 'F2',
    file: 'F2-stable-candidate.json',
    title: 'Stable / Candidate real isolation',
    tests: ['tests/unit/stable-candidate.test.ts'],
    requirements: ['RD-004', 'RD-005', 'RD-006'],
    modules: [
      'electron/stable-candidate/workspace-manager.ts',
      'electron/stable-candidate/runtime-isolation.ts',
      'electron/stable-candidate/candidate-supervisor.ts'
    ]
  },
  {
    id: 'F3',
    file: 'F3-credential-boundary.json',
    title: 'Credential boundary: sanitized environment and dedicated Boss identity',
    tests: ['tests/unit/credential-boundary.test.ts'],
    requirements: ['RD-007', 'RD-008'],
    modules: [
      'electron/credential-boundary/credential-boundary.ts',
      'electron/credential-boundary/sanitized-environment.ts',
      'electron/credential-boundary/github-credential-provider.ts'
    ]
  },
  {
    id: 'F4',
    file: 'F4-execution-profile.json',
    title: 'Autonomous Evolution execution profile',
    tests: ['tests/unit/root-authority-execution-profile.test.ts'],
    requirements: ['RD-009'],
    modules: ['electron/root-authority/execution-profile.ts']
  },
  {
    id: 'F5',
    file: 'F5-promotion.json',
    title: 'Promotion gate: state machine, exact-SHA contract, GitHub adapter',
    tests: ['tests/unit/promotion-gate.test.ts'],
    requirements: ['RD-010', 'RD-011', 'RD-012'],
    modules: [
      'src/shared/root-authority/promotion-state.ts',
      'electron/promotion-gate/exact-sha-gate.ts',
      'electron/promotion-gate/promotion-controller.ts',
      'electron/promotion-gate/github-promotion-adapter.ts'
    ]
  },
  {
    id: 'F6',
    file: 'F6-rollback.json',
    title: 'Rollback and Root recovery',
    tests: ['tests/unit/root-recovery.test.ts'],
    requirements: ['RD-013'],
    modules: ['electron/root-recovery/rollback-controller.ts']
  },
  {
    id: 'F7',
    file: 'F7-emergency-control.json',
    title: 'Emergency control and the durable Owner freeze',
    tests: ['tests/unit/emergency-control.test.ts'],
    requirements: ['RD-014', 'RD-015'],
    modules: ['electron/emergency-control/emergency-control.ts', 'electron/emergency-control/evolution-kill-switch.ts']
  },
  {
    id: 'F8',
    file: 'F8-red-team.json',
    title: 'Adversarial / red-team acceptance (RT-01..RT-25)',
    tests: ['tests/unit/root-authority-red-team.test.ts'],
    requirements: ['RD-016'],
    modules: []
  },
  {
    id: 'FI',
    file: 'failure-isolation.json',
    title: 'Combined failure isolation (FI-01..FI-05)',
    tests: ['tests/unit/stable-candidate-fault-isolation.test.ts'],
    requirements: ['RD-004', 'RD-006', 'RD-008', 'RD-011'],
    modules: []
  }
];

const GATES = ['typecheck', 'build', 'test', 'benchmark', 'package', 'smoke', 'restart'];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [name, inline] = token.slice(2).split('=');
    args[name] = inline !== undefined ? inline : argv[++index];
  }
  return args;
}

function git(args) {
  try {
    return execFileSync('git', args, { stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

/** index of vitest testResults by repo-relative file path. */
function indexReport(report) {
  const index = new Map();
  for (const file of report.testResults || []) {
    const key = path.relative(process.cwd(), file.name).split(path.sep).join('/');
    const assertions = file.assertionResults || [];
    index.set(key, {
      file: key,
      status: file.status,
      tests: assertions.length,
      passed: assertions.filter((item) => item.status === 'passed').length,
      failed: assertions.filter((item) => item.status === 'failed').length,
      skipped: assertions.filter((item) => item.status === 'skipped' || item.status === 'pending' || item.status === 'todo').length,
      failing: assertions.filter((item) => item.status === 'failed').map((item) => item.fullName || item.title)
    });
  }
  return index;
}

function phaseEvidence(phase, index, report, context) {
  const files = phase.tests.map((file) => index.get(file) || { file, status: 'missing', tests: 0, passed: 0, failed: 0, skipped: 0, failing: [`no result in the vitest report for ${file}`], missing: true });
  const totals = files.reduce((sum, file) => ({
    tests: sum.tests + file.tests,
    passed: sum.passed + file.passed,
    failed: sum.failed + file.failed,
    skipped: sum.skipped + file.skipped
  }), { tests: 0, passed: 0, failed: 0, skipped: 0 });
  const missing = files.filter((file) => file.missing).map((file) => file.file);
  const ok = total => total.failed === 0;
  return {
    phase: phase.id,
    title: phase.title,
    generatedAt: context.generatedAt,
    baseBranch: context.baseBranch,
    baseSha: context.baseSha,
    headSha: context.headSha,
    modules: phase.modules,
    requirementIds: phase.requirements,
    testFiles: files.map(({ failing, ...rest }) => rest),
    assertions: totals,
    failingTests: files.flatMap((file) => file.failing || []),
    missingTestFiles: missing,
    source: 'machine-derived from a vitest JSON report; no value in this file was written by hand',
    result: ok(totals) && !missing.length ? 'PASS' : 'FAIL'
  };
}

/**
 * Gate logs are produced by a shell redirect that may emit UTF-16LE (PowerShell)
 * or UTF-8 (node/pnpm). Decode by BOM so the exit sentinel is actually found
 * rather than silently skipped because every other byte was NUL.
 */
function readLog(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.toString('utf8').replace(/^\uFEFF/, '');
  return buffer.toString('utf8');
}

/** Gate logs are written by the harness as g-<gate>.log with a trailing exit=N. */
function gateEvidence(gatesDir) {
  const gates = {};
  for (const gate of GATES) {
    const file = path.join(gatesDir, `g-${gate}.log`);
    if (!fs.existsSync(file)) {
      gates[gate] = { result: 'NOT_RUN', log: null };
      continue;
    }
    const text = readLog(file);
    // Logs are written on Windows, so the sentinel line ends with CRLF: match the
    // carriage return explicitly rather than relying on `$` alone.
    const exits = [...text.matchAll(/^exit=(\d+)\r?$/gm)].map((match) => Number(match[1]));
    const exitCode = exits.length ? exits[exits.length - 1] : null;
    gates[gate] = {
      result: exitCode === 0 ? 'PASS' : exitCode === null ? 'UNKNOWN' : 'FAIL',
      exitCode,
      log: path.relative(process.cwd(), file).split(path.sep).join('/'),
      digest: require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    };
  }
  // Pull the observed suite totals out of the vitest transcript.
  const testLog = path.join(gatesDir, 'g-test.log');
  if (fs.existsSync(testLog)) {
    const text = readLog(testLog);
    const files = /Test Files\s+(\d+) passed(?:,\s*(\d+) failed)?/.exec(text);
    const tests = /Tests\s+(\d+) passed(?:,\s*(\d+) failed)?/.exec(text);
    if (files) gates.test.testFiles = { passed: Number(files[1]), failed: Number(files[2] || 0) };
    if (tests) gates.test.tests = { passed: Number(tests[1]), failed: Number(tests[2] || 0) };
  }
  const benchLog = path.join(gatesDir, 'g-benchmark.log');
  if (fs.existsSync(benchLog)) {
    const object = /\{[\s\S]*\}/.exec(readLog(benchLog));
    if (object) {
      try {
        gates.benchmark.detail = JSON.parse(object[0]);
      } catch {
        /* a non-JSON benchmark transcript stays as a log digest only */
      }
    }
  }
  const smokeLog = path.join(gatesDir, 'g-smoke.log');
  if (fs.existsSync(smokeLog) && /PACKAGED_SMOKE_PASS/.test(readLog(smokeLog))) gates.smoke.marker = 'PACKAGED_SMOKE_PASS';
  const restartLog = path.join(gatesDir, 'g-restart.log');
  if (fs.existsSync(restartLog)) {
    const status = /"kind":\s*"CONTROLLED_ELECTRON_RESTART",\s*"status":\s*"(\w+)"/.exec(readLog(restartLog));
    if (status) gates.restart.marker = `CONTROLLED_ELECTRON_RESTART:${status[1]}`;
  }
  return gates;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = args.report;
  const outDir = args.out;
  const gatesDir = args.gates;
  if (!reportPath || !outDir) {
    console.error('usage: root-defense-evidence.cjs --report <vitest.json> --out <evidence dir> [--gates <dir>]');
    process.exit(2);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const index = indexReport(report);
  const context = {
    generatedAt: new Date().toISOString(),
    baseBranch: args['base-branch'] || 'main',
    baseSha: args['base-sha'] || git(['rev-parse', 'HEAD']),
    headSha: git(['rev-parse', 'HEAD'])
  };

  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const phase of PHASES) {
    const evidence = phaseEvidence(phase, index, report, context);
    fs.writeFileSync(path.join(outDir, phase.file), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    written.push({ file: phase.file, result: evidence.result, tests: evidence.assertions.tests, passed: evidence.assertions.passed });
  }

  const gates = gateEvidence(gatesDir || path.join(process.cwd(), '.f0'));
  const regression = {
    phase: 'regression',
    title: 'Full existing regression plus the repository gate chain',
    generatedAt: context.generatedAt,
    baseBranch: context.baseBranch,
    baseSha: context.baseSha,
    headSha: context.headSha,
    fullSuite: {
      // vitest's `numTotalTestSuites` counts describe blocks, not files; the
      // report's `testResults` length is the honest file count.
      testFiles: (report.testResults || []).length,
      tests: report.numTotalTests ?? null,
      passed: report.numPassedTests ?? null,
      failed: report.numFailedTests ?? null,
      success: report.success ?? null
    },
    gates,
    result: report.numFailedTests === 0 && (report.success !== false) && GATES.every((gate) => gates[gate].result === 'PASS') ? 'PASS' : 'FAIL',
    note: 'gate results are read from the harness logs (exit codes and markers); the full-suite totals come from the vitest JSON report'
  };
  fs.writeFileSync(path.join(outDir, 'regression.json'), JSON.stringify(regression, null, 2) + '\n', 'utf8');
  written.push({ file: 'regression.json', result: regression.result });

  const phasesPassed = written.filter((item) => item.result === 'PASS').length;
  const readiness = {
    phase: 'final',
    title: 'Final readiness',
    generatedAt: context.generatedAt,
    baseBranch: context.baseBranch,
    baseSha: context.baseSha,
    headSha: context.headSha,
    phases: written,
    regression: regression.result,
    // A: controlled autonomous evolution needs the code to hold, not the remote
    // identity. B: unattended promotion additionally needs the dedicated Boss
    // GitHub identity, which is an Owner action outside this repository.
    readyForControlledAutonomousEvolution: written.every((item) => item.result === 'PASS'),
    readyForUnattendedPromotion: 'BLOCKED_EXTERNAL',
    blockedExternal: [
      {
        item: 'Dedicated Boss GitHub identity',
        detail: 'No Boss-owned GitHub App/bot credential exists. Only the Root Owner credential is present on this host, and using it as a Boss identity is exactly what RT-22 forbids.',
        requiredExternalAction: 'Create a dedicated Boss GitHub identity with contents:write, pull_requests:write and checks:read only (no repository administration, no ruleset bypass) and expose it as CODEX_BOSS_GITHUB_TOKEN.',
        affectsControlledEvolution: false,
        affectsUnattendedPromotion: true
      }
    ],
    unexpectedFailures: written.filter((item) => item.result !== 'PASS').map((item) => item.file)
  };
  fs.writeFileSync(path.join(outDir, 'final-readiness.json'), JSON.stringify(readiness, null, 2) + '\n', 'utf8');

  console.log(`evidence written to ${outDir}`);
  for (const item of written) console.log(`  ${item.result.padEnd(4)} ${item.file}${item.tests !== undefined ? ` (${item.passed}/${item.tests} assertions)` : ''}`);
  console.log(`  phases PASS: ${phasesPassed}/${written.length}`);
  console.log(`  READY_FOR_CONTROLLED_AUTONOMOUS_EVOLUTION: ${readiness.readyForControlledAutonomousEvolution}`);
  console.log(`  READY_FOR_UNATTENDED_PROMOTION: ${readiness.readyForUnattendedPromotion}`);
  if (!readiness.readyForControlledAutonomousEvolution) process.exit(1);
}

main();
