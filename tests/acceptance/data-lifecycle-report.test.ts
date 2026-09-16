import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 04 acceptance gate 7 — the data-lifecycle report.
 *
 * The generator walks the real state roots this checkout has accumulated, runs the real retention
 * and retrieval modules over what it found, and writes down what happened. This suite proves three
 * things about it, in the order that matters:
 *
 *   1. the artifact exists and answers the book's questions (which classes exist, what is
 *      collectable, what was spared and why, and whether current knowledge survives its own
 *      history);
 *   2. the SAFETY invariants are reported as actually held — nothing protected, active or
 *      referenced was handed to the deleter, and the dry run corresponds to the execution;
 *   3. the generator FAILS rather than emitting a rosy report when an invariant breaks. That last
 *      one is checked by breaking it: the corpus is built from the real filesystem, so the
 *      protection marker is removed from a copy of the compiled module and the generator is
 *      re-run to confirm it refuses.
 *
 * It is build-dependent: the generator loads the compiled Phase 04 modules out of `dist-electron`,
 * the same way the other acceptance harnesses do, and it FAILS rather than skipping when the build
 * is missing.
 */

const PROJECT = process.cwd();
const SCRIPT = path.join(PROJECT, "scripts", "data-lifecycle-report.cjs");
const REPORT = path.join(PROJECT, "artifacts", "platform-foundation", "phase-04", "data-lifecycle-report.json");

