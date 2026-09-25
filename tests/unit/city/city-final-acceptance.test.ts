import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §30 — the final-city acceptance suite over §33's completion definition, and the falsification of its gate.
 *
 * THE DESIGN POINT
 *
 *   Section 33 enumerates the conditions for completion (nine Governance, fourteen Structure, five Evidence, six
 *   Final-main); section 30 enumerates what must run, and adds the rule that governs the exercise: "No final result
 *   may depend solely on a local run." Until this program existed, "are we done?" was a reading exercise over two
 *   documents -- which is how section 30's bridge expiry validator went unwritten for a whole programme.
 *
 *   Three statuses, and the difference between them is the whole design: PASS is machine-verified, OPEN is
 *   machine-verified as NOT satisfied and always blocks, and UNVERIFIED is what the tree cannot decide. UNVERIFIED
 *   blocks too, UNLESS the run is made with `--attest` AND the final acceptance record exists -- because the
 *   workbook's own vehicle for an Owner attestation is that record. `--attest` without the record granting anything
 *   is the case worth pinning in a test rather than explaining in a document.
 */

const PROJECT = process.cwd();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const acceptance = require(path.join(PROJECT, "scripts", "city-final-acceptance.cjs")) as {
  checklist: (root?: string, options?: Record<string, unknown>) => Item[];
  decideSeal: (items: Item[], options?: { attest?: boolean; recordExists?: boolean }) => Decision;
  summarise: (items: Item[]) => { counts: Record<string, number> };
  render: (report: unknown) => string;
  SECTION_ORDER: string[];
  STATUSES: { PASS: string; OPEN: string; UNVERIFIED: string };
  FINAL_STATUS: string;
};

type Item = { section: string; id: string; text: string; status: string; evidence: string };
type Decision = { ready: boolean; blocking: number; attested: boolean; counts: Record<string, number> };

/** §33's four blocks, counted from the workbook's own checklist. */
const EXPECTED_SECTIONS: Record<string, number> = { GOVERNANCE: 9, STRUCTURE: 14, EVIDENCE: 5, FINAL_MAIN: 6 };

/**
 * The checklist for this tree, computed ONCE. Every `checklist()` call spawns the eight city instruments, so calling
 * it per case would spend half a minute re-measuring the same tree eight times -- and a suite that is slow for no
 * reason is a suite that gets skipped.
 */
const ITEMS = acceptance.checklist(PROJECT, {});

