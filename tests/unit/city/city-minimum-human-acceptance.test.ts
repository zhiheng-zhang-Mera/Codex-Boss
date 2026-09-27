import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CC-103 D2 — the minimum-human-acceptance profile, and the falsification of its floors.
 *
 * THE DESIGN POINT
 *
 *   The strict full-city gate answers "does the city meet the whole Phase-2 contract", and it is still
 *   red because S2/S3/S4/S10/S14 are not at their historical zero targets. CC-103 D2 added a SECOND,
 *   narrower checkpoint — the smallest honest human gate reachable without another bulk rewiring
 *   programme — and the whole risk of such a gate is that it becomes a way of calling debt finished.
 *
 *   So the floors are falsified here in both directions: the exact frozen value is accepted, +1 is
 *   rejected, an improvement is accepted, and every number is compared against a strict target as well
 *   as a floor so the report can say RATCHETED_ACCEPTED rather than PASS. The last case proves the
 *   STRICT gate was not quietly loosened to make this one possible: it still measures against zero.
 *
 *   `measure()` is not called here. The floors are decided over a SYNTHETIC measurement built from the
 *   real committed profile, so a test can put a metric one above its floor without editing the
 *   repository — and the real measurement is what `scripts/city-minimum-human-acceptance.cjs` itself
 *   reports.
 */

const PROJECT = process.cwd();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const gate = require(path.join(PROJECT, "scripts", "city-minimum-human-acceptance.cjs")) as Gate;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const strict = require(path.join(PROJECT, "scripts", "city-final-acceptance.cjs")) as Strict;

type Status = "PASS" | "RATCHETED_ACCEPTED" | "ACCEPTED_PERMANENT" | "UNVERIFIED" | "BLOCKING";
/**
 * `status` is a plain string rather than the closed `Status` union because these items come from TWO
 * gates: this profile's statuses, and the strict gate's `PASS`/`OPEN`/`UNVERIFIED`. Pinning the field
 * to one gate's vocabulary would make the strict gate's items unrepresentable here, and the case that
 * matters most is precisely the one that reads both.
 */
type Item = { section: string; id: string; text: string; status: string; evidence: string; measured?: number | null; floor?: number | null; strictTarget?: number | null };
type Measurement = {
  profile: { floors: Record<string, number>; strict_targets: Record<string, number>; accepted_debt_statuses: string[]; required_hosted_checks: string[]; decision: string };
  metrics: Record<string, number | null>;
  gates: Record<string, { pass: boolean; detail: string }>;
  debt: { ids: string[]; entries: Array<{ id: string; status: string }>; unsettled: Array<{ id: string; status: string }>; settled: Array<{ id: string; status: string }> };
  decisionRecordExists?: boolean;
};
type Context = { hosted?: boolean; mainSha?: string | null; hostedChecks?: Array<{ name: string; status: string; conclusion: string }> | null; headSha?: string | null; dirty?: boolean | null; decisionRecordExists?: boolean };
type Decision = { items: Item[]; ready: boolean; blocking: string[]; counts: Record<string, number>; strictTargetsMet: boolean; strictTargetsNotMet: string[] };
type Gate = {
  measure: (root?: string) => Measurement;
  evaluate: (measurement: Measurement, context?: Context) => Decision;
  render: (report: Record<string, unknown>) => string;
  ratchetStatus: (measured: number | null, floor: number, strictTarget: number) => Status;
  debtStatuses: (text: string) => { ids: string[]; entries: Array<{ id: string; status: string }>; unsettled: Array<{ id: string; status: string }>; settled: Array<{ id: string; status: string }> };
  PROFILE: string;
  STATUSES: Record<string, Status>;
  ACCEPTED_STATUSES: Status[];
};
type Strict = {
  checklist: (root?: string, options?: Record<string, unknown>) => Item[];
  decideSeal: (items: Item[], options?: { attest?: boolean; recordExists?: boolean }) => { ready: boolean; blocking: number };
  debtStatuses: (text: string) => { ids: string[]; entries: Array<{ id: string; status: string }>; unsettled: Array<{ id: string; status: string }>; settled: Array<{ id: string; status: string }> };
  STATUSES: { PASS: string; OPEN: string; UNVERIFIED: string };
  SECTION_ORDER: string[];
};

