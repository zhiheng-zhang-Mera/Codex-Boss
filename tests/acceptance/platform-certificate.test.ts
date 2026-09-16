import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 05 Task G / acceptance gate 9 — the platform certificate.
 *
 * The certificate is the machine-readable statement that the platform is what the five phases claim.
 * Three things are asserted about it, in the order that matters:
 *
 *   1. it exists and covers every heading the book names — architecture graph, state ownership,
 *      migrations, event journal, permission surface, knowledge provenance and staleness, retention
 *      and GC, targeted and full verification evidence, provider degraded-mode evidence, soak trend;
 *   2. it is honest about what has NOT run. Tasks D and F are not started, so the soak trend and the
 *      coordination economics must say so rather than report a measurement that was never taken;
 *   3. it FAILS CLOSED. The cross-checks are broken on a COPY of the artifacts and the generator is
 *      required to refuse, because a certificate that is written whatever the evidence says is worse
 *      than no certificate — it is a false attestation with a signature on it.
 *
 * Build-dependent: the generator loads the compiled platform out of `dist-electron`, the same way the
 * other gate generators do, and fails rather than skipping when the build is missing.
 */

const PROJECT = process.cwd();
const SCRIPT = path.join(PROJECT, "scripts", "platform-certificate.cjs");
const CERTIFICATE = path.join(PROJECT, "artifacts", "platform-foundation", "phase-05", "platform-certificate.json");
const ARTIFACT_ROOT = path.join(PROJECT, "artifacts", "platform-foundation");

function generate(env: Record<string, string> = {}): Record<string, any> {
  execFileSync(process.execPath, [SCRIPT], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  return JSON.parse(fs.readFileSync(CERTIFICATE, "utf8"));
}

/** Copy the four phase artifacts somewhere writable, so a probe can break one without touching them. */
function copyArtifacts(): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "phase05-cert-"));
  for (const phase of ["phase-01", "phase-02", "phase-03", "phase-04"]) {
    const from = path.join(ARTIFACT_ROOT, phase);
    const to = path.join(target, phase);
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      if (name.endsWith(".json")) fs.copyFileSync(path.join(from, name), path.join(to, name));
    }
  }
  return target;
}

