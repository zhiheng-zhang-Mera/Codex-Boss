/**
 * Update-Plan/checkpoint-1.md §42 — the host side of final acceptance.
 *
 * The decision layer (`src/shared/final-acceptance.ts`) says what must be true; this
 * module gathers the facts from the artifacts the earlier checkpoints actually
 * wrote — the §31.3 ledger, the §32 review report, the §33.3 gap backlog, the §5.3
 * knowledge gate log, the §37 assessment, the §41 CI record, the candidate record
 * and the theme registry — and writes the final-acceptance record.
 *
 * An artifact that is missing stays missing: the item is `NOT_VERIFIED` and the
 * acceptance is rejected, because a final gate that passes on absent evidence is
 * the one thing §42 exists to prevent.
 */
import fs from "node:fs";
import path from "node:path";
import { scanSecrets } from "../../src/shared/secret-scan";
import { evaluateFinalAcceptance, type FinalAcceptance, type FinalEvidence } from "../../src/shared/final-acceptance";
import { outstandingEvidence, type EvidenceLedgerFile } from "../../src/shared/evidence-ledger";

export const FINAL_ACCEPTANCE_RECORD = "final-acceptance.json";

export interface FinalAcceptanceConfig {
  root: string;
  /** Where the earlier checkpoints' reports live. */
  artifacts?: string;
  ledger: () => EvidenceLedgerFile;
  /** Files the candidate wrote, relative to the root. */
  writtenFiles?: () => readonly string[];
  now?: () => Date;
}

export interface FinalAcceptanceInput {
  requirements: readonly { id: string; type: string; text: string; visual: boolean; state: string }[];
  goal: string;
  /** Requirements the candidate claims to serve. */
  served_requirements: readonly string[];
  knowledge_scope?: string;
  touches_ui?: boolean;
  /** Theme verification results, when UI is involved. */
  theme?: FinalEvidence["theme"];
}

export interface FinalAcceptanceOutcome {
  acceptance: FinalAcceptance;
  evidence: FinalEvidence;
  /** Which artifacts were read, and which were missing. */
  artifacts: { read: string[]; missing: string[] };
  recordPath: string;
}

export interface FinalAcceptanceGate {
  evaluate(input: FinalAcceptanceInput): FinalAcceptanceOutcome;
  /** §42: the acceptance record the release can cite. */
  record(): FinalAcceptance | undefined;
}