/** The COMMITTED profile, read the same way the gate reads it. */
const PROFILE = JSON.parse(fs.readFileSync(path.join(PROJECT, gate.PROFILE), "utf8")) as Measurement["profile"];

const SHA = "bf45476bb111602efe0c1811bf86d1b9aaf0da18";
const GATE_KEYS = ["closure", "ledgerProvenance", "legacyRatchet", "roads", "core", "flatness", "enforcement", "rootTrust"];
/** The five structural metrics whose floor is ABOVE their strict target: the ratcheted ones. */
const RATCHETED = ["kernel_to_feature_file_edges", "kernel_to_feature_distinct_pairs", "mutual_capability_pairs", "largest_scc_size", "migration_in_progress"];

/** A measurement that sits exactly ON every frozen floor, with every gate green and no open debt. */
function atFloors(overrides: { metrics?: Record<string, number | null>; debt?: Partial<Measurement["debt"]>; gates?: Record<string, { pass: boolean; detail: string }>; decisionRecordExists?: boolean } = {}): Measurement {
  const gates: Record<string, { pass: boolean; detail: string }> = {};
  for (const key of GATE_KEYS) gates[key] = { pass: true, detail: `${key} is clean` };
  return {
    profile: PROFILE,
    metrics: { ...PROFILE.floors, machine_ratchet: 0, ...(overrides.metrics ?? {}) },
    gates: { ...gates, ...(overrides.gates ?? {}) },
    debt: {
      ids: ["CITY-DEBT-005", "CITY-DEBT-006"],
      entries: [{ id: "CITY-DEBT-005", status: "CLOSED" }, { id: "CITY-DEBT-006", status: "ACCEPTED_PERMANENT" }],
      unsettled: [],
      settled: [{ id: "CITY-DEBT-005", status: "CLOSED" }, { id: "CITY-DEBT-006", status: "ACCEPTED_PERMANENT" }],
      ...(overrides.debt ?? {})
    },
    decisionRecordExists: overrides.decisionRecordExists ?? true
  };
}

const GREEN_CONTEXT: Context = {
  hosted: true,
  mainSha: SHA,
  headSha: SHA,
  dirty: false,
  decisionRecordExists: true,
  hostedChecks: PROFILE.required_hosted_checks.map((name) => ({ name, status: "completed", conclusion: "success" }))
};