describe("Phase 05 Task G — the platform certificate exists and covers what the book names", () => {
  it("generates and reports every required section", () => {
    const certificate = generate();
    expect(certificate.phase).toBe("05-scale-verification-soak");

    // The book's list, each one present and non-empty.
    for (const section of ["architectureGraph", "stateOwnership", "platformHealth", "migrations", "eventJournal", "permissionSurface", "knowledgeAndRetention", "providerDegradedMode", "verification", "soakResourceTrend", "agentCoordinationEconomics"]) {
      expect(certificate.sections[section], `the certificate has no ${section} section`).toBeTruthy();
    }
    expect(certificate.acceptance.problems).toEqual([]);
    for (const [name, held] of Object.entries(certificate.acceptance.evidence)) {
      // Each invariant is asserted to reflect the platform's ACTUAL state, not to be true. The soak
      // invariant is the live example: it is false while Task F's long run has not produced a report,
      // and the certificate says so rather than the test insisting otherwise. Once the report exists
      // the same assertion requires it to hold AND to be bounded, so the invariant cannot pass by
      // being permanently false.
      if (name === "soak-trend-measured-and-bounded") {
        const soak = certificate.sections.soakResourceTrend as { measured: boolean; trendWithinLongRunAllowance?: boolean };
        expect(held, "the soak invariant disagrees with the soak section").toBe(soak.measured === true && soak.trendWithinLongRunAllowance === true);
        continue;
      }
      expect(held, `invariant ${name} did not hold`).toBe(true);
    }
    // And the completeness block must agree with the sections rather than with a written-down list.
    const unmeasured = Object.entries(certificate.sections)
      .filter(([, section]) => (section as { measured?: boolean }).measured === false)
      .map(([name]) => name)
      .sort();
    expect(certificate.completeness.notRun).toEqual(unmeasured);
  });

  it("recomputes the architecture rather than transcribing the snapshot", () => {
    const certificate = generate();
    const graph = certificate.sections.architectureGraph;
    // The live registry and the Phase 01 snapshot agree, and the certificate says so explicitly
    // rather than only publishing one of the two numbers.
    expect(graph.snapshotAgrees).toBe(true);
    expect(graph.fatalCycles).toBe(0);
    expect(graph.bootable).toBe(true);
    expect(graph.unregisteredBootModules).toEqual([]);
    // The ratchet is re-evaluated, and the baseline is checked against the current measurement — a
    // baseline widened to pass would show up here as a disagreement.
    expect(graph.ratchetPass).toBe(true);
    expect(graph.ratchetBaselineMatchesMeasurement).toBe(true);
  });

  it("re-validates the permission surface with the real validator instead of the summary", () => {
    const certificate = generate();
    const permission = certificate.sections.permissionSurface;
    expect(permission.wildcardAuthority).toBe(0);
    expect(permission.liveWildcards).toBe(0);
    expect(permission.escapesRefused).toBe(permission.escapesAttempted);
    expect(permission.defaultDeny).toBe(true);
    // The live re-check actually looked at every grant; a zero over zero would prove nothing.
    expect(permission.liveGrantsRechecked).toBeGreaterThan(0);
  });

  it("records state ownership, migrations and the journal from the live platform", () => {
    const certificate = generate();
    expect(certificate.sections.stateOwnership.duplicateOwners).toBe(0);
    expect(certificate.sections.stateOwnership.snapshotAgrees).toBe(true);
    // Phase 02's independence claim, re-derived: exactly one manifest owns decision-ledger.
    expect(certificate.sections.stateOwnership.decisionLedgerOwner).toBe("persistence");
    expect(certificate.sections.migrations.accountingComplete).toBe(true);
    expect(certificate.sections.migrations.duplicateOwners).toBe(0);
    expect(certificate.sections.platformHealth.bootable).toBe(true);
    expect(certificate.sections.eventJournal.journalModuleExports.length).toBeGreaterThan(0);
    expect(certificate.sections.eventJournal.recoveryModuleExports.length).toBeGreaterThan(0);
  });

  it("proves the provenance and retention rules with a live probe, not a restatement", () => {
    const certificate = generate();
    const knowledge = certificate.sections.knowledgeAndRetention;
    // A verified claim over a mutable source was actually offered to the validator and refused.
    expect(knowledge.verifiedOverMutableSourceRefused).toBe(true);
    expect(knowledge.protectedDeletable).toBe(false);
    expect(knowledge.zeroMisdeletion).toBe(true);
    expect(knowledge.liveMisdeleted).toBe(0);
    expect(knowledge.gcProblems).toBe(0);
  });

  it("reports provider failure as local over the model the runtime plane uses", () => {
    const certificate = generate();
    const providers = certificate.sections.providerDegradedMode;
    expect(providers.probeVerdictWithTwoOfThreeBroken).toBe("DEGRADED");
    expect(providers.observedRuntimesCriticalToCore).toBe(0);
    expect(providers.everyClassHasAFallback).toBe(true);
    expect(providers.everyClassHasAReason).toBe(true);
  });
});

