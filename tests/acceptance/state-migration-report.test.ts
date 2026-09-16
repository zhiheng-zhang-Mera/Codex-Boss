import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Phase 02 acceptance gate 7 — the state migration report.
 *
 * The generator runs the decision-ledger pilot for real against a temporary data root and
 * records what happened. This suite proves two things about it:
 *
 *   1. the artifact exists and answers the book's three questions (which namespaces
 *      migrated, who is authoritative, what is still JSON);
 *   2. the ACCOUNTING IS COMPLETE — every namespace Phase 01 inventoried is classified
 *      exactly once, so a namespace cannot quietly vanish from the report and be
 *      indistinguishable from one that was migrated.
 *
 * It is build-dependent: the generator loads the compiled pilot from `dist-electron`, the
 * same way the other acceptance harnesses do, and it FAILS rather than skipping when the
 * build is missing.
 */

const PROJECT = process.cwd();
const SCRIPT = path.join(PROJECT, "scripts", "state-migration-report.cjs");
const REPORT = path.join(PROJECT, "artifacts", "platform-foundation", "phase-02", "state-migration-report.json");

function generate(): Record<string, any> {
  execFileSync(process.execPath, [SCRIPT], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(fs.readFileSync(REPORT, "utf8"));
}

describe("Phase 02 gate 7 — the migration report is measured, not asserted", () => {
  it("generates, is valid JSON, and answers the three questions", () => {
    const report = generate();
    expect(report.phase).toBe("02-durable-state-events");
    expect(report.summary.namespacesInventoried).toBeGreaterThan(25);
    expect(report.summary.duplicateOwners).toBe(0);
    // Which namespaces moved, who is authoritative, what is still JSON.
    const migrated = report.namespaces.filter((row: any) => row.storage === "database");
    const json = report.namespaces.filter((row: any) => row.storage === "json");
    expect(migrated.length).toBe(report.summary.migratedToDatabase);
    expect(json.length).toBe(report.summary.remainingJson);
    expect(migrated.length + json.length).toBe(report.namespaces.length);
    for (const row of report.namespaces) {
      expect(row.authoritativeSide, `${row.namespace} has no authoritative side`).toBeTruthy();
      expect(row.owner, `${row.namespace} has no owner`).toBeTruthy();
    }
  });

  it("classifies every Phase 01 namespace exactly once, so none can disappear", () => {
    const report = generate();
    const declared = report.namespaces.map((row: any) => row.namespace);
    expect(new Set(declared).size, "a namespace is listed twice").toBe(declared.length);

    // The Phase 01 registry is the inventory of record; the report must cover it exactly.
    // Parsed line by line rather than with a block regex, because the state entry shape is
    // `- namespace:` followed by `owner:` and a nested-block pattern silently matched only
    // the first few manifests.
    const owners = new Map<string, string>();
    const header = path.join(PROJECT, "config", "capabilities");
    for (const name of fs.readdirSync(header).filter((entry) => /\.(ya?ml)$/i.test(entry))) {
      const text = fs.readFileSync(path.join(header, name), "utf8");
      const id = /^id:[ \t]*(\S+)/m.exec(text)?.[1];
      if (!id) continue;
      let inState = false;
      for (const line of text.split(/\r?\n/)) {
        if (/^state:/.test(line)) { inState = true; continue; }
        if (/^[A-Za-z_]/.test(line)) { inState = false; continue; }
        if (!inState) continue;
        const namespace = /^[ \t]*-[ \t]*namespace:[ \t]*(\S+)/.exec(line)?.[1];
        const owner = /^[ \t]*owner:[ \t]*(\S+)/.exec(line)?.[1];
        if (namespace) owners.set(namespace, id);
        else if (owner) {
          const last = [...owners.keys()].pop();
          if (last) owners.set(last, owner);
        }
      }
    }
    expect(owners.size, "the manifest parse found no namespaces").toBeGreaterThan(25);

    const missing = [...owners.keys()].filter((namespace) => !declared.includes(namespace));
    expect(missing, "these inventoried namespaces are absent from the report").toEqual([]);
    for (const [namespace, owner] of owners) {
      const row = report.namespaces.find((entry: any) => entry.namespace === namespace);
      expect(row.owner, `${namespace} owner drifted from its manifest`).toBe(owner);
    }
  });

  it("records MEASURED pilot evidence rather than a claim", () => {
    const report = generate();
    const evidence = report.pilotEvidence;
    // The battery really ran and really agreed.
    expect(evidence.shadowBattery.allAgreed).toBe(true);
    expect(evidence.shadowBattery.decisions).toHaveLength(evidence.requiredCleanComparisons);
    expect(evidence.shadowBattery.consecutiveClean).toBe(evidence.requiredCleanComparisons);
    expect(evidence.shadowBattery.phaseBeforePromotion).toBe("ready-to-promote");
    // Promotion really happened and recorded its gate.
    expect(evidence.promotion.authority).toBe("database");
    expect(evidence.promotion.phase).toBe("migrated");
    expect(evidence.promotion.jsonSunset).toBeTruthy();
    // The baseline import really was idempotent.
    expect(evidence.baselineImport.imported).toBeGreaterThan(0);
    expect(evidence.baselineImport.idempotent).toBe(true);
    // The crash window really was detected and repaired.
    expect(evidence.crashWindow.eventPresentBeforeReconcile).toBe(false);
    expect(evidence.crashWindow.reEmitted).toBe(1);
    expect(evidence.crashWindow.repaired).toBe(true);
    // A deliberate divergence really was caught.
    expect(evidence.divergenceProbe.detected).toBe(true);
    expect(evidence.divergenceProbe.authorityAfterProbe).toBe("json");
    expect(evidence.integrity.ok).toBe(true);
  });

  it("is reproducible from the same sources", () => {
    const first = generate();
    const second = generate();
    // Only timestamps may differ. Normalised by KEY NAME rather than by field path, because
    // a hand-listed strip missed `pilotEvidence.promotion.promotedAt` and reported a
    // reproducibility failure that was really an unstripped clock reading.
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, /At$/.test(key) ? null : strip(entry)]));
      }
      return value;
    };
    expect(strip(second)).toEqual(strip(first));
    expect(second.summary).toEqual(first.summary);
  });

  it("reports the deferred pilot with a reason instead of hiding it", () => {
    const report = generate();
    const tasks = report.namespaces.find((row: any) => row.namespace === "tasks");
    expect(tasks.storage).toBe("json");
    expect(tasks.status).toBe("not-selected");
    // The reason must say why this candidate was deferred, so a reader can act on it.
    expect(tasks.reason).toMatch(/comparison battery|not migrated|forbids/i);
    expect(report.summary.pilotsDeferred).toBeGreaterThanOrEqual(1);
  });

  it("does not migrate the whole JSON set — the book forbids a sweep", () => {
    const report = generate();
    // One pilot completed, out of an inventory of thirty-odd namespaces. A report showing
    // most namespaces migrated would mean the phase did the thing it was told not to do.
    expect(report.summary.migratedToDatabase).toBeLessThanOrEqual(3);
    expect(report.summary.remainingJson).toBeGreaterThan(20);
  });
});