function item(items: Item[], id: string): Item {
  const found = items.find((entry) => entry.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
}

describe("CC-103 D2 — the minimum profile accepts exactly the frozen floor", () => {
  it("accepts the exact floor for every metric, and reports the ratcheted ones as RATCHETED_ACCEPTED", () => {
    const decision = gate.evaluate(atFloors(), GREEN_CONTEXT);
    expect(decision.blocking, JSON.stringify(decision.blocking)).toEqual([]);
    expect(decision.ready).toBe(true);
    for (const [key, floor] of Object.entries(PROFILE.floors)) {
      const id = { kernel_to_feature_file_edges: "S2", kernel_to_feature_distinct_pairs: "S2b", mutual_capability_pairs: "S3", largest_scc_size: "S4", migration_in_progress: "S10", confirmed_cross_domain_accesses: "S5", multi_writer_candidates: "S6", road_edges_leaving_a_road: "S7", unsafe_gap: "S9", expired_bridge: "S11", not_guarded: "S14", architecture_enforcement_violations: "G4" }[key];
      expect(id, `the profile has a floor for ${key} that no item reads`).toBeDefined();
      const entry = item(decision.items, id as string);
      expect(entry.status, `${id} at the exact floor ${floor}`).not.toBe(gate.STATUSES.BLOCKING);
      expect(gate.ACCEPTED_STATUSES, id).toContain(entry.status);
    }
    // The distinction that keeps this checkpoint honest: a metric ON its floor but above the strict
    // target is RATCHETED_ACCEPTED and carries BOTH numbers, so a reader sees it is not at target.
    for (const key of RATCHETED) {
      const id = { kernel_to_feature_file_edges: "S2", kernel_to_feature_distinct_pairs: "S2b", mutual_capability_pairs: "S3", largest_scc_size: "S4", migration_in_progress: "S10" }[key] as string;
      const entry = item(decision.items, id);
      expect(entry.status, `${id} at its floor`).toBe(gate.STATUSES.RATCHETED_ACCEPTED);
      expect(entry.measured, id).toBe(PROFILE.floors[key]);
      expect(entry.floor, id).toBe(PROFILE.floors[key]);
      expect(entry.strictTarget, id).toBe(PROFILE.strict_targets[key]);
      expect(entry.evidence, id).toContain("NOT at the strict full-city target");
    }
    expect(decision.strictTargetsMet).toBe(false);
    expect(decision.strictTargetsNotMet.join(" ")).toContain("S2 49>0");
  });

  it("rejects one step above EVERY ratcheted floor, and accepts an improvement below it", () => {
    for (const key of RATCHETED) {
      const regressed = gate.evaluate(atFloors({ metrics: { [key]: PROFILE.floors[key] + 1 } }), GREEN_CONTEXT);
      expect(regressed.ready, `${key} at floor+1 was accepted`).toBe(false);
      expect(regressed.blocking.length, key).toBeGreaterThan(0);
      // And the item that blocks is the one that owns the metric, not an unrelated one.
      const ids = regressed.items.filter((entry) => entry.status === gate.STATUSES.BLOCKING).map((entry) => entry.measured);
      expect(ids, `${key} floor+1`).toContain(PROFILE.floors[key] + 1);
    }
    // "A metric may improve below these floors": improving is not a regression and must stay accepted.
    const improved = gate.evaluate(atFloors({ metrics: { kernel_to_feature_file_edges: PROFILE.floors.kernel_to_feature_file_edges - 4, mutual_capability_pairs: 0 } }), GREEN_CONTEXT);
    expect(improved.ready).toBe(true);
    expect(item(improved.items, "S3").status).toBe(gate.STATUSES.PASS);
  });
});

describe("CC-103 D2 — the two statuses that behave differently from the strict gate", () => {
  it("rejects a principle with no guard at all, and accepts one guarded by a ratchet", () => {
    const unguarded = gate.evaluate(atFloors({ metrics: { not_guarded: 1 } }), GREEN_CONTEXT);
    expect(unguarded.ready).toBe(false);
    expect(item(unguarded.items, "S14").status).toBe(gate.STATUSES.BLOCKING);

    // MACHINE_RATCHET is the case D2 names explicitly: a ratchet IS a machine, so it does not block --
    // and it is still never reported as a pass.
    const ratcheted = gate.evaluate(atFloors({ metrics: { machine_ratchet: 2 } }), GREEN_CONTEXT);
    expect(ratcheted.ready).toBe(true);
    expect(item(ratcheted.items, "S14r").status).toBe(gate.STATUSES.RATCHETED_ACCEPTED);
    expect(item(ratcheted.items, "S14r").status).not.toBe(gate.STATUSES.PASS);
    expect(item(ratcheted.items, "S14r").evidence).toContain("does not block the minimum profile");
  });

  it("accepts CITY-DEBT-006 = ACCEPTED_PERMANENT and rejects it OPEN", () => {
    const accepted = gate.evaluate(atFloors(), GREEN_CONTEXT);
    expect(item(accepted.items, "D1").status).toBe(gate.STATUSES.ACCEPTED_PERMANENT);
    expect(accepted.ready).toBe(true);

    const open = gate.evaluate(atFloors({
      debt: {
        unsettled: [{ id: "CITY-DEBT-006", status: "OPEN" }],
        settled: [{ id: "CITY-DEBT-005", status: "CLOSED" }]
      }
    }), GREEN_CONTEXT);
    expect(open.ready).toBe(false);
    expect(item(open.items, "D1").status).toBe(gate.STATUSES.BLOCKING);
    // A blocked debt item must NAME the debt, not merely count it.
    expect(item(open.items, "D1").evidence).toContain("CITY-DEBT-006");

    // A status outside the accepted set is the same failure as OPEN: CONTAINED is not a disposition
    // this profile accepts, so it may not slip through by not being called OPEN.
    const contained = gate.evaluate(atFloors({
      debt: { unsettled: [{ id: "CITY-DEBT-009", status: "CONTAINED" }], settled: [] }
    }), GREEN_CONTEXT);
    expect(contained.ready).toBe(false);
    expect(item(contained.items, "D1").evidence).toContain("CITY-DEBT-009");
  });

  it("rejects missing or red hosted evidence on the named SHA", () => {
    const local = gate.evaluate(atFloors(), { hosted: false, mainSha: null });
    expect(local.ready).toBe(false);
    expect(item(local.items, "E1").status).toBe(gate.STATUSES.UNVERIFIED);
    expect(item(local.items, "E1").evidence).toContain("may not rest on a local run");

    const red = gate.evaluate(atFloors(), {
      ...GREEN_CONTEXT,
      hostedChecks: PROFILE.required_hosted_checks.filter((name) => name !== "acceptance").map((name) => ({ name, status: "completed", conclusion: "success" }))
    });
    expect(red.ready).toBe(false);
    expect(item(red.items, "E1").status).toBe(gate.STATUSES.BLOCKING);
    expect(item(red.items, "E1").evidence).toContain("4 of 5 green");

    const failed = gate.evaluate(atFloors(), {
      ...GREEN_CONTEXT,
      hostedChecks: PROFILE.required_hosted_checks.map((name) => ({ name, status: "completed", conclusion: name === "unit" ? "failure" : "success" }))
    });
    expect(failed.ready).toBe(false);

    // A named SHA that is not this tree is not evidence about this tree.
    const otherSha = gate.evaluate(atFloors(), { ...GREEN_CONTEXT, headSha: "0".repeat(40) });
    expect(otherSha.ready).toBe(false);
    expect(item(otherSha.items, "E2").status).toBe(gate.STATUSES.BLOCKING);

    expect(gate.evaluate(atFloors(), GREEN_CONTEXT).ready).toBe(true);
  });
});

describe("CC-103 — the strict full-city gate is not loosened by the minimum profile", () => {
  const STRICT_ITEMS = strict.checklist(PROJECT, {});

  it("still carries section 33 whole, with the same four blocks and unique ids", () => {
    expect(STRICT_ITEMS.filter((entry) => entry.section === "GOVERNANCE")).toHaveLength(9);
    expect(STRICT_ITEMS.filter((entry) => entry.section === "STRUCTURE")).toHaveLength(14);
    expect(STRICT_ITEMS.filter((entry) => entry.section === "EVIDENCE")).toHaveLength(5);
    expect(STRICT_ITEMS.filter((entry) => entry.section === "FINAL_MAIN")).toHaveLength(6);
    expect(new Set(STRICT_ITEMS.map((entry) => entry.id)).size).toBe(STRICT_ITEMS.length);
  });

  it("still measures the structural targets against ZERO, not against the new floors", () => {
    // The whole risk of adding a second profile is that the strict one quietly inherits its bounds.
    // These assertions are about the MEANING of the strict gate, so they hold whether the metric is
    // currently at the target or not: the evidence must name the strict target, and the strict gate
    // must know nothing about a floor.
    expect(item(STRICT_ITEMS, "S2").evidence).toContain("target 0");
    expect(item(STRICT_ITEMS, "S3").evidence).toContain("target 0");
    expect(item(STRICT_ITEMS, "S4").evidence).toContain("target <= 1");
    expect(item(STRICT_ITEMS, "S10").evidence).toContain("MIGRATION_IN_PROGRESS");
    for (const id of ["S2", "S3", "S4", "S5", "S6", "S10", "S14"]) {
      expect(item(STRICT_ITEMS, id).evidence, id).not.toContain("frozen floor");
      expect([strict.STATUSES.PASS, strict.STATUSES.OPEN], id).toContain(item(STRICT_ITEMS, id).status);
    }
    // And a metric at zero is a PASS for the strict gate -- the target really is zero, not a ratchet.
    expect(item(STRICT_ITEMS, "S6").status).toBe(strict.STATUSES.PASS);
  });

  it("still decides its seal the same way, and still refuses this tree", () => {
    const seal = strict.decideSeal(STRICT_ITEMS, {});
    expect(seal.ready).toBe(false);
    // One OPEN item blocks even with an Owner attestation in place.
    expect(strict.decideSeal([{ section: "S", id: "X", text: "t", status: "OPEN", evidence: "e" }], { attest: true, recordExists: true }).ready).toBe(false);
    // UNVERIFIED blocks unless BOTH the attestation and the record exist.
    const unverified = [{ section: "S", id: "X", text: "t", status: "UNVERIFIED", evidence: "e" }];
    expect(strict.decideSeal(unverified, { attest: true, recordExists: false }).ready).toBe(false);
    expect(strict.decideSeal(unverified, { attest: true, recordExists: true }).ready).toBe(true);
    // The debt item's verdict and its own message still come from ONE reading of the register -- the
    // defect CC-056/CC-063 pinned, where a debt widened to `status OPEN (narrowed: ...)` was counted as
    // settled and the gate reported PASS beside a message saying a debt was open.
    const register = fs.readFileSync(path.join(PROJECT, "docs", "city", "CITY_RENOVATION_DEBT_REGISTER.md"), "utf8");
    const reading = strict.debtStatuses(register);
    const e2 = item(STRICT_ITEMS, "E2");
    expect(e2.status === strict.STATUSES.OPEN).toBe(reading.unsettled.length > 0);
    if (reading.unsettled.length > 0) for (const entry of reading.unsettled) expect(e2.evidence, entry.id).toContain(entry.id);
    expect(strict.debtStatuses("CITY-DEBT-009 ... status               OPEN (narrowed: only the direct path)").unsettled).toEqual([{ id: "CITY-DEBT-009", status: "OPEN" }]);
  });

  it("keeps the two gates' verdicts independent: the strict gate's answer does not move this one", () => {
    // A tree that satisfies the minimum profile can still be NOT_READY for the seal, and the minimum
    // gate must not import the strict verdict into its own.
    const minimum = gate.evaluate(atFloors(), GREEN_CONTEXT);
    expect(minimum.ready).toBe(true);
    expect(strict.decideSeal(STRICT_ITEMS, {}).ready).toBe(false);
    expect(gate.render({ items: minimum.items, counts: minimum.counts, ready: minimum.ready, blocking: minimum.blocking, strictTargetsMet: minimum.strictTargetsMet, strictTargetsNotMet: minimum.strictTargetsNotMet, profile: PROFILE })).toContain("STRICT_FULL_CITY_TARGETS = NOT_MET");
  });
});

describe("CC-103 — one reading of the renovation debt register", () => {
  it("is the same function the strict gate uses, so the two cannot drift", () => {
    expect(gate.debtStatuses).toBe(strict.debtStatuses);
    const reading = gate.debtStatuses("CITY-DEBT-001\nstatus CLOSED\nCITY-DEBT-002\nstatus OPEN (narrowed: x)\n");
    expect(reading.ids).toEqual(["CITY-DEBT-001", "CITY-DEBT-002"]);
    expect(reading.settled.map((entry) => entry.id)).toEqual(["CITY-DEBT-001"]);
    expect(reading.unsettled.map((entry) => entry.id)).toEqual(["CITY-DEBT-002"]);
  });
});