describe("Phase 05 Task G — the certificate is honest about what has not run", () => {
  it("reports the soak trend as unmeasured until a run produces one, and as measured once it does", () => {
    const certificate = generate();
    const soak = certificate.sections.soakResourceTrend as Record<string, unknown>;
    if (soak.measured === true) {
      // A report exists, so the certificate must carry its numbers rather than a summary of them.
      expect(soak.reportPath).toBe("artifacts/platform-foundation/phase-05/soak-report.json");
      expect(typeof soak.minutes).toBe("number");
      expect(typeof soak.trends).toBe("object");
      expect(soak.trendWithinLongRunAllowance).toBe(true);
      expect(soak.failedInvariants).toEqual([]);
      expect(soak.gcMisdeleted).toBe(0);
      expect(certificate.completeness.notRun).not.toContain("soakResourceTrend");
    } else {
      // No report: the section must say so WITH A REASON. A certificate that reported a resource
      // trend it had not read would be worth nothing for the one purpose Task F exists for.
      expect(soak.measured).toBe(false);
      expect(String(soak.reason)).toMatch(/not started|not been run|no resource trend/i);
      expect(certificate.completeness.notRun).toContain("soakResourceTrend");
    }
    // Task D is not started either way, so this half does not depend on the run.
    expect(certificate.sections.agentCoordinationEconomics.measured).toBe(false);
    expect(certificate.completeness.notRun).toContain("agentCoordinationEconomics");
    // What IS asserted is that the guard could refuse: a coordination rule that would promote a stage
    // on an unobserved figure is worse than no rule, so the certificate checks the refusal live rather
    // than describing it. This is why the invariant can be true while the section is unmeasured.
    const coordination = certificate.sections.agentCoordinationEconomics as Record<string, any>;
    expect(coordination.modelDelivered).toBe(true);
    expect(coordination.guard.refusesWithoutABaseline).toBe(true);
    expect(coordination.guard.refusesOnAnUnmeasuredFigure).toBe(true);
    expect(coordination.guard.verdicts).toContain("INSUFFICIENT_EVIDENCE");
    // And the phase is PARTIAL until Task D's evidence lands.
    expect(certificate.completeness.phaseStatus).toBe("PARTIAL");
  });

  it("records the gate 2 pairing once it exists, and says so when it does not", () => {
    const certificate = generate();
    const agreement = certificate.sections.verification.targetedAndFullAgreement as Record<string, any>;
    if (agreement.recorded === true) {
      // A record exists, so the certificate must carry the real figures rather than a summary of them.
      expect(agreement.fullRun.files).toBeGreaterThan(150);
      expect(agreement.fullRun.tests).toBeGreaterThan(1_000);
      expect(agreement.fullRun.passed).toBe(true);
      expect(agreement.selection.selectedCount).toBeGreaterThan(0);
      expect(agreement.selection.selectedCount).toBeLessThan(agreement.fullRun.files);
      // The half that matters: the suites the fast path skipped were all present and all passed.
      expect(agreement.pairing.skippedThatRan).toBeGreaterThan(0);
      expect(agreement.pairing.skippedThatFailed).toBe(0);
      expect(agreement.pairing.chosenThatDidNotRun).toBe(0);
      expect(certificate.acceptance.evidence["targeted-and-full-agree"]).toBe(true);
    } else {
      // No record: the section must say so WITH A REASON rather than claim the gate.
      expect(String(agreement.reason)).toMatch(/partly met|no pairing record/i);
    }
  });

  it("names the capabilities with no authoritative suite", () => {
    const certificate = generate();
    // A real evidence gap in the platform, published by the certificate rather than smoothed over.
    expect(certificate.sections.verification.impactSelector.capabilitiesWithoutASuite).toEqual(["experience", "remote"]);
    expect(certificate.sections.verification.impactSelector.unownedSourceFiles).toBe(0);
  });

  it("names the gate 7 evidence for both halves, and checks the suites are real", () => {
    const certificate = generate();
    const restart = certificate.sections.verification.restartAndRecovery;
    // Both halves the book states. Losing work is visible; applying an effect twice looks like
    // success, which is why the crash window is named explicitly rather than left to the reader.
    expect(String(restart.noCommittedWorkLost)).toContain("restart-recovery");
    expect(String(restart.noCommittedWorkLost)).toContain("state-core-crash");
    expect(String(restart.noDuplicatedSideEffect)).toContain("PARKED");
    expect(String(restart.recoveryIsBounded).length).toBeGreaterThan(20);
    // The certificate resolves those names against the CATALOGUE, so naming a suite that is not run
    // fails the generator rather than reading as evidence.
    expect(restart.suitesPresent).toBe(true);
    expect(restart.missing).toEqual([]);
    expect(certificate.acceptance.evidence["restart-loses-nothing-and-repeats-nothing"]).toBe(true);
  });

  it("cannot claim it may bypass the Root or Owner gate", () => {
    const certificate = generate();
    expect(certificate.promotion.consumableBySelfEvolution).toBe(true);
    // The book allows a promotion to CONSUME a certificate and forbids it from standing in for the
    // gate. The field is a constant in the generator, and this asserts the emitted value.
    expect(certificate.promotion.bypassesRootOrOwnerGate).toBe(false);
    expect(certificate.acceptance.evidence["certificate-cannot-bypass-the-gate"]).toBe(true);
  });
});

