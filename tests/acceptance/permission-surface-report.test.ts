import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 03 acceptance gate 7 — the permission surface artifact.
 *
 * The generator runs the real escape battery against a real broker and forks a real plugin under
 * Node's permission model, then records what happened. This suite proves two things:
 *
 *   1. the artifact answers the gate's five questions — subjects, grants, denials, credential
 *      references and plugin isolation evidence;
 *   2. the evidence is REAL: the escape battery refused everything it attempted, and the sandbox
 *      self-test reports denials measured inside the child. A report claiming a clean surface
 *      while containing no denials would be describing a boundary nobody tested.
 *
 * Build-dependent: the generator loads the compiled capability layer from `dist-electron`, and it
 * FAILS rather than skipping when the build is missing.
 */

const PROJECT = process.cwd();
const SCRIPT = path.join(PROJECT, "scripts", "permission-surface-report.cjs");
const REPORT = path.join(PROJECT, "artifacts", "platform-foundation", "phase-03", "permission-surface.json");

function generate(): Record<string, any> {
  execFileSync(process.execPath, [SCRIPT], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(fs.readFileSync(REPORT, "utf8"));
}

describe("Phase 03 gate 7 — the permission surface is measured, not asserted", () => {
  it("generates and answers all five questions", () => {
    const report = generate();
    expect(report.phase).toBe("03-capability-security-plugins");
    expect(report.subjects.length).toBe(report.summary.subjects);
    expect(report.subjects.length).toBeGreaterThanOrEqual(3);
    expect(report.summary.grants).toBeGreaterThanOrEqual(3);
    expect(report.escapeBattery.length).toBeGreaterThanOrEqual(9);
    expect(report.isolation).toBeTruthy();
    expect(report.credentialReferences.references.length).toBeGreaterThanOrEqual(2);
    // Every subject states what it is for, and every grant states why it exists.
    for (const subject of report.subjects) {
      expect(subject.describes, `${subject.subject} has no description`).toBeTruthy();
      expect(subject.grants.length).toBeGreaterThan(0);
      for (const grant of subject.grants) {
        expect(grant.reason, `${grant.id} has no reason`).toBeTruthy();
        expect(grant.allowedActions.length).toBeGreaterThan(0);
        expect(grant.resources.length).toBeGreaterThan(0);
      }
    }
  });

  it("refused every escape attempt, and each refusal names the mechanism", () => {
    const report = generate();
    expect(report.summary.escapesRefused).toBe(report.summary.escapesAttempted);
    for (const attempt of report.escapeBattery) {
      expect(attempt.outcome, `${attempt.label} was not refused`).toBe("DENY");
      expect(attempt.reason, `${attempt.label} has no reason code`).toBeTruthy();
      expect(attempt.evidence, `${attempt.label} has no evidence reference`).toBeTruthy();
      expect(attempt.refusedBy, `${attempt.label} does not say which mechanism refused it`).toBeTruthy();
    }
    // The specific high-risk operations the book names, each present and each refused.
    const labels = report.escapeBattery.map((entry: any) => entry.label);
    for (const required of ["read a project file", "make a network request", "force push", "administer the repository", "send rather than draft mail", "use a stored credential", "start a child process", "push a commit", "send mail"]) {
      expect(labels, `${required} is missing from the escape battery`).toContain(required);
    }
  });

  it("contains no wildcard authority anywhere", () => {
    const report = generate();
    expect(report.summary.wildcardAuthority).toBe(0);
    const serialised = JSON.stringify(report.subjects);
    expect(serialised).not.toContain('"*"');
    expect(serialised).not.toContain("allowAll");
    for (const subject of report.subjects) {
      for (const grant of subject.grants) {
        for (const action of grant.allowedActions) expect(action).not.toBe("*");
        for (const resource of grant.resources) expect(resource.includes("*")).toBe(false);
      }
    }
  });

  it("records the plugin isolation evidence, measured inside the child", () => {
    const report = generate();
    expect(report.isolation.started).toBe(true);
    expect(report.isolation.health).toBe("READY");
    expect(report.isolation.manifest.id).toBe("plugin.example.theme");
    // The plugin reported its OWN process: real denials, not a description of one.
    const selfTest = report.isolation.sandboxSelfTest;
    expect(selfTest).toBeTruthy();
    expect(selfTest["fs.readFileSync(project)"]).toContain("DENIED");
    expect(selfTest["fs.writeFileSync"]).toContain("DENIED");
    expect(selfTest["child_process.execSync"]).toContain("DENIED");
    expect(selfTest["worker_threads.Worker"]).toContain("DENIED");
    expect(selfTest.credentialEnv).toBe("ENV:ABSENT");
    expect(selfTest.pathEnv).toBe("ENV:SANITIZED");
    expect(report.isolation.sandboxDeniedAxes.length).toBeGreaterThanOrEqual(4);
  });

  it("states which mechanism covers which axis, and does NOT overclaim the network", () => {
    const report = generate();
    const mechanisms = report.isolation.mechanisms as Array<{ axis: string; enforced: boolean; how: string }>;
    const byAxis = new Map(mechanisms.map((entry) => [entry.axis, entry] as const));
    // The honest part: the network is NOT physically denied, and the report says so.
    const network = byAxis.get("network");
    expect(network, "the network axis is missing from the mechanism list").toBeTruthy();
    expect(network?.enforced).toBe(false);
    expect(network?.how).toMatch(/NOT physically denied|capability layer/);
    for (const axis of ["filesystem", "child processes", "worker threads", "environment secrets", "credentials"]) {
      expect(byAxis.get(axis)?.enforced, `${axis} should be enforced`).toBe(true);
    }
  });

  it("never records a credential secret", () => {
    const report = generate();
    expect(report.credentialReferences.secretsPrinted).toBe(false);
    const serialised = JSON.stringify(report.credentialReferences);
    expect(serialised).not.toContain("ghp_");
    for (const reference of report.credentialReferences.references) {
      expect(reference.opaqueToken).toMatch(/^ctok-/);
      expect(reference.scope).toBeTruthy();
    }
    expect(report.credentialReferences.revocationBindsImmediately).toBe(true);
  });

  it("records every gate outcome, and all of them met", () => {
    const report = generate();
    const gates = report.gates;
    for (const [name, value] of Object.entries(gates) as Array<[string, any]>) {
      expect(value.met, `${name} is not met`).toBe(true);
      expect(value.detail, `${name} has no detail`).toBeTruthy();
    }
    expect(report.defaultDeny.enforced).toBe(true);
    expect(report.defaultDeny.unknownSubjectDecision).toBe("no-grant");
  });

  it("is reproducible from the same sources", () => {
    const first = generate();
    const second = generate();
    /**
     * Timestamps and opaque identifiers may move; everything MEASURED must not.
     *
     * The credential ids and tokens are freshly minted per run — that is the point of an opaque
     * reference — so they are normalised by key name alongside the timestamps. The first version
     * only normalised `*At` keys and reported a reproducibility failure that was really two random
     * uuids, which is worth keeping in mind: a reproducibility check that compares generated
     * identifiers is testing the random number generator.
     */
    const normalise = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(normalise);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
          // `Object.fromEntries` needs a PAIR; returning a bare string here silently produced an
          // empty object and made the comparison pass for the wrong reason.
          if (/At$/.test(key) || key === "id" || key === "opaqueToken") return [key, `<${key}>`];
          return [key, normalise(entry)];
        }));
      }
      return value;
    };
    expect(normalise(second)).toEqual(normalise(first));
    expect(second.summary).toEqual(first.summary);
  });
});
