/**
 * Update-Plan/checkpoint-2.md §9 (CP23, AD-01..AD-20 + AD-POSITIVE) — adversarial
 * evidence mutation acceptance.
 *
 * The last thing Prestart does is try to break itself. Every mutation is applied to a
 * real temporary artifact directory (real files, real hashes, real attestations, the
 * real ledger) and judged by the real host auditor — no test mocks the decision
 * (§9.3). Each case must be refused; the single clean case must be accepted. The
 * report ends with `false_positive_cases: 0`.
 */
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  AcceptanceRun,
  acceptanceArtifacts,
  cleanGateReport,
  desktopBlackBoxReport,
  type FixtureReport
} from "../helpers/acceptance-report";
import { cleanupFixtures } from "../helpers/root-fixtures";
import { trustedFixture, type TrustedFixture } from "../helpers/trusted-evidence";
import { ACCEPTANCE_GATE_CONTRACTS, DESKTOP_BLACK_BOX_CONTRACT } from "../../src/shared/acceptance-contracts";
import { appendOwnerIntervention, emptyOwnerLedger, ownerLedgerHashOf, type OwnerInterventionLedger } from "../../src/shared/owner-intervention";
import { readJsonFile } from "../../electron/engineering/acceptance-session";
import { ownerLedgerPath } from "../../electron/engineering/owner-intervention-ledger";

const run = new AcceptanceRun("CHECKPOINT_23_ADVERSARIAL_ACCEPTANCE");
const REPORT_DIR = acceptanceArtifacts();
const falsePositives: string[] = [];
const acceptedMutations: string[] = [];

const VERIFY = "acceptance-verify";
const KNOWLEDGE = "acceptance-knowledge";
const FINAL = "acceptance-final";

function contractOf(gate: string) {
  return ACCEPTANCE_GATE_CONTRACTS.find((entry) => entry.gate === gate)!;
}

/** Rewrites a gate's report and re-attests it, so only its content is the attack. */
function rewriteAndAttest(fixture: TrustedFixture, gate: string, mutate: (report: FixtureReport) => void): void {
  const report = cleanGateReport(contractOf(gate));
  mutate(report);
  fixture.writeReport(gate, report);
  fixture.attest(gate);
}

interface Mutation {
  id: string;
  title: string;
  apply(fixture: TrustedFixture): void;
  expects: string[];
}

