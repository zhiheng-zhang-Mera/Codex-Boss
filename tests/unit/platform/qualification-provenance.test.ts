import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * PF-DEBT-018 — the corpus provenance record may only contain things it MEASURED.
 *
 * Schema v1 carried `runner.labels`, filled from `process.env.RUNNER_LABELS`. GitHub Actions does not define
 * that variable, so the field could never hold anything: on the real soak host — scheduled through
 * `[self-hosted, windows, boss-real-soak, boss-qualification]` — it serialized as `[]`. A record that looks
 * like a measurement and is always empty misleads every reader who trusts it, so v2 removes the field rather
 * than inventing a replacement. These tests exist so it cannot come back, in either of the two ways it could:
 * by reading a nonexistent variable again, or by being handed the workflow's scheduling labels and calling
 * that a measurement.
 *
 * HOW A FIXTURE CORPUS IS POSSIBLE AT ALL: the reporter resolves its roots from its own location
 * (`path.resolve(__dirname, "..")`), which is the honest design for a script that must always report on the
 * repository it ships in. So the fixture is a temporary directory with the reporter copied into
 * `<fixture>/scripts/`, and its four roots created beside it. The fixture's file count is asserted in every
 * case, so the copy trick cannot silently degrade into scanning the real repository.
 */

const PROJECT = process.cwd();
const REPORTER = path.join(PROJECT, "scripts", "qualification-corpus-provenance.cjs");
const PROJECT_ROOTS = [".codex-boss", "artifacts", "runtime-data", "history"] as const;

const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

interface Fixture {
  root: string;
  reporter: string;
  files: number;
}

/** A temporary corpus with distinctive, private-looking names — the point is that they must never leak. */
function fixtureCorpus(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "provenance-fixture-"));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(REPORTER, path.join(root, "scripts", "qualification-corpus-provenance.cjs"));

  const write = (relative: string, content: string): void => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  };

  // Distinctive names and content that a redacted record must never expose.
  write(".codex-boss/config/owner-private-config.json", "OWNER_PRIVATE_CONFIG_CONTENT\n");
  write("artifacts/host-soak/PRIVATE-SOAK-REPORT-9182736.json", "PRIVATE_SOAK_REPORT_CONTENT\n");
  write("runtime-data/sessions/OWNER-SESSION-ABC123.json", "PRIVATE_SESSION_TRANSCRIPT_CONTENT\n");
  write("history/SECRET-PROJECT-HEALTH-TRACKER.jsonl", "PRIVATE_PROJECT_HISTORY_CONTENT\n");
  write("artifacts/nested/deeper/PRIVATE-NESTED-FIXTURE.txt", "x".repeat(64));

  return { root, reporter: path.join(root, "scripts", "qualification-corpus-provenance.cjs"), files: 5 };
}

interface Invocation {
  status: number;
  stdout: string;
  stderr: string;
}