describe("Phase 05 Task G — the certificate fails closed", () => {
  it("refuses to write a certificate when the snapshot disagrees with the live graph", () => {
    const copies = copyArtifacts();
    try {
      const snapshotPath = path.join(copies, "phase-01", "architecture-snapshot.json");
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      // Make the recorded capability count wrong. The live graph is unchanged, so the cross-check has
      // to notice that one of the two is describing a tree that no longer exists.
      snapshot.capabilities.count = snapshot.capabilities.count + 5;
      fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

      let failed = false;
      let stderr = "";
      const outFile = path.join(copies, "certificate.json");
      try {
        execFileSync(process.execPath, [SCRIPT], {
          cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PHASE_CERT_ARTIFACTS: copies, PHASE_CERT_OUT: outFile }
        });
      } catch (error) {
        failed = true;
        stderr = String((error as { stderr?: string }).stderr ?? "");
      }
      expect(failed, "the generator wrote a certificate from a disagreeing snapshot").toBe(true);
      expect(stderr).toContain("FAILED");
      expect(stderr).toMatch(/capabilities but the Phase 01 snapshot recorded/);
      // And no certificate was written at the output path.
      expect(fs.existsSync(outFile)).toBe(false);
    } finally {
      fs.rmSync(copies, { recursive: true, force: true });
    }
  });

  it("refuses when the permission surface records a wildcard grant", () => {
    const copies = copyArtifacts();
    try {
      const surfacePath = path.join(copies, "phase-03", "permission-surface.json");
      const surface = JSON.parse(fs.readFileSync(surfacePath, "utf8"));
      // An ambient credential is the escalation the Phase 03 contract refuses. The summary is left
      // untouched, so the certificate can only catch this by re-running the live validator — which is
      // what makes this probe test the re-check rather than the transcription.
      surface.subjects[0].grants[0].constraints.credential = "ambient";
      fs.writeFileSync(surfacePath, `${JSON.stringify(surface, null, 2)}\n`, "utf8");

      let failed = false;
      let stderr = "";
      const outFile = path.join(copies, "certificate.json");
      try {
        execFileSync(process.execPath, [SCRIPT], {
          cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PHASE_CERT_ARTIFACTS: copies, PHASE_CERT_OUT: outFile }
        });
      } catch (error) {
        failed = true;
        stderr = String((error as { stderr?: string }).stderr ?? "");
      }
      expect(failed, "the generator wrote a certificate from a surface carrying ambient credential authority").toBe(true);
      expect(stderr).toMatch(/ambient-credential|wildcard/);
      expect(fs.existsSync(outFile)).toBe(false);
    } finally {
      fs.rmSync(copies, { recursive: true, force: true });
    }
  });

  it("leaves the real artifacts untouched by the probes above", () => {
    // The probes copy; this asserts the copies were copies.
    const certificate = generate();
    expect(certificate.acceptance.problems).toEqual([]);
    expect(certificate.sections.architectureGraph.capabilities).toBe(27);
    expect(certificate.sections.permissionSurface.liveWildcards).toBe(0);
  }, 240_000);
});
