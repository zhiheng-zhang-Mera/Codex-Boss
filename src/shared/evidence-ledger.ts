/**
 * Update-Plan/checkpoint-1.md §31.3 — the Evidence Ledger.
 *
 * Every verification result in the plan is written down with the facts that make
 * it reproducible: which requirement it belongs to, which gate it climbed, the
 * exact command, the environment, the result, the artifact and its hash, and when
 * it happened. §2.3 is the reason: a verification claim that cannot point at an
 * entry here is not evidence, so `bindAcceptance` (checkpoint §28.4) only ever
 * receives ledger entries.
 *
 * The ledger is also where the honesty boundary lives: it records SYNTAX and
 * TYPECHECK as implementation evidence and the test/runtime/visual gates as their
 * own kinds, but it NEVER invents REVIEW, SCREENSHOT or PREVIEW entries — those
 * come from the review layer (§32) and the theme preview/capture (§17/§16), and a
 * requirement that needs them stays unverified until they exist.
 *
 * Pure: no fs, no clock, no process.
 */
import { contentHashOf } from "./workbook";
import { GATE_RANK, type VerificationGate } from "./execution-planner";
import {
  requiredEvidenceKinds,
  type EvidenceKind,
  type RequirementEvidence,
  type RequirementsGraph
} from "./requirements-graph";

export const EVIDENCE_LEDGER_VERSION = "evidence-ledger-1" as const;

export type GateOutcome = "PASS" | "FAIL" | "SKIPPED" | "NOT_RUN";

export interface EvidenceEnvironment {
  host: string;
  platform: string;
  workspace?: string;
  /** Runtime versions that can change a result (node, pnpm, electron). */
  runtimes?: Record<string, string>;
}

export interface EvidenceEntry {
  id: string;
  /** §28 requirement ids this evidence is for (never empty). */
  requirement_ids: string[];
  gate: VerificationGate;
  command: string;
  environment: EvidenceEnvironment;
  result: GateOutcome;
  exit_code?: number;
  artifact?: string;
  /** sha256 of the artifact when there is one, else of the command+result. */
  hash: string;
  captured_at: string;
  duration_ms?: number;
  detail?: string;
}

export interface EvidenceLedgerFile {
  schemaVersion: 1;
  version: typeof EVIDENCE_LEDGER_VERSION;
  entries: EvidenceEntry[];
}

export function emptyLedger(): EvidenceLedgerFile {
  return { schemaVersion: 1, version: EVIDENCE_LEDGER_VERSION, entries: [] };
}

export interface EvidenceInput {
  requirement_ids: string[];
  gate: VerificationGate;
  command: string;
  environment: EvidenceEnvironment;
  result: GateOutcome;
  captured_at: string;
  exit_code?: number;
  artifact?: string;
  artifact_hash?: string;
  duration_ms?: number;
  detail?: string;
}

/**
 * Appends one observation. A second identical observation is not appended twice
 * (same command, same result, same gate, same requirements) — a retried gate that
 * still passes is one fact, not two.
 */
export function recordEvidence(ledger: EvidenceLedgerFile, input: EvidenceInput): { entry: EvidenceEntry; appended: boolean } {
  const hash = input.artifact_hash ?? contentHashOf([input.command, input.result, input.artifact ?? "", ...(input.requirement_ids ?? [])].join("\u0000"));
  const entry: EvidenceEntry = {
    id: `ev-${hash.slice(0, 16)}`,
    requirement_ids: [...new Set(input.requirement_ids ?? [])].sort(),
    gate: input.gate,
    command: input.command,
    environment: { ...input.environment },
    result: input.result,
    hash,
    captured_at: input.captured_at
  };
  if (input.exit_code !== undefined) entry.exit_code = input.exit_code;
  if (input.artifact) entry.artifact = input.artifact;
  if (input.duration_ms !== undefined) entry.duration_ms = input.duration_ms;
  if (input.detail) entry.detail = input.detail;
  const duplicate = ledger.entries.some((existing) => existing.hash === entry.hash && existing.result === entry.result);
  if (!duplicate) ledger.entries.push(entry);
  return { entry, appended: !duplicate };
}

/** Entries for one requirement, newest last, ordered by captured_at then id. */
export function ledgerForRequirement(ledger: EvidenceLedgerFile, requirementId: string): EvidenceEntry[] {
  return ledger.entries
    .filter((entry) => entry.requirement_ids.includes(requirementId))
    .sort((left, right) => left.captured_at.localeCompare(right.captured_at) || left.id.localeCompare(right.id));
}

/** The strongest gate that actually passed for one requirement (0 = none). */
export function highestPassingGate(ledger: EvidenceLedgerFile, requirementId: string): { gate?: VerificationGate; rank: number } {
  const passed = ledgerForRequirement(ledger, requirementId).filter((entry) => entry.result === "PASS");
  if (!passed.length) return { rank: 0 };
  const best = passed.reduce((winner, entry) => (GATE_RANK[entry.gate] > GATE_RANK[winner.gate] ? entry : winner));
  return { gate: best.gate, rank: GATE_RANK[best.gate] };
}