const MUTATIONS: readonly Mutation[] = [
  {
    id: "AD-01",
    title: "a deleted gate report cannot pass",
    expects: ["REPORT_FILE_MISSING"],
    apply: (fixture) => fixture.removeReport(VERIFY)
  },
  {
    id: "AD-02",
    title: "a deleted attestation cannot pass",
    expects: ["ATTESTATION_NOT_OBJECT"],
    apply: (fixture) => fixture.removeAttestation(VERIFY)
  },
  {
    id: "AD-03",
    title: "an empty report object cannot pass",
    expects: ["SCHEMA_VERSION_MISSING", "RESULTS_NOT_ARRAY"],
    apply: (fixture) => {
      fixture.writeReport(VERIFY, {});
      fixture.attest(VERIFY);
    }
  },
  {
    id: "AD-04",
    title: "a report without `passed` cannot pass",
    expects: ["PASSED_MISSING"],
    apply: (fixture) => rewriteAndAttest(fixture, VERIFY, (report) => { delete (report as Partial<FixtureReport>).passed; })
  },
  {
    id: "AD-05",
    title: "passed:true with a failing total cannot pass",
    expects: ["TOTALS_FAIL_MISMATCH", "TOTALS_SUM_MISMATCH"],
    apply: (fixture) => rewriteAndAttest(fixture, VERIFY, (report) => {
      // No result is FAIL, yet the totals claim one: the numbers and the verdicts
      // have to agree for a report to be evidence at all.
      report.totals.fail = 1;
    })
  },
  {
    id: "AD-06",
    title: "a missing required id cannot pass",
    expects: ["REQUIRED_ID_MISSING:V-04"],
    apply: (fixture) => rewriteAndAttest(fixture, VERIFY, (report) => {
      report.requirementResults = report.requirementResults.filter((entry) => entry.id !== "V-04");
      report.totals.pass -= 1;
    })
  },
  {
    id: "AD-07",
    title: "a FAIL required id cannot pass",
    expects: ["FAIL_PRESENT:V-04", "REQUIRED_ID_NOT_PASS:V-04=FAIL"],
    apply: (fixture) => rewriteAndAttest(fixture, VERIFY, (report) => {
      report.requirementResults = report.requirementResults.map((entry) => entry.id === "V-04" ? { ...entry, verdict: "FAIL" as const } : entry);
      report.totals = { pass: report.totals.pass - 1, fail: 1, notRun: 0 };
    })
  },
  {
    id: "AD-08",
    title: "a NOT_RUN required id cannot pass",
    expects: ["NOT_RUN_PRESENT:V-04", "REQUIRED_ID_NOT_PASS:V-04=NOT_RUN"],
    apply: (fixture) => rewriteAndAttest(fixture, VERIFY, (report) => {
      report.requirementResults = report.requirementResults.map((entry) => entry.id === "V-04" ? { ...entry, verdict: "NOT_RUN" as const } : entry);
      report.totals = { pass: report.totals.pass - 1, fail: 0, notRun: 1 };
    })
  },
  {
    id: "AD-09",
    title: "an extra FAIL result cannot hide",
    expects: ["FAIL_PRESENT:V-EXTRA"],
    apply: (fixture) => rewriteAndAttest(fixture, VERIFY, (report) => {
      report.requirementResults.push({ id: "V-EXTRA", title: "an extra failing check", verdict: "FAIL" });
      report.totals = { pass: report.totals.pass, fail: 1, notRun: 0 };
    })
  },
  {
    id: "AD-10",
    title: "a duplicate requirement id cannot pass",
    expects: ["DUPLICATE_ID:V-01"],
    apply: (fixture) => rewriteAndAttest(fixture, VERIFY, (report) => {
      report.requirementResults.push({ id: "V-01", title: "forged duplicate", verdict: "PASS" });
      report.totals.pass += 1;
    })
  },
  {
    id: "AD-11",
    title: "a forged pass total cannot pass",
    expects: ["TOTALS_PASS_MISMATCH"],
    apply: (fixture) => rewriteAndAttest(fixture, VERIFY, (report) => { report.totals.pass += 1; })
  },
  {
    id: "AD-12",
    title: "a report modified after attestation cannot pass",
    expects: ["SOURCE_HASH_MISMATCH"],
    apply: (fixture) => {
      // The report stays valid-looking; only its bytes moved.
      fs.writeFileSync(fixture.reportFile(VERIFY), `${JSON.stringify(cleanGateReport(contractOf(VERIFY)), null, 2)}\n`, "utf8");
    }
  },
  {
    id: "AD-13",
    title: "an artifact from another session cannot pass",
    expects: ["ATTESTATION_SESSION_MISMATCH"],
    apply: (fixture) => {
      const other = trustedFixture({ sessionId: "session-adversarial-old" });
      fs.copyFileSync(other.reportFile(VERIFY), fixture.reportFile(VERIFY));
      fs.copyFileSync(other.attestationFile(VERIFY), fixture.attestationFile(VERIFY));
    }
  },
  {
    id: "AD-14",
    title: "an artifact from another commit cannot pass",
    expects: ["ATTESTATION_COMMIT_MISMATCH"],
    apply: (fixture) => {
      const other = trustedFixture({ sessionId: "session-adversarial-other-commit", commit: "e".repeat(40) });
      fs.copyFileSync(other.reportFile(VERIFY), fixture.reportFile(VERIFY));
      fs.copyFileSync(other.attestationFile(VERIFY), fixture.attestationFile(VERIFY));
    }
  },
  {
    id: "AD-15",
    title: "a desktop black box with one claim cannot pass",
    expects: ["REQUIRED_ID_MISSING:DB-002"],
    apply: (fixture) => {
      fixture.writeReport(DESKTOP_BLACK_BOX_CONTRACT.gate, desktopBlackBoxReport((report) => {
        report.requirementResults = report.requirementResults.slice(0, 1);
        report.totals = { pass: 1, fail: 0, notRun: 0 };
      }));
      fixture.attest(DESKTOP_BLACK_BOX_CONTRACT.gate);
    }
  },
  {
    id: "AD-16",
    title: "a desktop black box with 88 of 89 claims cannot pass",
    expects: ["EXACT_IDS_MISSING:DB-089"],
    apply: (fixture) => {
      fixture.writeReport(DESKTOP_BLACK_BOX_CONTRACT.gate, desktopBlackBoxReport((report) => {
        report.requirementResults = report.requirementResults.slice(0, 88);
        report.totals = { pass: 88, fail: 0, notRun: 0 };
      }));
      fixture.attest(DESKTOP_BLACK_BOX_CONTRACT.gate);
    }
  },
  {
    id: "AD-17",
    title: "a desktop black box with a tampered contract hash cannot pass",
    expects: ["DESKTOP_CONTRACT_HASH_MISMATCH"],
    apply: (fixture) => {
      fixture.writeReport(DESKTOP_BLACK_BOX_CONTRACT.gate, desktopBlackBoxReport((report) => { report.contract.claim_ids_hash = "0".repeat(64); }));
      fixture.attest(DESKTOP_BLACK_BOX_CONTRACT.gate);
    }
  },
  {
    id: "AD-18",
    title: "an Owner intervention cannot pass",
    expects: ["forbids them"],
    apply: (fixture) => fixture.recordIntervention("the Owner was asked to decide the file layout")
  },
  {
    id: "AD-19",
    title: "a ledger whose count was edited back to zero cannot pass",
    expects: ["LEDGER_COUNT_MISMATCH"],
    apply: (fixture) => {
      const withEvent = appendOwnerIntervention(emptyOwnerLedger(fixture.session), {
        source: "acceptance-run",
        at: new Date(0).toISOString(),
        reason: "one real request"
      });
      const forged: OwnerInterventionLedger = { ...withEvent, count: 0 };
      fixture.writeLedger({ ...forged, ledger_hash: ownerLedgerHashOf(forged) });
    }
  },
  {
    id: "AD-20",
    title: "a capability without trusted evidence cannot pass",
    expects: ["REPORT_FILE_MISSING", "ATTESTATION"],
    apply: (fixture) => {
      fixture.removeReport(KNOWLEDGE);
      fixture.removeAttestation(FINAL);
    }
  }
];

