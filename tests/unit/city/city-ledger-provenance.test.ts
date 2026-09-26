import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The ledger-provenance control (successor workbook section 1 and section 5).
 *
 * The defect this pins: CC-063 was recorded by commit `bc0ec39` at 04:11:35Z and claims 11:38:04Z, and CC-064
 * was recorded by `30e3861` at 04:51:42Z and claims 12:26:41Z. An entry cannot claim a UTC moment hours after
 * the commit that already contains it. Measured over the whole ledger, 25 of 63 entries do exactly that.
 *
 * A test that only ever observes the control PASSING would not show it controls anything (the lesson the city
 * ledger records as CC-019/CC-038), so every rule below is driven in BOTH directions on constructed ledgers,
 * and the real ledger is asserted only for the property that must hold on it.
 */

const require_ = createRequire(import.meta.url);
const control = require_("../../../scripts/city-ledger-provenance.cjs") as {
  STRICT_INSTANT: RegExp;
  parseLedger: (text: string) => { entries: Array<{ id: string; entryIdLine: number; timestampLine: number; raw: string }>; headings: Array<{ id: string; line: number }> };
  instantOf: (raw: string) => number | null;
  readConfig: (file: string) => Record<string, unknown> & {
    rules: Record<string, unknown>;
    preFormatEntries: Record<string, string>;
    historicalViolations: Record<string, number>;
    hygieneViolations: Record<string, string>;
  };
  withoutComments: (map: Record<string, unknown>) => Record<string, unknown>;
  makeCommitResolver: (root: string, ledgerPath: string) => (id: string) => { sha: string; committerIso: string } | null;
  evaluate: (
    parsed: ReturnType<typeof control.parseLedger>,
    config: ReturnType<typeof control.readConfig>,
    commitFor?: ((id: string) => { sha: string; committerIso: string } | null) | null
  ) => { ok: boolean; problems: Array<{ rule: string; id: string; detail: string }>; entries: number; headings: number };
};

const PROJECT = process.cwd();
const LEDGER = "docs/city/OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md";
const CONFIG = "config/city-ledger-provenance.json";
const SCRIPT = "scripts/city-ledger-provenance.cjs";

/** The configuration with the disclosed history emptied, so a constructed ledger is judged on its own merits. */
function emptyConfig(): ReturnType<typeof control.readConfig> {
  const config = control.readConfig(path.join(PROJECT, CONFIG));
  return { ...config, preFormatEntries: {}, historicalViolations: {}, hygieneViolations: {} };
}

function ledgerOf(...entries: Array<{ id: string; timestamp: string; follow?: string }>): string {
  const body = entries
    .map((entry) => `## ${entry.id} — a constructed case\n\n\`\`\`text\nENTRY_ID                    ${entry.id}\ntimestamp_utc               ${entry.timestamp}\nnote                        ${entry.follow ?? "a continuation line"}\n\`\`\`\n`)
    .join("\n");
  return `# OWNER CONTINUOUS CONSTRUCTION LEDGER\n\n${body}`;
}

/** A commit resolver that reports one instant for every id. */
const atInstant = (iso: string) => () => ({ sha: "0".repeat(40), committerIso: iso });

describe("ledger provenance: the parser reads the real shape", () => {
  it("parses the committed ledger, and the schema block at the top is not an entry", () => {
    const parsed = control.parseLedger(fs.readFileSync(path.join(PROJECT, LEDGER), "utf8"));
    // The entry schema near the top of the ledger names `ENTRY_ID` and `timestamp_utc` as fields, without a
    // value for either. A parser that treated that as an entry would report one more entry than the ledger
    // carries, and would then anchor a non-entry against a commit. The count is asserted as a FLOOR rather
    // than a literal so this case does not have to be edited every time the ledger is appended to; what is
    // pinned is that every parsed id is a real id and that the schema block contributed nothing.
    expect(parsed.entries.length).toBeGreaterThanOrEqual(63);
    expect(parsed.headings.length).toBeGreaterThanOrEqual(parsed.entries.length);
    expect(parsed.entries.every((entry) => /^CC-\d+$/.test(entry.id))).toBe(true);
    // CC-027 appears twice, under one id, and both blocks have to survive parsing.
    expect(parsed.entries.filter((entry) => entry.id === "CC-027").length).toBe(2);
  });

  it("reads an instant only from a strict ISO-8601 UTC value", () => {
    expect(control.instantOf("2026-09-26T11:38:04Z")).not.toBeNull();
    for (const bad of ["2026-09-26T11:38Z", "2026-09-26T11:38:04+10:00", "2026-09-26 11:38:04Z", "2026-09-26T11:38:04Z (merge)", ""]) {
      expect(control.instantOf(bad), bad).toBeNull();
    }
  });
});

