import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HARDENING_SCENARIOS } from "../../src/shared/hardening-matrix";

/**
 * Phase J — the hardening matrix's coverage claims are checked, not asserted.
 *
 * Every scenario row names what exercises it. Measured before this test existed: 24
 * of the 29 referenced names resolved to a source MODULE rather than a test suite
 * (the field's docblock said "test suite", which was wrong), and **five resolved to
 * nothing at all** — `recovery-closure`, `review-gate`, `provider-view-navigation`,
 * `cli-process-recovery` and `delivery-integration`. A dangling name is a coverage
 * claim nobody can check, which is worse than an honest gap.
 *
 * The rule this test enforces: an entry must name something that EXISTS — a test
 * file, a source module, or a driver script. Renaming a suite or a module therefore
 * breaks this test rather than quietly turning the matrix into fiction.
 */

const PROJECT = process.cwd();

function treeUnder(relative: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      found.push(entry.name.toLowerCase());
    }
  };
  if (fs.existsSync(path.join(PROJECT, relative))) walk(path.join(PROJECT, relative));
  return found;
}

const TEST_FILES = treeUnder("tests");
const SOURCE_FILES = [...treeUnder("electron"), ...treeUnder("src")];
const DRIVERS = treeUnder("scripts");

function resolves(name: string): { test: boolean; module: boolean; driver: boolean } {
  const key = name.toLowerCase();
  return {
    test: TEST_FILES.some((file) => file.includes(key)),
    module: SOURCE_FILES.some((file) => file.includes(key)),
    driver: DRIVERS.some((file) => file.includes(key))
  };
}

describe("Phase J — the hardening matrix's coverage claims", () => {
  it("resolves every referenced name against the tree", () => {
    const dangling: string[] = [];
    for (const scenario of HARDENING_SCENARIOS) {
      for (const name of scenario.suite) {
        const found = resolves(name);
        if (!found.test && !found.module && !found.driver) dangling.push(`${scenario.id} → ${name}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("names something for every scenario that is not live-only, and says why for those that are", () => {
    for (const scenario of HARDENING_SCENARIOS) {
      if (scenario.coverage === "live") {
        expect(scenario.suite, `${scenario.id} is live-only and should name no suite`).toEqual([]);
        expect(scenario.reason, `${scenario.id} is live-only and must say why it is not run in CI`).toBeTruthy();
        continue;
      }
      expect(scenario.suite.length, `${scenario.id} claims coverage but names nothing`).toBeGreaterThan(0);
      expect(scenario.reason ?? "", `${scenario.id} is not live-only, so it needs no excuse`).toBe("");
    }
  });

  it("keeps the matrix's own vocabulary complete", () => {
    // The scenarios the plan lists, so a row cannot be dropped silently.
    const ids = HARDENING_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    for (const required of ["provider-outage", "network-loss", "harness-crash", "browser-crash", "boss-restart", "storage-failure", "rollback", "secret-tainted-log"]) {
      expect(ids).toContain(required);
    }
  });
});