describe("checkpoint-2 §9 CP23 adversarial evidence mutation acceptance", () => {
  for (const mutation of MUTATIONS) {
    it(`${mutation.id} ${mutation.title}`, async () => {
      await run.scenario(mutation.id, mutation.title, (item) => {
        const fixture = trustedFixture();
        mutation.apply(fixture);
        const audit = fixture.evaluate();
        if (audit.decision === "BOOTSTRAP_COMPLETE") {
          falsePositives.push(mutation.id);
          acceptedMutations.push(mutation.id);
        }
        item.check("the mutation was applied to real artifacts", true, fs.existsSync(fixture.artifacts));
        item.check("the auditor refuses the mutated evidence", "INCOMPLETE", audit.decision);
        item.check("and names the reason", true, audit.reasons.some((reason) => mutation.expects.some((expected) => reason.includes(expected))));
        item.check("the refusal is itself hash-bound", true, /^[0-9a-f]{64}$/.test(audit.root_hash));
        item.cite("evaluateTrustedBootstrap");
      });
    });
  }

  it("AD-POSITIVE the clean evidence set is accepted", async () => {
    await run.scenario("AD-POSITIVE", "§9.2 positive control", (item) => {
      const fixture = trustedFixture();
      const audit = fixture.evaluate();
      item.check("the clean set completes", "BOOTSTRAP_COMPLETE", audit.decision);
      item.check("with sixteen trusted gates", 16, audit.gates_passed);
      item.check("the full desktop contract", true, audit.desktop.verified_claims === audit.desktop.required_claims && audit.desktop.verified_claims > 0);
      item.check("thirteen capabilities", 13, audit.capabilities.passed);
      item.check("zero Owner events", 0, audit.owner_interventions);
      item.check("one session", true, audit.provenance.same_session);
      item.check("one commit", true, audit.provenance.same_commit);
      item.check("verified source hashes", true, audit.provenance.source_hashes_verified);
      item.check("a root hash", true, /^[0-9a-f]{64}$/.test(audit.root_hash));
      item.check("no reasons", 0, audit.reasons.length);
      item.cite("BOOTSTRAP_COMPLETE");
    });
  });
});

afterAll(() => {
  const report = run.write(REPORT_DIR, "prestart-adversarial.json", {
    checkpoint: "CP23",
    mutations: MUTATIONS.length,
    // §9.4: the number that must be zero.
    false_positive_cases: falsePositives.length,
    false_positive_ids: falsePositives,
    accepted_mutations: acceptedMutations,
    positive_control: "BOOTSTRAP_COMPLETE"
  });
  cleanupFixtures();
  run.assertAllPass();
  expect(falsePositives).toEqual([]);
  expect((report.totals as { fail: number }).fail).toEqual(0);
});