export function createFinalAcceptanceGate(config: FinalAcceptanceConfig): FinalAcceptanceGate {
  const root = fs.realpathSync(config.root);
  const artifactsDir = config.artifacts ?? path.join(root, "artifacts", "acceptance");
  const now = config.now ?? (() => new Date());
  const recordPath = path.join(artifactsDir, FINAL_ACCEPTANCE_RECORD);
  let record: FinalAcceptance | undefined = load(recordPath);

  const readJson = (name: string): unknown | undefined => {
    const target = path.join(artifactsDir, name);
    if (!fs.existsSync(target)) return undefined;
    try { return JSON.parse(fs.readFileSync(target, "utf8")); } catch { return undefined; }
  };

  return {
    record: () => record,
    evaluate(input) {
      const read: string[] = [];
      const missing: string[] = [];
      const seen = (name: string, value: unknown): boolean => {
        if (value === undefined) { missing.push(name); return false; }
        read.push(name);
        return true;
      };

      const ledger = config.ledger();
      // §42 ALL_REQUIREMENTS_VERIFIED: a requirement is verified when the newest
      // §31.3 row for it has no failure and it owes no evidence.
      const outstanding = new Set(outstandingEvidence(ledger, {
        nodes: input.requirements.map((requirement) => ({ id: requirement.id, type: requirement.type, visual: requirement.visual })) as never
      }).filter((entry) => (entry.missing ?? []).length > 0).map((entry) => entry.requirement_id));
      const verified = input.requirements
        .filter((requirement) => requirement.state === "VERIFIED")
        .map((requirement) => requirement.id);
      const required = input.requirements.filter((requirement) => requirement.type !== "GOAL" && requirement.type !== "DEPENDENCY").map((requirement) => requirement.id);
      // A requirement whose newest §31.3 row per gate includes a failure is not
      // verified, whatever its graph state says.
      const failedRequirements = required.filter((requirementId) => {
        const rows = ledger.entries
          .filter((entry) => entry.requirement_ids.includes(requirementId))
          .sort((left, right) => left.captured_at.localeCompare(right.captured_at) || left.id.localeCompare(right.id));
        const latest = new Map<string, string>();
        for (const row of rows) latest.set(row.gate, row.result);
        return [...latest.values()].includes("FAIL");
      });

      // §42 NO_BLOCKING_FINDINGS: the §32 report's own routing. When the report is
      // absent the item must be NOT_VERIFIED, so the evidence key is only set when
      // the artifact was actually read — a fabricated zero would pass the item.
      const reviewStatus = readJson("review-loop.json") as { loops?: { c02?: { iterations?: { blocking: number; subjects?: string[] }[] } } } | undefined;
      seen("review-loop.json", reviewStatus);
      const lastBlocking = reviewStatus?.loops?.c02?.iterations?.at(-1)?.blocking;

      // §42 SECRETS: scan what the candidate wrote, now.
      const written = config.writtenFiles?.() ?? [];
      const hits: { path: string; shapes: string[] }[] = [];
      const scanned: string[] = [];
      for (const file of written) {
        const target = path.resolve(root, file);
        if (!target.startsWith(root) || !fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
        scanned.push(file);
        const found = scanSecrets(fs.readFileSync(target, "utf8"));
        if (found.length) hits.push({ path: file, shapes: [...new Set(found.map((match) => match.shape))] });
      }

      // §42 DESTRUCTIVE: the candidate gate's Guardian result.
      const candidate = readJson("candidate-guardian.json") as { candidate?: { blocking?: string[]; released?: boolean } } | undefined;
      seen("candidate-guardian.json", candidate);
      const destructiveBlocking = candidate ? (candidate.candidate?.blocking ?? []).filter((check) => check === "DESTRUCTIVE_CHANGE_CHECK") : undefined;

      // §42 KNOWLEDGE: the §5.3 gate log of the knowledge base the work wrote to.
      const knowledge = readJson("knowledge-foundation.json") as { knowledge?: { written?: number; quarantined?: number; reused?: number } } | undefined;
      seen("knowledge-foundation.json", knowledge);

      // §42 VERSION: the §37 assessment in the checkpoint record.
      const checkpoint = readJson("version-checkpoint.json") as { impact?: { implementation?: string; breaking?: string; docs?: string } } | undefined;
      seen("version-checkpoint.json", checkpoint);

      // §42 CI: the §41 record's outcome.
      const ciRepair = readJson("ci-repair.json") as { loop?: { outcome?: string } } | undefined;
      seen("ci-repair.json", ciRepair);

      const evidence: FinalEvidence = {
        requirements: { required, verified, outstanding: [...outstanding], failed: failedRequirements },
        ...(lastBlocking !== undefined ? { findings: { blocking: lastBlocking } } : {}),
        secrets: { scanned_files: scanned, hits },
        ...(destructiveBlocking !== undefined ? { destructive: { unapproved: destructiveBlocking } } : {}),
        ...(knowledge !== undefined
          ? {
              knowledge: {
                attempted: (knowledge.knowledge?.written ?? 0) + (knowledge.knowledge?.quarantined ?? 0),
                accepted: knowledge.knowledge?.written ?? 0,
                rejected: 0,
                quarantined: knowledge.knowledge?.quarantined ?? 0
              }
            }
          : {}),
        ...(checkpoint !== undefined
          ? { version: { impact: checkpoint.impact?.breaking === "MAJOR" ? "MAJOR" : checkpoint.impact?.implementation ?? "NONE", decided_by: "HOST" } }
          : {}),
        ...(ciRepair !== undefined
          ? { ci: { readable: true, ...(ciRepair.loop?.outcome === "PASS" ? { conclusion: "success" } : { conclusion: ciRepair.loop?.outcome?.toLocaleLowerCase() }) } }
          : {}),
        goal: { goal: input.goal, served_by_requirements: [...input.served_requirements] },
        ...(input.touches_ui ? { touches_ui: true } : {}),
        ...(input.theme ? { theme: input.theme } : {})
      };

      const acceptance = evaluateFinalAcceptance(evidence);
      record = acceptance;
      fs.mkdirSync(artifactsDir, { recursive: true });
      fs.writeFileSync(recordPath, JSON.stringify({
        ...acceptance,
        evaluated_at: now().toISOString(),
        artifacts_read: read,
        artifacts_missing: missing
      }, null, 2), "utf8");
      return { acceptance, evidence, artifacts: { read, missing }, recordPath };
    }
  };
}

function load(recordPath: string): FinalAcceptance | undefined {
  if (!fs.existsSync(recordPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath, "utf8")) as FinalAcceptance;
    return parsed?.version === "final-acceptance-1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