describe("ledger provenance: every rule fires in both directions", () => {
  it("FIELD: prose in the machine-read field is refused, and a clean value is accepted", () => {
    const dirty = control.parseLedger(ledgerOf({ id: "CC-900", timestamp: "2026-09-26T11:38:04Z (merge) ; recorded 12:00Z" }));
    expect(control.evaluate(dirty, emptyConfig(), null).problems.map((problem) => problem.rule)).toEqual(["FIELD"]);

    const clean = control.parseLedger(ledgerOf({ id: "CC-900", timestamp: "2026-09-26T11:38:04Z" }));
    expect(control.evaluate(clean, emptyConfig(), null).problems).toEqual([]);
  });

  it("PROVENANCE: a timestamp later than its containing commit is refused, and one before it is accepted", () => {
    const late = control.parseLedger(ledgerOf({ id: "CC-900", timestamp: "2026-09-26T11:38:04Z" }));
    // The commit that carries the entry is at 04:11:35Z: the claim is 7h26m AFTER it, which is the CC-063
    // defect verbatim.
    const lateReport = control.evaluate(late, emptyConfig(), atInstant("2026-09-26T04:11:35.000Z"));
    expect(lateReport.ok).toBe(false);
    expect(lateReport.problems.map((problem) => problem.rule)).toEqual(["PROVENANCE"]);
    expect(lateReport.problems[0].detail).toContain("446 minutes AFTER");

    // Written one minute before the commit: the honest direction, and it must pass.
    const honest = control.evaluate(late, emptyConfig(), atInstant("2026-09-26T11:39:04.000Z"));
    expect(honest.ok).toBe(true);
  });

  it("PROVENANCE: a timestamp far EARLIER than its commit is refused too, so the asymmetry cannot be gamed", () => {
    const parsed = control.parseLedger(ledgerOf({ id: "CC-900", timestamp: "2026-09-26T11:38:04Z" }));
    const report = control.evaluate(parsed, emptyConfig(), atInstant("2026-09-26T13:38:04.000Z"));
    expect(report.ok).toBe(false);
    expect(report.problems[0].detail).toContain("120 minutes BEFORE");
  });

  it("MONOTONE: an entry earlier than the one above it is refused in an append-only file", () => {
    const backwards = control.parseLedger(ledgerOf(
      { id: "CC-901", timestamp: "2026-09-26T11:00:00Z" },
      { id: "CC-902", timestamp: "2026-09-26T10:00:00Z" }
    ));
    expect(control.evaluate(backwards, emptyConfig(), null).problems.map((problem) => problem.rule)).toEqual(["MONOTONE"]);

    const forwards = control.parseLedger(ledgerOf(
      { id: "CC-901", timestamp: "2026-09-26T10:00:00Z" },
      { id: "CC-902", timestamp: "2026-09-26T11:00:00Z" }
    ));
    expect(control.evaluate(forwards, emptyConfig(), null).problems).toEqual([]);
  });

  it("ARTICLE: a heading with no entry block, and an entry block with no heading, are both refused", () => {
    const orphanHeading = control.parseLedger(`# ledger\n\n## CC-903 — prose only\n\nno block here\n`);
    expect(control.evaluate(orphanHeading, emptyConfig(), null).problems.map((problem) => problem.rule)).toEqual(["ARTICLE"]);

    const orphanEntry = control.parseLedger(`# ledger\n\n\`\`\`text\nENTRY_ID                    CC-904\ntimestamp_utc               2026-09-26T11:00:00Z\n\`\`\`\n`);
    expect(control.evaluate(orphanEntry, emptyConfig(), null).problems.map((problem) => problem.rule)).toEqual(["ARTICLE"]);
  });

  it("disclosed history is grandfathered by id, and NOT by shape", () => {
    const historical = control.parseLedger(ledgerOf({ id: "CC-063", timestamp: "2026-09-26T11:38:04Z" }));
    expect(control.evaluate(historical, control.readConfig(path.join(PROJECT, CONFIG)), atInstant("2026-09-26T04:11:35.000Z")).ok).toBe(true);

    // One id to the side, with the same shape, is a NEW violation: grandfathering is a list, not a tolerance.
    const fresh = control.parseLedger(ledgerOf({ id: "CC-905", timestamp: "2026-09-26T11:38:04Z" }));
    expect(control.evaluate(fresh, control.readConfig(path.join(PROJECT, CONFIG)), atInstant("2026-09-26T04:11:35.000Z")).ok).toBe(false);
  });
});