function runReporter(fixture: Fixture, args: string[], env: Record<string, string> = {}): Invocation {
  const childEnv: Record<string, string> = { ...process.env } as Record<string, string>;
  // The runner variables are cleared first so each case controls exactly what the reporter can see.
  for (const key of ["RUNNER_NAME", "RUNNER_ENVIRONMENT", "RUNNER_LABELS", "RUNNER_OS", "GITHUB_SHA"]) delete childEnv[key];
  Object.assign(childEnv, env);
  try {
    const stdout = execFileSync(process.execPath, [fixture.reporter, ...args], { cwd: fixture.root, encoding: "utf8", env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, stdout: String(failure.stdout ?? ""), stderr: String(failure.stderr ?? "") };
  }
}

function jsonRecord(fixture: Fixture, args: string[], env: Record<string, string> = {}): Record<string, any> {
  const run = runReporter(fixture, [...args, "--json"], env);
  expect(run.status, `the reporter exited ${run.status}: ${run.stderr}`).toBe(0);
  return JSON.parse(run.stdout) as Record<string, any>;
}

describe("PF-DEBT-018 — the provenance record reports only measured runner facts", () => {
  it("A. cannot be made to carry a nonexistent environment variable, even when one is set", () => {
    const fixture = fixtureCorpus();
    const record = jsonRecord(fixture, ["--redacted"], { RUNNER_LABELS: "forged-one,forged-two" });

    // The fixture really was the subject, not the repository.
    expect(record.corpus.totalFiles).toBe(fixture.files);

    // The schema no longer has the field at all — not `[]`, not null, not "unknown".
    expect(Object.keys(record.runner).sort()).toEqual(["class", "name", "os"]);
    expect(record.runner.labels).toBeUndefined();

    // And the forged values are nowhere in the machine record, not merely absent from that one key: a future
    // revision that quietly reintroduced the variable under another name would be caught here.
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("forged-one");
    expect(serialized).not.toContain("forged-two");
    expect(serialized).not.toContain("RUNNER_LABELS");
  });

  it("B. still reports the runner facts the job can actually observe", () => {
    const fixture = fixtureCorpus();
    const record = jsonRecord(fixture, ["--redacted"], { RUNNER_NAME: "boss-real-soak", RUNNER_ENVIRONMENT: "self-hosted", GITHUB_SHA: "a".repeat(40) });

    expect(record.corpus.totalFiles).toBe(fixture.files);
    expect(record.runner.name).toBe("boss-real-soak");
    expect(record.runner.class).toBe("self-hosted");
    // `os` is measured from the running process, deliberately — asserted against the same measurement rather
    // than against a constant, so the test does not pin the suite to one machine.
    expect(record.runner.os).toBe(`${os.type()} ${os.release()} ${os.arch()}`);
    expect(record.commit).toBe("a".repeat(40));
    expect(record.trustEpoch).toBeNull(); // the fixture has no trust-policy/, which is a null, not a guess
  });

  it("C. redacts every fixture path and every piece of fixture content", () => {
    const fixture = fixtureCorpus();
    const full = jsonRecord(fixture, []);
    const redacted = jsonRecord(fixture, ["--redacted"]);

    // The full record is host-local and DOES carry the manifest — that is the object the redacted form must
    // be a safe projection of.
    expect(full.redacted).toBe(false);
    const manifestPaths = (full.manifest as Array<{ entries: Array<{ path: string }> }>).flatMap((root) => root.entries.map((entry) => entry.path));
    expect(manifestPaths.length).toBe(fixture.files);
    expect(manifestPaths.join("\n")).toContain("PRIVATE-SOAK-REPORT-9182736.json");

    // The redacted record carries no manifest at all…
    expect(redacted.redacted).toBe(true);
    expect(redacted.manifest).toBeUndefined();

    // …and none of the distinctive names, content markers or absolute paths survive anywhere in it.
    const text = JSON.stringify(redacted);
    for (const marker of [
      "PRIVATE-SOAK-REPORT-9182736", "OWNER-SESSION-ABC123", "SECRET-PROJECT-HEALTH-TRACKER",
      "owner-private-config", "PRIVATE-NESTED-FIXTURE", "deeper", "host-soak", "sessions",
      "OWNER_PRIVATE_CONFIG_CONTENT", "PRIVATE_SOAK_REPORT_CONTENT", "PRIVATE_SESSION_TRANSCRIPT_CONTENT",
      "PRIVATE_PROJECT_HISTORY_CONTENT", fixture.root.replace(/\\/g, "\\\\")
    ]) {
      expect(text, `the redacted record leaked ${marker}`).not.toContain(marker);
    }

    // What it DOES carry is the aggregate a reader can judge, and the commitment that lets a corpus holder
    // prove the aggregate was not invented.
    expect(redacted.corpus.totalFiles).toBe(fixture.files);
    expect(redacted.corpus.totalBytes).toBeGreaterThan(0);
    expect(redacted.corpus.commitmentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(redacted.corpus.perRoot.map((root: { root: string }) => root.root).sort()).toEqual([...PROJECT_ROOTS].sort());
  });

  it("D. declares schema 2, which is what makes the removal a stated fact rather than a silence", () => {
    const fixture = fixtureCorpus();
    const record = jsonRecord(fixture, ["--redacted"]);
    expect(record.schemaVersion).toBe(2);
    expect("labels" in record.runner).toBe(false);
    // A v2 record is not pretending to be v1-compatible: the field is gone, not renamed.
    expect(Object.keys(record.runner)).toEqual(["class", "name", "os"]);
  });

  it("E. keeps the corpus commitment independent of runner metadata", () => {
    const fixture = fixtureCorpus();
    const first = runReporter(fixture, ["--digest"], { RUNNER_NAME: "boss-real-soak", RUNNER_ENVIRONMENT: "self-hosted", RUNNER_LABELS: "forged-one" });
    const second = runReporter(fixture, ["--digest"], { RUNNER_NAME: "some-other-runner", RUNNER_ENVIRONMENT: "github-actions", RUNNER_LABELS: "forged-two,forged-three" });
    const third = runReporter(fixture, ["--digest"], {});

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(third.status).toBe(0);
    const digestOf = (run: Invocation): string => run.stdout.trim();
    expect(digestOf(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(digestOf(second)).toBe(digestOf(first));
    expect(digestOf(third)).toBe(digestOf(first));

    // And the same value is what the full record publishes, so the two views cannot disagree.
    const record = jsonRecord(fixture, []);
    expect(record.corpus.commitmentDigest).toBe(digestOf(first));
    expect(record.corpus.commitmentAlgorithm).toContain("root\\0path\\0size");
  });
});
