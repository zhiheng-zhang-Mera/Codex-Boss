#!/usr/bin/env node
/**
 * Self Diagnosis — what might be wrong, as a runnable answer.
 *
 * It builds the self model from the repository's own facts, reads the observations the application
 * already recorded under the data root, and prints a ranked diagnosis with a plan and advisory
 * treatments. It writes nothing except the JSON file a caller asks for with `--out`, and it has no
 * flag that changes anything.
 *
 *   node scripts/self-diagnosis.cjs                    diagnose against the default data root
 *   node scripts/self-diagnosis.cjs --data-root <dir>   diagnose against another data root
 *   node scripts/self-diagnosis.cjs --summary           the verdict without the evidence
 *   node scripts/self-diagnosis.cjs --json --out <file> the raw report beside the summary
 *
 * Run `pnpm run build:electron` first: the CLI loads the compiled modules.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function load(relative) {
  const file = path.join(ROOT, "dist-electron", ...relative.split("/"));
  if (!fs.existsSync(file)) {
    process.stderr.write(`the compiled self-diagnosis modules are missing at ${path.relative(ROOT, file)}; run \`pnpm run build:electron\` first\n`);
    process.exitCode = 1;
    return undefined;
  }
  return require(file);
}

function parseArgs(argv) {
  const options = { dataRoot: path.join(ROOT, "runtime-data"), summary: false, json: false, out: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--data-root") options.dataRoot = path.resolve(argv[++index] ?? "");
    else if (argument === "--root") options.root = path.resolve(argv[++index] ?? "");
    else if (argument === "--summary") options.summary = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--out") options.out = path.resolve(argv[++index] ?? "");
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write("usage: node scripts/self-diagnosis.cjs [--data-root <dir>] [--root <dir>] [--summary] [--json] [--out <file>]\n");
      process.exit(0);
    } else {
      process.stderr.write(`unknown argument ${argument}\n`);
      process.exitCode = 1;
      return undefined;
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options) {
  const factsModule = load("electron/self-cognition/facts.js");
  const anatomyModule = load("src/shared/self-cognition/anatomy.js");
  const sourcesModule = load("electron/self-diagnosis/sources.js");
  const engineModule = load("src/shared/self-diagnosis/engine.js");
  if (factsModule && anatomyModule && sourcesModule && engineModule) {
    const model = anatomyModule.buildSelfModel(factsModule.collectSelfFacts({ repositoryRoot: options.root ?? ROOT }));
    const sources = sourcesModule.hostObservationSources({
      dataRoot: options.dataRoot,
      componentForRuntime: (runtimeId) => {
        const owner = model.components.find((component) => component.id === runtimeId || component.name === runtimeId);
        return owner === undefined ? undefined : owner.id;
      }
    });
    const report = engineModule.diagnose({ model, sources, at: new Date().toISOString() });

    const summary = {
      at: report.at,
      observations: report.observations,
      unhealthyObservations: report.unhealthyObservations,
      symptoms: report.symptoms.map((symptom) => ({ kind: symptom.kind, componentId: symptom.componentId, signalId: symptom.signalId, severity: symptom.severity, confidence: symptom.confidence })),
      spread: report.spread,
      hypotheses: report.hypotheses.map((hypothesis) => ({ hypothesisId: hypothesis.hypothesisId, suspectedComponent: hypothesis.suspectedComponent, failureMode: hypothesis.failureMode, role: hypothesis.role, confidence: hypothesis.confidence, blastRadius: hypothesis.blastRadius })),
      plan: report.plan.steps.map((step) => ({ action: step.action, target: step.target, priority: step.priority })),
      blockedBy: report.plan.blockedBy,
      treatments: report.treatments.map((proposal) => ({ treatment: proposal.treatment, targetComponent: proposal.targetComponent, risk: proposal.risk, requiredAuthority: proposal.requiredAuthority, reversible: proposal.reversible, executable: proposal.executable })),
      authority: report.authority,
      unreadable: report.unreadable,
      sourceFailures: report.sourceFailures,
      notes: report.notes
    };

    const text = `${JSON.stringify(options.summary ? summary : options.json ? { report, summary } : report, null, 2)}\n`;
    process.stdout.write(text);
    if (options.out) {
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.writeFileSync(options.out, text, "utf8");
    }
  }
}