function item(items: Item[], id: string): Item {
  const found = items.find((entry) => entry.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
}

describe("§30 the acceptance suite enumerates §33 completely, and says what it cannot check", () => {
  it("carries every item of all four blocks, with unique ids and substantive text", () => {
    const items = ITEMS;
    expect(items).toHaveLength(Object.values(EXPECTED_SECTIONS).reduce((sum, count) => sum + count, 0));
    for (const [section, count] of Object.entries(EXPECTED_SECTIONS)) {
      expect(items.filter((entry) => entry.section === section), section).toHaveLength(count);
    }
    expect(new Set(items.map((entry) => entry.id)).size).toBe(items.length);
    for (const entry of items) {
      expect(entry.text.length, entry.id).toBeGreaterThan(15);
      expect(Object.values(acceptance.STATUSES), entry.id).toContain(entry.status);
      // Every item explains itself: a checklist entry with no evidence is an assertion.
      expect(entry.evidence.length, entry.id).toBeGreaterThan(15);
    }
  });

  it("reports the items that §30 forbids a local run from settling as UNVERIFIED", () => {
    const items = ITEMS;
    // "No final result may depend solely on a local run": without --hosted and --main-sha, the hosted checks cannot
    // be read, and the harness must say so rather than pass them.
    expect(item(items, "F2").status).toBe(acceptance.STATUSES.UNVERIFIED);
    expect(item(items, "F1").status).toBe(acceptance.STATUSES.UNVERIFIED);
    expect(item(items, "F2").evidence).toContain("solely on a local run");
    // And the two that no working tree can decide are reported as such rather than passed.
    expect(item(items, "E1").status).toBe(acceptance.STATUSES.UNVERIFIED);
    expect(item(items, "E4").status).toBe(acceptance.STATUSES.UNVERIFIED);
    expect(item(items, "E4").evidence).toContain("ERASURE cannot be disproved");
  });

  it("decides OPEN from the artifact, not from hope: the road item is verified and the structural ones are not", () => {
    const items = ITEMS;
    // §33's "shared roads are explicitly classified" is machine-satisfiable and IS satisfied: every leaf a kernel
    // imports across a boundary is either declared a road or refused as one.
    expect(item(items, "S7").status).toBe(acceptance.STATUSES.PASS);
    expect(item(items, "S7").evidence).toContain("declared a road or refused as one");
    // The structural targets are measured, and the evidence carries the measurement.
    for (const [id, needle] of [["S2", "target 0"], ["S3", "target 0"], ["S5", "target 0"]] as Array<[string, string]>) {
      expect(item(items, id).status, id).toBe(acceptance.STATUSES.OPEN);
      expect(item(items, id).evidence, id).toContain(needle);
    }
    expect(item(items, "S12").status).toBe(acceptance.STATUSES.OPEN);
    expect(item(items, "S12").evidence).toContain("P2-G");
  });

  it("finds each REQUIRED artifact missing in a root that does not have it", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "city-acceptance-"));
    try {
      const items = acceptance.checklist(empty, {});
      // The file-existence items must report OPEN rather than assume: this is the path that would have caught
      // section 30's unwritten bridge validator.
      for (const id of ["E3", "E5", "G9", "G7"]) {
        expect(item(items, id).status, id).toBe(acceptance.STATUSES.OPEN);
      }
      expect(item(items, "E5").evidence).toContain("FINAL_ACCEPTANCE_RECORD");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("renders a verdict and never claims the final status while anything blocks", () => {
    const items = ITEMS;
    const decision = acceptance.decideSeal(items, {});
    const text = acceptance.render({ items, ...decision });
    expect(decision.ready).toBe(false);
    expect(decision.blocking).toBeGreaterThan(0);
    expect(text).toContain("VERDICT=NOT_READY");
    expect(text).not.toContain(acceptance.FINAL_STATUS);
  });
});

describe("§30 the seal decision, falsified in both directions", () => {
  const make = (statuses: string[]): Item[] => statuses.map((status, index) => ({ section: "STRUCTURE", id: `X${index}`, text: `item ${index} text`, status, evidence: `evidence for item ${index}` }));

  it("is ready only when nothing is OPEN and nothing is unverifiable", () => {
    const ready = acceptance.decideSeal(make(["PASS", "PASS"]), {});
    expect(ready.ready).toBe(true);
    expect(ready.blocking).toBe(0);
  });

  it("is blocked by a single OPEN item, whatever else passes", () => {
    const decision = acceptance.decideSeal(make(["PASS", "PASS", "OPEN"]), { attest: true, recordExists: true });
    expect(decision.ready).toBe(false);
    expect(decision.blocking).toBe(1);
  });

  it("is blocked by UNVERIFIED unless BOTH --attest and the final acceptance record are present", () => {
    const items = make(["PASS", "UNVERIFIED"]);
    expect(acceptance.decideSeal(items, {}).ready).toBe(false);
    // --attest alone grants nothing: the record IS the attestation vehicle.
    expect(acceptance.decideSeal(items, { attest: true, recordExists: false }).ready).toBe(false);
    expect(acceptance.decideSeal(items, { attest: false, recordExists: true }).ready).toBe(false);
    const both = acceptance.decideSeal(items, { attest: true, recordExists: true });
    expect(both.ready).toBe(true);
    expect(both.attested).toBe(true);
    expect(both.blocking).toBe(0);
  });

  it("counts the three statuses it claims to count", () => {
    const decision = acceptance.decideSeal(make(["PASS", "PASS", "OPEN", "UNVERIFIED"]), {});
    expect(decision.counts).toEqual({ PASS: 2, OPEN: 1, UNVERIFIED: 1 });
    expect(decision.blocking).toBe(2);
  });
});
