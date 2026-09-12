import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import type { AcceptanceGateContract } from "../../src/shared/acceptance-contracts";

/**
 * Shared shape for the Prestart acceptance suites (checkpoint-2 §5.6, §6.5, §7.6,
 * §8.7, §9). Every suite produces the same machine-readable report the delivery
 * gates produce, so `acceptance:attest` can bind it with the same strict contract.
 */

export type Verdict = "PASS" | "FAIL" | "NOT_RUN";

export interface Observation { claim: string; expected: string; observed: string; ok: boolean }

export interface RequirementResult {
  id: string;
  title: string;
  verdict: Verdict;
  observations: Observation[];
  evidence: string[];
  notes?: string;
}

export class AcceptanceItem {
  private readonly observations: Observation[] = [];
  private readonly evidence: string[] = [];
  private failure?: string;
  constructor(readonly id: string, readonly title: string) {}

  check(claim: string, expected: unknown, observed: unknown): void {
    const expectedText = typeof expected === "string" ? expected : JSON.stringify(expected);
    const observedText = typeof observed === "string" ? observed : JSON.stringify(observed);
    this.observations.push({ claim, expected: expectedText, observed: observedText, ok: expectedText === observedText });
  }

  cite(pointer: string): void {
    if (!this.evidence.includes(pointer)) this.evidence.push(pointer);
  }

  fail(reason: string): void { this.failure = reason; }

  get ok(): boolean {
    return this.failure === undefined && this.observations.length > 0 && this.observations.every((entry) => entry.ok);
  }

  result(): RequirementResult {
    const result: RequirementResult = {
      id: this.id,
      title: this.title,
      verdict: this.ok ? "PASS" : "FAIL",
      observations: this.observations,
      evidence: this.evidence
    };
    if (this.failure) result.notes = this.failure;
    return result;
  }
}

export class AcceptanceRun {
  readonly results: RequirementResult[] = [];
  constructor(readonly unit: string) {}

  async scenario(id: string, title: string, body: (item: AcceptanceItem) => Promise<void> | void): Promise<AcceptanceItem> {
    const item = new AcceptanceItem(id, title);
    try {
      await body(item);
    } catch (error) {
      item.fail(`scenario threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.results.push(item.result());
    return item;
  }

  get failed(): RequirementResult[] {
    return this.results.filter((entry) => entry.verdict === "FAIL");
  }

  report(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: 1,
      unit: this.unit,
      generatedAt: new Date().toISOString(),
      providerExecution: "NOT_RUN",
      ...extra,
      requirementResults: this.results,
      totals: {
        pass: this.results.filter((entry) => entry.verdict === "PASS").length,
        fail: this.results.filter((entry) => entry.verdict === "FAIL").length,
        notRun: this.results.filter((entry) => entry.verdict === "NOT_RUN").length
      },
      passed: this.results.every((entry) => entry.verdict !== "FAIL")
    };
  }

  write(directory: string, file: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const report = this.report(extra);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, file), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(directory, file.replace(/\.json$/, ".md")), this.markdown(report), "utf8");
    return report;
  }

  markdown(report: Record<string, unknown>): string {
    const totals = report.totals as { pass: number; fail: number; notRun: number };
    return [
      `# ${this.unit}`,
      "",
      `Generated: ${String(report.generatedAt)}`,
      "",
      `Totals: PASS ${totals.pass} / FAIL ${totals.fail} / NOT_RUN ${totals.notRun}`,
      "",
      "| Item | Verdict | Observations |",
      "| --- | --- | --- |",
      ...this.results.map((entry) => `| ${entry.id} | ${entry.verdict} | ${entry.observations.filter((observation) => observation.ok).length}/${entry.observations.length} |`),
      ""
    ].join("\n");
  }

  /** Fails the suite loudly when any requirement is not PASS. */
  assertAllPass(): void {
    expect(this.results.map((entry) => `${entry.id}:${entry.verdict}`)).toEqual(this.results.map((entry) => `${entry.id}:PASS`));
  }
}

/** The repository's own acceptance artifacts directory. */
export function acceptanceArtifacts(root = process.cwd()): string {
  return path.join(root, "artifacts", "acceptance");
}

export interface FixtureReport {
  schemaVersion: number;
  unit: string;
  generatedAt: string;
  requirementResults: { id: string; title: string; verdict: Verdict }[];
  totals: { pass: number; fail: number; notRun: number };
  passed: boolean;
}

/**
 * A report that satisfies a contract exactly: every required id PASS, every
 * out-of-scope id reported as NOT_RUN, consistent totals. The optional mutator is
 * how the hostile suites turn it into the attack the checkpoint must refuse.
 */
export function cleanGateReport(contract: AcceptanceGateContract, mutate?: (report: FixtureReport) => void): FixtureReport {
  const requirementResults: FixtureReport["requirementResults"] = [
    ...contract.required_ids.map((id) => ({ id, title: `${id} (fixture)`, verdict: "PASS" as Verdict })),
    ...contract.out_of_scope_ids.map((entry) => ({ id: entry.id, title: entry.reason, verdict: "NOT_RUN" as Verdict }))
  ];
  const report: FixtureReport = {
    schemaVersion: 1,
    unit: `FIXTURE_${contract.gate.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
    generatedAt: new Date().toISOString(),
    requirementResults,
    totals: {
      pass: requirementResults.filter((entry) => entry.verdict === "PASS").length,
      fail: requirementResults.filter((entry) => entry.verdict === "FAIL").length,
      notRun: requirementResults.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: true
  };
  if (mutate) mutate(report);
  return report;
}
