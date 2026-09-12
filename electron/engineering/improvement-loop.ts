/**
 * Update-Plan/checkpoint-1.md §34 — the improvement loop (host side).
 *
 * Consumes the §33.3 capability gaps that checkpoint 10 wrote, aggregates them by
 * capability, decides whether the conditions are met, and then walks the plan's
 * chain with real machinery at every stage:
 *
 *   CAPABILITY_GAP        the durable record from `capability-gaps.json`
 *   IMPROVEMENT_TASK      planned here (§34's fields, plus the probe that will judge it)
 *   IMPLEMENTATION        the §30 implementation loop (bounded worker → verify → review)
 *   REGRESSION_TEST       a real §31 ladder climb whose PASS rows are cited as evidence
 *   KNOWLEDGE_UPDATE      a §5.3 candidate committed through the real CP2 gate
 *   CAPABILITY_REGISTRY   `probeCapability` re-run: MISSING/PARTIAL → EXISTS or nothing
 *
 * The loop cannot close a gap by working hard: closure needs the probe to move.
 * A module nobody imports stays PARTIAL, and a change that leaves the capability
 * just as missing is registered as OPEN with the probe's own evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { buildWorldModelWithGraph } from "./world-model";
import { probeCapability, type CapabilityVerdict } from "../../src/shared/repo-world-model";
import { KnowledgeBase } from "../knowledge/knowledge-base";
import { createVerificationEngine, type VerificationEngine } from "./verification-engine";
import { createReviewEngine } from "./review-engine";
import { runImplementationLoop, type ImplementationWorker } from "./implementation-loop";
import type { EvidenceLedgerFile } from "../../src/shared/evidence-ledger";
import type { FailureClass } from "../../src/shared/recovery";
import type { KnowledgeScope } from "../../src/shared/tenx/knowledge";
import type { VerificationCommands, VerificationHarnesses, VerifiableRequirement } from "../../src/shared/verification";
import {
  aggregateGaps,
  closureFor,
  DEFAULT_QUALIFICATION,
  knowledgeCandidateFor,
  nextChainStage,
  planImprovement,
  qualifiesForImprovement,
  registryEntryFor,
  type CapabilityChainStage,
  type CapabilityRegistryEntry,
  type ChainStep,
  type ClosureVerdict,
  type GapAggregate,
  type GapOccurrence,
  type ImprovementOutcome,
  type ImprovementProbe,
  type ImprovementTask,
  type KnowledgeEvidence,
  type Qualification,
  type QualificationPolicy,
  type RegressionEvidence
} from "../../src/shared/capability-gap";

export const CAPABILITY_REGISTRY_FILE = "capability-registry.json";

export interface GapBacklogRecord {
  gap: {
    missing_capability: string;
    task: string;
    failure: string;
    workaround: string;
    frequency: number;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    failure_class: FailureClass;
  };
  backlog?: { recorded_at?: string; stage?: string };
  usage?: { recorded_at?: string };
}

export interface ImprovementLoopConfig {
  root: string;
  /** The §33.3 backlog written by the recovery engine. */
  gapBacklogPath?: string;
  /** The §5.3 knowledge base the update step commits to. */
  knowledgePath?: string;
  registryPath?: string;
  ledger: () => EvidenceLedgerFile;
  scope: KnowledgeScope;
  commands?: VerificationCommands;
  targets?: { syntax?: string[]; unit?: string[]; module?: string[]; integration?: string[] };
  harnesses?: VerificationHarnesses;
  policy?: QualificationPolicy;
  now?: () => Date;
}

export interface RunTaskInput {
  aggregate: GapAggregate;
  /** The bounded worker that implements the missing capability. */
  worker: ImplementationWorker;
  /** The plan node's write scope, resolved by the caller against real files. */
  allowedFiles: string[];
  probe?: Partial<ImprovementProbe>;
  maxIterations?: number;
}

export interface ImprovementLoop {
  /** §33.3 gaps, as occurrences (§34 aggregation input). */
  readGaps(): GapOccurrence[];
  /** §6.3 probe over the live workspace: the verdict that judges closure. */
  probe(capability: string, extra?: Partial<ImprovementProbe>): { verdict: CapabilityVerdict; evidence: string[] };
  qualification(aggregate: GapAggregate): Qualification;
  /** Plans the task without running it, so the decision is reviewable. */
  plan(aggregate: GapAggregate, probe?: Partial<ImprovementProbe>): ImprovementTask;
  runTask(input: RunTaskInput): Promise<ImprovementOutcome>;
  aggregates(): GapAggregate[];
  registry(): CapabilityRegistryEntry[];
  save(): { registry: string; knowledge: string };
}