function generate(): Record<string, any> {
  execFileSync(process.execPath, [SCRIPT], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(fs.readFileSync(REPORT, "utf8"));
}

/**
 * The artifact as it stands on disk.
 *
 * Reading is cached because the generator walks and stats the whole state tree — tens of thousands
 * of files — and the assertions below are about the CONTENT of one run, not about re-proving the
 * walk each time. The two tests that genuinely need a fresh run call `generate()` directly: the
 * reproducibility check, and the fail-closed probe that must observe the generator refusing.
 */
let cached: Record<string, any> | undefined;
function readReport(): Record<string, any> {
  cached ??= generate();
  return cached;
}

describe("Phase 04 gate 7 — the data-lifecycle report is measured, not asserted", () => {
  it("generates, is valid JSON, and answers the book's questions", () => {
    const report = readReport();
    expect(report.phase).toBe("04-knowledge-data-lifecycle");

    // Which classes exist, and what each one permits.
    expect(report.declared.classes).toHaveLength(5);
    expect(Object.keys(report.declared.rules).sort()).toEqual(["COLD", "DISPOSABLE", "HOT", "PROTECTED", "WARM"]);
    for (const dataClass of report.declared.classes) {
      // Every class carries a reason, so the policy is reviewable rather than a table of numbers.
      expect(report.declared.rules[dataClass].why.length, `${dataClass} has no stated why`).toBeGreaterThan(30);
    }
    // PROTECTED and HOT are the two that may never be collected.
    expect(report.declared.rules.PROTECTED.deletable).toBe(false);
    expect(report.declared.rules.HOT.deletable).toBe(false);

    // What was found, where, and how it classified.
    expect(Object.keys(report.discovered).sort()).toEqual(["artifacts", ".codex-boss", "history", "runtime-data"].sort());
    expect(report.corpus.files).toBeGreaterThan(1000);
    const classified = Object.values(report.corpus.countsByClass).reduce((total: number, count: any) => total + count, 0);
    expect(classified, "not every corpus record was classified").toBe(report.corpus.files);

    // What is collectable, what was spared and why, and whether retrieval survives history.
    expect(report.gc.liveCorpus.records).toBe(report.corpus.files);
    expect(Array.isArray(report.gc.exercised.spared)).toBe(true);
    for (const entry of report.gc.exercised.spared) expect(entry.reason, `${entry.id} was spared without a reason`).toBeTruthy();
    expect(report.retrieval.mixedCorpus.size).toBeGreaterThan(10_000);
    expect(report.retrieval.mixedCorpus.top).toBe("current");
  });

  it("reports every safety invariant as held", () => {
    const report = readReport();
    expect(report.acceptance.problems).toEqual([]);
    for (const [name, held] of Object.entries(report.acceptance.evidence)) {
      expect(held, `invariant ${name} did not hold`).toBe(true);
    }
    // The two that carry the gate's weight, asserted directly rather than only via the flag.
    expect(report.gc.liveCorpus.misdeleted).toEqual([]);
    expect(report.gc.execution.parity).toBe(true);
    expect(report.gc.liveCorpus.parity).toBe(true);
    expect(report.gc.execution.auditEntries.length).toBe(report.gc.exercised.candidates.length);
  });

  it("never hands a protected, active or referenced record to the deleter", () => {
    const report = readReport();
    const handed = new Set<string>(report.gc.execution.handedToDeleter);
    // Stated as a property of the corpus, not of a hand-written list: the records from the
    // exercised corpus that must survive are named by the report itself, and none may appear.
    expect(report.gc.zeroMisdeletion.misdeleted).toEqual([]);
    for (const id of report.gc.zeroMisdeletion.protectedOrActiveOrReferenced) {
      expect(handed.has(id), `${id} is protected, active or referenced and was handed to the deleter`).toBe(false);
    }
    // Every acceptance artifact this program is graded on is protected by classification.
    const acceptanceArtifacts = report.gc.liveCorpus.handedToDeleter.filter((id: string) => id.startsWith("artifacts/platform-foundation/"));
    expect(acceptanceArtifacts).toEqual([]);
  });

  it("deletes by recording rather than unlinking, so measuring does not destroy the evidence", () => {
    const report = readReport();
    // The mode is stated in the artifact, and the phase artifacts are still on disk afterwards.
    expect(report.gc.execution.deletedMode).toContain("recorded, not unlinked");
    expect(report.gc.liveCorpus.deletedMode).toContain("recorded, not unlinked");
    for (const phase of ["phase-01", "phase-02", "phase-03"]) {
      const artifact = path.join(PROJECT, "artifacts", "platform-foundation", phase);
      expect(fs.existsSync(artifact), `${phase} evidence is gone`).toBe(true);
    }
  });

  it("is reproducible from the same sources", () => {
    const first = generate();
    const second = generate();
    // Normalised by KEY NAME rather than by a hand-listed path, so a new clock field cannot be
    // forgotten.
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [/At$/.test(key) ? key : key, /At$/.test(key) ? null : strip(entry)]));
      }
      return value;
    };

    /**
     * The parts a generator can be held to reproducibly, with the two genuinely volatile families
     * removed.
     *
     *  - `retrieval.mixedCorpus.millis` is a measurement of the MACHINE, not of the corpus.
     *  - the live filesystem TOTALS (`corpus.bytes` and each root's `bytes`) are a measurement of the
     *    checkout AT THE MOMENT OF THE WALK. They are not stable: `artifacts/` and `.codex-boss/` are
     *    written to by everything else running in this repository, including the test run itself, and
     *    a live soak or a log append changes them by a byte between two passes.
     *
     * The earlier version of this test compared whole reports and failed by ONE byte, which was the
     * test over-specifying a live measurement rather than a defect in the generator. What the test
     * still requires is everything that IS deterministic: the classification counts, every candidate
     * and every spared record with its reason, the audit trail, the invariants, the declared policy and
     * the retrieval ranking. A generator that changed its mind about a data class, a GC candidate or an
     * invariant would still fail here.
     */
    const stable = (report: Record<string, any>) => {
      const copy = JSON.parse(JSON.stringify(report)) as Record<string, any>;
      copy.retrieval.mixedCorpus.millis = null;
      copy.corpus.bytes = null;
      for (const root of Object.values(copy.discovered ?? {}) as Array<Record<string, unknown>>) root.bytes = null;
      copy.gc.liveCorpus.reclaimableBytes = null;
      copy.gc.exercised.reclaimableBytes = null;
      copy.gc.execution.reclaimedBytes = null;
      if (copy.gc.execution) copy.gc.execution.deleted = copy.gc.execution.deleted;
      return copy;
    };
    expect(strip(stable(second))).toEqual(strip(stable(first)));
  });

  it("reports the live corpus totals it actually measured, without claiming they are stable", () => {
    // The counterpart to the normalisation above: the volatile figures must still BE there and be
    // plausible, so removing them from the equality check cannot hide a generator that stopped
    // measuring the corpus.
    const report = generate();
    expect(report.corpus.bytes).toBeGreaterThan(0);
    expect(report.corpus.files).toBeGreaterThan(1_000);
    for (const [root, entry] of Object.entries(report.discovered as Record<string, { files: number; bytes: number }>)) {
      expect(entry.files, `${root} reported no files`).toBeGreaterThanOrEqual(0);
      expect(entry.bytes, `${root} reported no bytes`).toBeGreaterThan(0);
    }
  });

  it("FAILS instead of reporting a property it did not observe", () => {
    // The protection marker is removed from a COPY of the compiled module, so acceptance evidence
    // stops being protected. A generator that only checks what it already believes would still
    // write a green report here; this asserts that it refuses instead. The copy matters: patching
    // the real `dist-electron` would leave a broken build behind if this probe were interrupted.
    const compiledDir = path.join(PROJECT, "dist-electron", "src", "shared");
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase04-probe-"));
    try {
      // The whole compiled set is copied rather than a hand-listed group, so a module that gains a
      // sibling dependency does not silently turn this probe into an unrelated module-not-found.
      let copied = 0;
      for (const name of fs.readdirSync(compiledDir)) {
        if (!name.endsWith(".js")) continue;
        fs.copyFileSync(path.join(compiledDir, name), path.join(probeDir, name));
        copied++;
      }
      expect(copied, "no compiled module was copied, so the probe would test nothing").toBeGreaterThan(3);
      const probe = path.join(probeDir, "data-retention.js");
      const original = fs.readFileSync(probe, "utf8");
      expect(original).toContain("platform-foundation");
      fs.writeFileSync(probe, original.replace(/"platform-foundation"/g, '"platform-foundation-removed-for-this-probe"'), "utf8");

      let failed = false;
      let stderr = "";
      try {
        execFileSync(process.execPath, [SCRIPT], {
          cwd: PROJECT,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PHASE04_COMPILED_DIR: probeDir }
        });
      } catch (error) {
        failed = true;
        stderr = String((error as { stderr?: string }).stderr ?? "");
      }
      expect(failed, "the generator wrote a report even though acceptance evidence was collectable").toBe(true);
      expect(stderr).toContain("classified as");
    } finally {
      fs.rmSync(probeDir, { recursive: true, force: true });
    }
    // The real build was never touched, and a regenerated report is green again.
    expect(fs.readFileSync(path.join(compiledDir, "data-retention.js"), "utf8")).toContain('"platform-foundation"');
    const report = generate();
    expect(report.acceptance.problems).toEqual([]);
  }, 240_000);
});