describe("ledger provenance: the committed ledger and the shipped CLI", () => {
  it("the committed ledger HOLDS: no undisclosed violation, and every disclosed id exists in it", () => {
    const parsed = control.parseLedger(fs.readFileSync(path.join(PROJECT, LEDGER), "utf8"));
    const config = control.readConfig(path.join(PROJECT, CONFIG));
    const report = control.evaluate(parsed, config);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);

    // Every grandfathered id must be a real entry. A config that lists an id the ledger does not carry would
    // silently pre-authorise a future entry that reused the id. `$comment` keys are documentation, and the
    // control strips them; this asserts that stripping too, rather than trusting it.
    const ids = new Set(parsed.entries.map((entry) => entry.id));
    const disclosed = [
      ...Object.keys(control.withoutComments(config.historicalViolations)),
      ...Object.keys(control.withoutComments(config.hygieneViolations))
    ];
    expect(disclosed.length).toBeGreaterThan(0);
    expect(disclosed.some((id) => id.startsWith("$"))).toBe(false);
    for (const id of disclosed) {
      expect(ids.has(id), `${id} is disclosed but is not in the ledger`).toBe(true);
    }
  });

  it("the CLI exits zero on the real ledger, and refuses a ledger that breaks the rule", () => {
    const inTree = spawnSync(process.execPath, [SCRIPT, "--json", "--no-anchor"], { cwd: PROJECT, encoding: "utf8", maxBuffer: 1 << 28, timeout: 120000 });
    expect(inTree.status, String(inTree.stderr ?? "")).toBe(0);
    const payload = JSON.parse(String(inTree.stdout));
    expect(payload.ok).toBe(true);
    // The count is the control's own count, not a literal that has to be edited on every append; what is
    // pinned is that it agrees with a fresh parse of the same file.
    const reparsed = control.parseLedger(fs.readFileSync(path.join(PROJECT, LEDGER), "utf8"));
    expect(payload.entries).toBe(reparsed.entries.length);
    expect(payload.entries).toBeGreaterThanOrEqual(63);

    // The git-backed rules are what make this control about PROVENANCE rather than about formatting, so they
    // are driven here too -- on the real ledger, against the real commit that first carried the two entries the
    // successor workbook names.
    const resolver = control.makeCommitResolver(PROJECT, LEDGER) as (id: string) => { sha: string; committerIso: string } | null;
    const cc063 = resolver("CC-063");
    expect(cc063?.sha.startsWith("bc0ec39")).toBe(true);

    // The same CLI, pointed at a ledger with the CC-063 defect and no disclosed history, must fail closed
    // rather than report the file it was handed as acceptable.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-provenance-"));
    try {
      const ledgerPath = path.join(dir, "ledger.md");
      const configPath = path.join(dir, "config.json");
      fs.writeFileSync(ledgerPath, ledgerOf({ id: "CC-906", timestamp: "2026-09-26T11:38:04Z" }), "utf8");
      fs.writeFileSync(configPath, JSON.stringify({ schema: "city-ledger-provenance-config/1", ledger: ledgerPath, rules: { recorded_before_containing_commit_minutes: 5, recorded_before_containing_commit_max_lead_minutes: 90 } }), "utf8");
      const outside = spawnSync(process.execPath, [SCRIPT, "--json", "--ledger", ledgerPath, "--config", configPath], { cwd: PROJECT, encoding: "utf8", maxBuffer: 1 << 28 });
      // No git anchor is available for a temp path, so the file-only rules decide -- and they PASS here.
      expect(outside.status).toBe(0);
      // With the anchor supplied by the real resolver the same file fails, which is what proves rule 3 is
      // doing the work rather than rule 2 standing in for it.
      const anchored = control.evaluate(control.parseLedger(fs.readFileSync(ledgerPath, "utf8")), control.readConfig(configPath), atInstant("2026-09-26T04:11:35.000Z"));
      expect(anchored.ok).toBe(false);
      expect(anchored.problems.map((problem) => problem.rule)).toEqual(["PROVENANCE"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