export function createImprovementLoop(config: ImprovementLoopConfig): ImprovementLoop {
  const root = fs.realpathSync(config.root);
  const now = config.now ?? (() => new Date());
  const gapBacklogPath = config.gapBacklogPath ?? path.join(root, "artifacts", "acceptance", "capability-gaps.json");
  const registryPath = config.registryPath ?? path.join(root, "artifacts", "acceptance", CAPABILITY_REGISTRY_FILE);
  const knowledgePath = config.knowledgePath ?? path.join(root, "artifacts", "acceptance", "knowledge-base.json");
  const policy = config.policy ?? DEFAULT_QUALIFICATION;
  let entries: CapabilityRegistryEntry[] = loadRegistry(registryPath);
  let cachedAggregates: GapAggregate[] | undefined;

  const readGaps = (): GapOccurrence[] => {
    if (!fs.existsSync(gapBacklogPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(gapBacklogPath, "utf8")) as { records?: GapBacklogRecord[] };
      return (parsed.records ?? []).flatMap((record, index) => {
        const capability = record.gap?.missing_capability?.trim();
        if (!capability) return [];
        return [{
          gap: { ...record.gap, missing_capability: capability },
          task: record.gap.task,
          recorded_at: record.usage?.recorded_at ?? record.backlog?.recorded_at ?? new Date(index).toISOString()
        }];
      });
    } catch {
      // A damaged backlog is reported as empty history rather than crashing the loop.
      return [];
    }
  };

  const aggregates = (): GapAggregate[] => {
    cachedAggregates ??= aggregateGaps(readGaps());
    return cachedAggregates;
  };

  const probe = (capability: string, extra: Partial<ImprovementProbe> = {}): { verdict: CapabilityVerdict; evidence: string[] } => {
    const { model, graph } = buildWorldModelWithGraph(root);
    const result = probeCapability(model, graph, {
      capability,
      ...(extra.description ? { description: extra.description } : {}),
      ...(extra.terms ? { terms: extra.terms } : {}),
      ...(extra.requires_paths ? { requires_paths: extra.requires_paths } : {})
    });
    return { verdict: result.verdict, evidence: result.evidence.map((item) => `${item.kind}:${item.pointer} — ${item.detail}`) };
  };

  return {
    readGaps,
    aggregates,
    probe,
    qualification: (aggregate) => qualifiesForImprovement(aggregate, policy),
    plan: (aggregate, extra) => planImprovement({
      aggregate,
      previous_verdict: probe(aggregate.capability, extra).verdict,
      ...(extra ? { probe: extra } : {}),
      now: now().toISOString()
    }),
    registry: () => entries,
    async runTask(input) {
      const at = (): string => now().toISOString();
      const qualification = qualifiesForImprovement(input.aggregate, policy);
      const before = probe(input.aggregate.capability, input.probe ?? {});
      const task = planImprovement({
        aggregate: input.aggregate,
        previous_verdict: before.verdict,
        ...(input.probe ? { probe: input.probe } : {}),
        now: at()
      });
      const steps: ChainStep[] = [
        { stage: "CAPABILITY_GAP", ok: true, detail: `${input.aggregate.occurrences} occurrence(s), severity ${input.aggregate.severity}: ${input.aggregate.failures[0] ?? "recorded"}`, at: at() },
        { stage: "IMPROVEMENT_TASK", ok: qualification.qualifies, detail: qualification.reasons.join("; "), at: at() }
      ];

      // IMPLEMENTATION — the §30 loop, with the capability's requirement as the target.
      const engine: VerificationEngine = createVerificationEngine({
        root,
        ledgerPath: path.join(root, "artifacts", "acceptance", "verification-ledger.json"),
        ...(config.commands ? { commands: config.commands } : {}),
        ...(config.targets ? { targets: config.targets } : {}),
        ...(config.harnesses ? { harnesses: config.harnesses } : {}),
        host: "improvement-loop",
        now
      });
      const requirement: VerifiableRequirement = { ...task.requirement };
      const review = createReviewEngine({ root, ledger: () => engine.ledger(), selectFor: (subject) => engine.selectFor(subject) });
      const loop = await runImplementationLoop({
        node: {
          id: task.id,
          objective: task.objective,
          kind: "IMPLEMENT",
          requirements: [requirement.id],
          inputs: [input.aggregate.capability],
          scope: task.scope_terms,
          allowed_files: [...input.allowedFiles].sort(),
          expected_outputs: [task.requirement.text],
          verification: { gate: "TYPECHECK", commands: config.commands?.typecheck ? [config.commands.typecheck] : [], required_evidence: ["IMPLEMENTATION"] },
          dependencies: [],
          rollback: `git checkout HEAD -- ${input.allowedFiles.join(" ")}`,
          wave: 0,
          optional: false,
          unbounded_scope: input.allowedFiles.length === 0
        },
        requirements: [requirement],
        engine,
        review: (request) => review.review(request),
        reviewPlan: (subjects) => review.planFor(subjects),
        worker: input.worker,
        ...(input.maxIterations ? { maxIterations: input.maxIterations } : {})
      });
      steps.push({ stage: "IMPLEMENTATION", ok: loop.iterations.some((iteration) => iteration.applied), detail: `loop label ${loop.label} over ${loop.iterations.length} iteration(s)`, at: at() });

      // REGRESSION_TEST — a fresh climb whose PASS rows are the evidence.
      const selection = engine.selectFor(requirement);
      const run = await engine.verifyRequirement(selection);
      const regression: RegressionEvidence = {
        passed: run.outcome.outcome === "PASS",
        gate: run.outcome.ran.filter((gate) => gate.result === "PASS").map((gate) => gate.gate).join(",") || "none",
        evidence_ids: run.entries.filter((entry) => entry.result === "PASS").map((entry) => entry.id),
        detail: run.outcome.reason
      };
      steps.push({ stage: "REGRESSION_TEST", ok: regression.passed, detail: `${regression.gate}: ${run.outcome.outcome} (${(regression.evidence_ids ?? []).length} row(s))`, at: at() });

      // CAPABILITY_REGISTRY probe — the verdict that decides closure.
      const after = probe(input.aggregate.capability, input.probe ?? {});
      const knowledgeBase = new KnowledgeBase(knowledgePath, () => at());
      const provisional = closureFor({ task, steps, regression, knowledge: { outcome: "ACCEPT" }, current_verdict: after.verdict });
      const candidate = knowledgeCandidateFor({
        task,
        closure: provisional,
        regression,
        current_verdict: after.verdict,
        probe_evidence: after.evidence.length ? after.evidence : before.evidence,
        scope: config.scope,
        captured_at: at(),
        task_ref: task.requirement.id
      });
      const commit = knowledgeBase.commit(candidate, { producerId: "improvement-loop" });
      const knowledge: KnowledgeEvidence = { outcome: commit.outcome, subject: candidate.subject, reasons: commit.reasons };
      steps.push({ stage: "KNOWLEDGE_UPDATE", ok: commit.outcome === "ACCEPT" || commit.outcome === "SUPERSEDE", detail: `${commit.outcome}${commit.reasons.length ? `: ${commit.reasons[0]}` : ""}`, at: at() });

      const closure = closureFor({ task, steps, regression, knowledge, current_verdict: after.verdict });
      const entry = registryEntryFor({ task, closure, current_verdict: after.verdict, evidence: [...after.evidence, ...(regression.evidence_ids ?? [])], closed_at: at() });
      steps.push({ stage: "CAPABILITY_REGISTRY", ok: closure.closed, detail: `${entry.status}: ${after.verdict} (was ${before.verdict}) — next ${nextChainStage(steps, closure) ?? "none"}`, at: at() });
      entries = [...entries.filter((existing) => existing.key !== entry.key), entry];
      persist();

      return {
        task,
        steps,
        loop_label: loop.label,
        regression,
        previous_verdict: before.verdict,
        current_verdict: after.verdict,
        closure,
        knowledge: { outcome: commit.outcome, reasons: commit.reasons, subject: candidate.subject },
        registry: entry,
        probe_evidence: after.evidence
      };
    },
    save() {
      persist();
      return { registry: registryPath, knowledge: knowledgePath };
    }
  };

  function persist(): void {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, version: "capability-registry-1", entries }, null, 2), "utf8");
  }
}

function loadRegistry(registryPath: string): CapabilityRegistryEntry[] {
  if (!fs.existsSync(registryPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as { entries?: CapabilityRegistryEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/** §34's chain stages, for callers that report progress. */
export type { CapabilityChainStage, ImprovementOutcome, ImprovementTask, ClosureVerdict };
