import type { GateResult } from "../../src/shared/result-validator";

/**
 * §20–§22 (Owner-Result.md Rev.2) verification-evidence collector. The runtime
 * completion seams of an engineering plan execute host checks (typecheck, test,
 * build, diff, syntax). Only the checks that map onto the result-validator gate
 * vocabulary (§21) count as gate evidence; everything else is deliberately not
 * claimed as a passed gate (no fake verification). The collector is pure over
 * the executed ProposalResults and step outputs so completion verdicts are
 * deterministic and testable without a live provider.
 */

const STANDARD_ENGINEERING_GATE: Readonly<Record<string, string | undefined>> = {
  typecheck: "typecheck",
  test: "unit",
  build: "build"
};

function engineeringGateFor(checkKind: string): string | undefined {
  return STANDARD_ENGINEERING_GATE[checkKind];
}

/**
 * Collects one GateResult per standard gate that actually passed, deduplicated
 * in plan order. `edits` are the ProposalResults of the plan's edit steps (their
 * `checks` are CheckEvidence[] executed by verifyAndRepair); `outputs` may carry
 * "verify"-step outputs of the shape {status:"PASS", checks:[{kind,passed,…}]}.
 */
export function collectVerificationEvidence(edits: ReadonlyArray<{ checks: ReadonlyArray<{ passed: boolean; check: { kind: string } }> }>, outputs: Record<string, string> = {}): GateResult[] {
  const gates: GateResult[] = [];
  const seen = new Set<string>();
  const push = (gate: string, evidence: string): void => {
    if (seen.has(gate)) return;
    seen.add(gate);
    gates.push({ gate, evidence });
  };
  for (const edit of edits) {
    for (const check of edit.checks ?? []) {
      if (!check.passed) continue;
      const gate = engineeringGateFor(check.check.kind);
      if (gate) push(gate, `${check.check.kind} PASS`);
    }
  }
  for (const value of Object.values(outputs)) {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { continue; }
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as { status?: unknown; checks?: Array<{ kind?: unknown; passed?: unknown }> };
    if (record.status !== "PASS" || !Array.isArray(record.checks)) continue;
    for (const check of record.checks) {
      if (!check || check.passed !== true || typeof check.kind !== "string") continue;
      const gate = engineeringGateFor(check.kind);
      if (gate) push(gate, `${check.kind} PASS`);
    }
  }
  return gates;
}
