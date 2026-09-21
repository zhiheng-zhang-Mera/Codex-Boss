#!/usr/bin/env node
/**
 * Case Record 鈥?the case log, as a runnable answer.
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
    else if (argument === "--metrics") options.command = "metrics";
    else if (argument === "--defects") options.command = "defects";
    else if (argument === "--case") { options.command = "case"; options.target = argv[++index]; }
    else if (argument === "--from-diagnosis") { options.command = "from-diagnosis"; options.target = path.resolve(argv[++index] ?? ""); }
    else if (argument === "--case-id") options.caseId = argv[++index];
    else if (argument === "--incident-class") options.incidentClass = argv[++index];
    else if (argument === "--observe") { options.command = "observe"; options.target = argv[++index]; }
    else if (argument === "--revise") { options.command = "revise"; options.target = argv[++index]; }
    else if (argument === "--in") options.inFile = path.resolve(argv[++index] ?? "");
    else if (argument === "--performed") { options.command = "performed"; options.target = argv[++index]; }
    else if (argument === "--by") options.by = argv[++index];
    else if (argument === "--proposal") options.proposal = argv[++index];
    else if (argument === "--treatment") options.treatment = argv[++index];
    else if (argument === "--outcome") options.outcome = argv[++index];
    else if (argument === "--detail") options.detail = argv[++index];
    else if (argument === "--resolve") { options.command = "resolve"; options.target = argv[++index]; }
    else if (argument === "--disposition") options.disposition = argv[++index];
    else if (argument === "--root-cause") options.rootCause = argv[++index];
    else if (argument === "--validate") { options.command = "validate"; options.target = argv[++index]; }
    else if (argument === "--verdict") options.verdict = argv[++index];
    else if (argument === "--evidence") options.evidence = argv[++index];
    else if (argument === "--root") options.root = path.resolve(argv[++index] ?? "");
    else if (argument === "--repo-root") options.repoRoot = path.resolve(argv[++index] ?? "");
    else if (argument === "--json") options.json = true;
    else if (argument === "--out") options.out = path.resolve(argv[++index] ?? "");
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        "usage: node scripts/self-case-record.cjs <command> [options]\n" +
        "  T0/T1  node scripts/self-view.cjs --json --out <model.json>\n" +
        "  T2     node scripts/self-diagnosis.cjs --data-root <dir> --json --out <diagnosis.json>\n" +
        "  T3     --from-diagnosis <diagnosis.json> --case-id <id> --incident-class REAL_INCIDENT|RETROSPECTIVE_FIXTURE|DEVELOPMENT_TEST\n" +
        "  T4     --observe <id> --detail \"<what was learned>\"   |   --revise <id> --from-diagnosis <revision.json>\n" +
        "  T5     --performed <id> --proposal <proposalId> --by OWNER|HNS|EXTERNAL_SYSTEM --treatment <kind> --outcome \"<what happened>\"\n" +
        "  T6     --validate <id> --verdict CONFIRMED|PARTIALLY_CONFIRMED|REFUTED|INCONCLUSIVE --evidence \"<what was seen>\" [--by <who>]\n" +
        "  T7     --resolve <id> --disposition RESOLVED|UNRESOLVED [--root-cause <component>]\n" +
        "  read   --list | --case <id> | --candidates | --metrics | --defects\n" +
        "  other  [--root <caseLogDir>] [--repo-root <checkout>] [--json] [--out <file>]\n"
      );
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
  const caseModule = load("src/shared/self-case-record/case.js");
  if (storeModule && timelineModule && recurrenceModule && caseModule) {
    const store = new storeModule.CaseStore({ rootDir: options.root });

    /**
     * Which body and which diagnosis rules this record is being written under.
     *
     * Provenance is computed HERE, in the host, and handed in as strings: the case record stores it
     * and never derives it, which is what keeps the record from depending on the two modules it
     * describes. A checkout that cannot be read yields an explicit UNKNOWN rather than a blank.
     */
    const provenance = (() => {
      try {
        const factsModule = load("electron/self-cognition/facts.js");
        const anatomyModule = load("src/shared/self-cognition/anatomy.js");
        const driftModule = load("src/shared/self-cognition/drift.js");
        const policyModule = load("src/shared/self-diagnosis/policy.js");
        const model = anatomyModule.buildSelfModel(factsModule.collectSelfFacts({ repositoryRoot: options.repoRoot ?? ROOT }));
        return {
          selfModelVersion: driftModule.SELF_MODEL_VERSION,
          selfModelHash: driftModule.selfModelHash(model),
          diagnosisEngineVersion: policyModule.SELF_DIAGNOSIS_ENGINE_VERSION,
          diagnosisPolicyHash: policyModule.diagnosisPolicyHash(),
          source: `self-case-record.cjs reading ${options.repoRoot ?? ROOT}`
        };
      } catch (error) {
        return caseModule.unknownProvenance(`self-case-record.cjs could not read the checkout: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();

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
      case "metrics":
        outcome = { metrics: store.dogfood(), status: store.status() };
        break;
      case "defects":
        outcome = {
          defects: store.defectReports({ engineVersion: provenance.diagnosisEngineVersion, policyHash: provenance.diagnosisPolicyHash }),
          metrics: store.dogfood(),
          status: store.status()
        };
        break;
      case "observe":
        outcome = store.append({ caseId: options.target ?? "", type: "OBSERVATION_ADDED", detail: { detail: options.detail ?? "no detail recorded" } });
        break;
      case "revise": {
        // T4: what the investigation learned is appended as a REVISION. The first pass stays where
        // it is, which is the whole point of scoring the first pass.
        const file = options.inFile;
        if (typeof file !== "string" || !fs.existsSync(file)) {
          outcome = { status: "REFUSED", problems: ["--revise needs --in <diagnosis.json>: the revision is a diagnosis report, copied in rather than re-derived"] };
          break;
        }
        const read = JSON.parse(fs.readFileSync(file, "utf8"));
        const report = read.report ?? read;
        outcome = store.append({
          caseId: options.target ?? "",
          type: "HYPOTHESIS_REVISED",
          detail: {
            hypotheses: report.hypotheses ?? [],
            ...(report.hypotheses?.[0] === undefined ? {} : { selectedHypothesisId: report.hypotheses[0].hypothesisId }),
            reason: options.detail ?? `revised from a self-diagnosis run at ${report.at}`
          }
        });
        break;
      }
      case "performed":
        outcome = store.append({
          caseId: options.target ?? "",
          type: "TREATMENT_PERFORMED",
          detail: {
            proposalId: options.proposal ?? "",
            treatment: options.treatment ?? "UNKNOWN",
            performedBy: options.by ?? "",
            outcome: options.outcome ?? "no outcome recorded",
            reversible: false
          }
        });
        break;
      case "from-diagnosis": {
        const read = fs.existsSync(options.target ?? "") ? JSON.parse(fs.readFileSync(options.target, "utf8")) : undefined;
        if (read === undefined) {
          outcome = { status: "UNKNOWN", reason: `no diagnosis report at ${options.target}` };
          break;
        }
        // The protocol's first rule: a case says whether it is evidence about the system or about
        // the recorder, and there is no default.
        if (!["REAL_INCIDENT", "RETROSPECTIVE_FIXTURE", "DEVELOPMENT_TEST"].includes(options.incidentClass ?? "")) {
          process.stderr.write("--incident-class is required: REAL_INCIDENT counts in the dogfood headline; RETROSPECTIVE_FIXTURE and DEVELOPMENT_TEST do not\n");
          outcome = { status: "REFUSED", problems: ["--incident-class must be REAL_INCIDENT, RETROSPECTIVE_FIXTURE or DEVELOPMENT_TEST"] };
          break;
        }
        const report = read.report ?? read;
        const caseId = options.caseId ?? `case-${(report.at ?? new Date().toISOString()).replace(/[^0-9]/g, "").slice(0, 14)}`;
        const opened = store.openCase({
          caseId,
          at: report.at,
          trigger: `${report.symptoms?.length ?? 0} symptom(s) from a self-diagnosis run`,
          incidentClass: options.incidentClass,
          provenance,
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
