#!/usr/bin/env node
/**
 * Case Record — the case log, as a runnable answer.
 *
 * It records and it reports. It can open a case from a self-diagnosis report, append an observation
 * or a validation, and resolve a case with a disposition. It cannot diagnose (it copies what the
 * diagnosis said) and it cannot treat anything (there is no flag for that).
 *
 *   node scripts/self-case-record.cjs --list
 *   node scripts/self-case-record.cjs --case <id>
 *   node scripts/self-case-record.cjs --candidates
 *   node scripts/self-case-record.cjs --from-diagnosis <report.json> [--case-id <id>]
 *   node scripts/self-case-record.cjs --resolve <id> --disposition RESOLVED --root-cause <component>
 *   node scripts/self-case-record.cjs --validate <id> --verdict CONFIRMED --evidence "..."
 *
 * Run `pnpm run build:electron` first: the CLI loads the compiled modules.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function load(relative) {
  const file = path.join(ROOT, "dist-electron", ...relative.split("/"));
  if (!fs.existsSync(file)) {
    process.stderr.write(`the compiled case-record modules are missing at ${path.relative(ROOT, file)}; run \`pnpm run build:electron\` first\n`);
    process.exitCode = 1;
    return undefined;
  }
  return require(file);
}

function parseArgs(argv) {
  const options = { command: "list", root: path.join(ROOT, "runtime-data", ".boss", "self-case-record"), target: undefined, json: false, out: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list") options.command = "list";
    else if (argument === "--candidates") options.command = "candidates";
    else if (argument === "--case") { options.command = "case"; options.target = argv[++index]; }
    else if (argument === "--from-diagnosis") { options.command = "from-diagnosis"; options.target = path.resolve(argv[++index] ?? ""); }
    else if (argument === "--case-id") options.caseId = argv[++index];
    else if (argument === "--resolve") { options.command = "resolve"; options.target = argv[++index]; }
    else if (argument === "--disposition") options.disposition = argv[++index];
    else if (argument === "--root-cause") options.rootCause = argv[++index];
    else if (argument === "--validate") { options.command = "validate"; options.target = argv[++index]; }
    else if (argument === "--verdict") options.verdict = argv[++index];
    else if (argument === "--evidence") options.evidence = argv[++index];
    else if (argument === "--root") options.root = path.resolve(argv[++index] ?? "");
    else if (argument === "--json") options.json = true;
    else if (argument === "--out") options.out = path.resolve(argv[++index] ?? "");
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write("usage: node scripts/self-case-record.cjs [--list|--candidates|--case <id>|--from-diagnosis <file>|--resolve <id>|--validate <id>] [--root <dir>] [--json] [--out <file>]\n");
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
  const storeModule = load("electron/self-case-record/case-store.js");
  const timelineModule = load("src/shared/self-case-record/timeline.js");
  const recurrenceModule = load("src/shared/self-case-record/recurrence.js");
  if (storeModule && timelineModule && recurrenceModule) {
    const store = new storeModule.CaseStore({ rootDir: options.root });
    let outcome;
    switch (options.command) {
      case "case": {
        const record = store.record(options.target ?? "");
        outcome = record === undefined
          ? { status: "UNKNOWN", reason: `no case ${options.target} is recorded in ${store.status().file}` }
          : { case: record, diagnosisHistory: timelineModule.diagnosisHistory(record), expectsMoreObservation: timelineModule.expectsMoreObservation(record) };
        break;
      }
      case "candidates":
        outcome = { candidates: store.lessonCandidates(), status: store.status() };
        break;
      case "from-diagnosis": {
        const read = fs.existsSync(options.target ?? "") ? JSON.parse(fs.readFileSync(options.target, "utf8")) : undefined;
        if (read === undefined) {
          outcome = { status: "UNKNOWN", reason: `no diagnosis report at ${options.target}` };
          break;
        }
        const report = read.report ?? read;
        const caseId = options.caseId ?? `case-${(report.at ?? new Date().toISOString()).replace(/[^0-9]/g, "").slice(0, 14)}`;
        const opened = store.openCase({
          caseId,
          at: report.at,
          trigger: `${report.symptoms?.length ?? 0} symptom(s) from a self-diagnosis run`,
          affectedComponents: [...new Set((report.hypotheses ?? []).map((hypothesis) => hypothesis.suspectedComponent))],
          symptoms: report.symptoms ?? []
        });
        if (!opened.ok) {
          outcome = { status: "REFUSED", problems: opened.problems };
          break;
        }
        // The diagnosis is copied in as a revision, which is what the record keeps: what was
        // thought, when, and why. The case does not re-diagnose and it treats nothing.
        const appended = store.append({
          caseId,
          at: report.at,
          type: "HYPOTHESIS_ADDED",
          detail: { hypotheses: report.hypotheses ?? [], reason: `copied from a self-diagnosis run at ${report.at}`, ...(report.hypotheses?.[0] === undefined ? {} : { selectedHypothesisId: report.hypotheses[0].hypothesisId }) }
        });
        if (!appended.ok) {
          outcome = { status: "REFUSED", problems: appended.problems };
          break;
        }
        if ((report.treatments ?? []).length > 0) {
          store.append({ caseId, at: report.at, type: "TREATMENT_PROPOSED", detail: { proposals: report.treatments } });
        }
        const recorded = store.record(caseId);
        const link = recurrenceModule.linkRecurrence({ cases: store.records().map((entry) => entry.record), componentId: recorded?.selectedDiagnosis?.hypotheses?.[0]?.suspectedComponent ?? "unknown", failureMode: recorded?.selectedDiagnosis?.hypotheses?.[0]?.failureMode ?? "UNKNOWN", caseId, at: report.at });
        if (link.recurrent) {
          store.append({ caseId, at: report.at, type: "RECURRENCE_LINKED", detail: { caseIds: link.relatedCaseIds } });
        }
        outcome = { caseId, recorded: store.record(caseId), recurrence: link };
        break;
      }
      case "resolve":
        outcome = store.append({ caseId: options.target ?? "", type: "CASE_RESOLVED", detail: { disposition: options.disposition ?? "UNRESOLVED", ...(options.rootCause === undefined ? {} : { rootCause: options.rootCause }) } });
        break;
      case "validate":
        outcome = store.append({ caseId: options.target ?? "", type: "VALIDATION_ADDED", detail: { verdict: options.verdict ?? "INCONCLUSIVE", evidence: [options.evidence ?? "no evidence recorded"], observedBy: "self-case-record.cjs" } });
        break;
      default:
        outcome = {
          status: store.status(),
          cases: store.records().map((entry) => ({
            caseId: entry.record.caseId,
            status: entry.record.status,
            trigger: entry.record.trigger,
            components: entry.record.affectedComponents,
            revisions: entry.record.diagnosesConsidered.length,
            treatmentsProposed: entry.record.treatmentProposals.length,
            treatmentsPerformed: entry.record.treatmentActuallyPerformed.length,
            problems: entry.problems
          }))
        };
    }

    const text = `${JSON.stringify(options.json ? { root: options.root, outcome } : outcome, null, 2)}\n`;
    process.stdout.write(text);
    if (options.out) {
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.writeFileSync(options.out, text, "utf8");
    }
  }
}