export interface LedgerSummary {
  total: number;
  appendedFromDuplicates: number;
  by_gate: Partial<Record<VerificationGate, number>>;
  by_result: Partial<Record<GateOutcome, number>>;
  requirements: { requirement_id: string; entries: number; highest_gate?: VerificationGate; highest_rank: number; failed: number }[];
}

export function summarizeLedger(ledger: EvidenceLedgerFile): LedgerSummary {
  const byGate: Partial<Record<VerificationGate, number>> = {};
  const byResult: Partial<Record<GateOutcome, number>> = {};
  const requirements = new Map<string, { entries: number; failed: number }>();
  for (const entry of ledger.entries) {
    byGate[entry.gate] = (byGate[entry.gate] ?? 0) + 1;
    byResult[entry.result] = (byResult[entry.result] ?? 0) + 1;
    for (const id of entry.requirement_ids) {
      const current = requirements.get(id) ?? { entries: 0, failed: 0 };
      current.entries += 1;
      if (entry.result === "FAIL") current.failed += 1;
      requirements.set(id, current);
    }
  }
  return {
    total: ledger.entries.length,
    appendedFromDuplicates: 0,
    by_gate: byGate,
    by_result: byResult,
    requirements: [...requirements.entries()]
      .map(([requirement_id, counts]) => {
        const best = highestPassingGate(ledger, requirement_id);
        return { requirement_id, entries: counts.entries, failed: counts.failed, highest_rank: best.rank, ...(best.gate ? { highest_gate: best.gate } : {}) };
      })
      .sort((left, right) => left.requirement_id.localeCompare(right.requirement_id))
  };
}

/**
 * §28.4 bridge: which evidence kinds a ledger entry can legitimately satisfy.
 *
 * Implementation evidence is compilation (the code exists and type-checks); test
 * evidence is any executed test gate; runtime/visual gates are visual
 * verification. REVIEW, PREVIEW and SCREENSHOT are deliberately absent — the
 * ledger cannot manufacture them.
 */
export function evidenceKindForGate(gate: VerificationGate): EvidenceKind[] {
  if (gate === "SYNTAX" || gate === "TYPECHECK") return ["IMPLEMENTATION"];
  if (gate === "UNIT" || gate === "MODULE" || gate === "INTEGRATION" || gate === "FULL") return ["TEST"];
  if (gate === "BUILD") return ["TEST"];
  if (gate === "RUNTIME" || gate === "VISUAL") return ["VISUAL_VERIFICATION"];
  return ["IMPLEMENTATION"];
}

/** The §28.4 vocabulary has no SKIPPED, so a skipped gate is NOT_RUN there. */
export function evidenceStatusFor(result: GateOutcome): "PASS" | "FAIL" | "MISSING" | "NOT_RUN" {
  return result === "SKIPPED" ? "NOT_RUN" : result;
}

/** Converts the ledger into the §28.4 evidence list for a requirements graph. */
export function evidenceForRequirements(
  ledger: EvidenceLedgerFile,
  graph: Pick<RequirementsGraph, "nodes">,
  options: { requirementIds?: readonly string[] } = {}
): RequirementEvidence[] {
  const wanted = options.requirementIds ? new Set(options.requirementIds) : undefined;
  const evidence: RequirementEvidence[] = [];
  for (const entry of ledger.entries) {
    for (const requirementId of entry.requirement_ids) {
      if (wanted && !wanted.has(requirementId)) continue;
      for (const kind of evidenceKindForGate(entry.gate)) {
        evidence.push({
          id: `${entry.id}-${kind}`,
          requirement_id: requirementId,
          kind,
          status: evidenceStatusFor(entry.result),
          source: `${entry.environment.host}:${entry.gate}`,
          detail: entry.detail ?? entry.command,
          captured_at: entry.captured_at,
          command: entry.command,
          ...(entry.artifact ? { artifact: entry.artifact } : {}),
          hash: entry.hash
        });
      }
    }
  }
  return evidence;
}

/**
 * What the ledger still owes: per requirement, the kinds §28.4 will demand that
 * no entry provides yet. This is the honest to-do list a repair loop works from.
 */
export function outstandingEvidence(
  ledger: EvidenceLedgerFile,
  graph: Pick<RequirementsGraph, "nodes">
): { requirement_id: string; missing: EvidenceKind[] }[] {
  const provided = new Map<string, Set<EvidenceKind>>();
  for (const entry of evidenceForRequirements(ledger, graph)) {
    (provided.get(entry.requirement_id) ?? provided.set(entry.requirement_id, new Set()).get(entry.requirement_id)!).add(entry.kind);
  }
  return graph.nodes
    .map((node) => {
      const have = provided.get(node.id) ?? new Set<EvidenceKind>();
      const missing = requiredEvidenceKinds(node).filter((kind) => !have.has(kind));
      return { requirement_id: node.id, missing };
    })
    .filter((entry) => entry.missing.length > 0)
    .sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));
}
