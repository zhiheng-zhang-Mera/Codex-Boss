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
      expect(held, `invariant ${name} did not hold`).toBe(true);
    }
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
  it("says the soak trend was not measured rather than reporting one", () => {
    const certificate = generate();
    // Task F is not started. A certificate that produced a resource trend here would be inventing the
    // single most load-bearing measurement in the phase.
    expect(certificate.sections.soakResourceTrend.measured).toBe(false);
    expect(certificate.sections.soakResourceTrend.reason).toMatch(/not started/i);
    expect(certificate.sections.agentCoordinationEconomics.measured).toBe(false);
    expect(certificate.completeness.notRun).toEqual(["soakResourceTrend", "agentCoordinationEconomics"]);
    expect(certificate.completeness.phaseStatus).toBe("PARTIAL");
  });

  it("reports the gate 2 shortfall instead of claiming it was met", () => {
    const certificate = generate();
    // The selector/full-run comparison mechanism exists and is tested; it has not been recorded
    // against a full-suite execution, and the certificate says exactly that.
    expect(certificate.sections.verification.targetedAndFullAgreement.recorded).toBe(false);
    expect(certificate.sections.verification.targetedAndFullAgreement.reason).toMatch(/partly met|not been recorded/i);
  });

  it("names the capabilities with no authoritative suite", () => {
    const certificate = generate();
    // A real evidence gap in the platform, published by the certificate rather than smoothed over.
    expect(certificate.sections.verification.impactSelector.capabilitiesWithoutASuite).toEqual(["experience", "remote"]);
    expect(certificate.sections.verification.impactSelector.unownedSourceFiles).toBe(0);
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
