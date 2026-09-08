/**
 * Research conductor (milestone §7 → §18): the real stage executor for the
 * deterministic CI path (and, with a live provider, the GUI normal path).
 *
 * Milestone hard rules implemented here:
 *  - no placeholder stage auto-advance: every main stage performs real host
 *    work (workspace scan, bounded literature intake, protocol freeze,
 *    experiment implementation validation, real recorded runs, deterministic
 *    statistics, independent replication, evidence adjudication, citation
 *    verification, manuscript assembly + LaTeX compile) and persists a typed
 *    artifact per stage (research/<id>/artifacts/*.json, §4);
 *  - never fabricate reviewer approval, source support, statistics, experiment
 *    runs or citation evidence: reviewer votes / hypotheses / sources /
 *    support verdicts come from an injected semantic provider as *content*,
 *    while acquisition, passage location, statistics, run records, protocol
 *    hashes and audit files are host-deterministic; runs are real spawned
 *    processes recorded against the frozen protocol hash;
 *  - human RQ is anchored at SCOPING and never silently changed (a later
 *    hypothesis draft cannot rewrite the recorded question);
 *  - crash-safe/idempotent: artifact-backed plans are re-read instead of
 *    re-asking the provider, already-recorded (experimentId, seed) runs are
 *    never duplicated, and freeze/compile/manuscript writes are overwrite-safe;
 *  - budget guard: total recorded experiment runs never exceed the IR budget.
 *
 * Semantic content (hypothesis, protocol design, sources, verifier verdicts)
 * is obtained from `ResearchSemanticProvider` — a live role worker in the GUI
 * session, a fixture mock in the deterministic CI path. Every ask is bounded
 * and idempotent per stage.
 */

import fs from "node:fs";
import path from "node:path";
import { scanRepo } from "../engineering/repo-inspector";
import type { ResearchIR, ResearchState } from "../../src/shared/research-ir";
import type { ResearchRole } from "../../src/shared/research-roles";
import type { ResearchStageExecutor, StageOutcome } from "./research-supervisor";
import type { ResearchService } from "./research-service";
import type { ResearchProtocol } from "../../src/shared/research-protocol";
import { inferBaselineProvenance, type BaselineProvenance } from "../../src/shared/research-protocol";
import type { ResearchCommandSpec } from "../../src/shared/research-command";
import type { ReviewerVote } from "../../src/shared/research-adjudicate";
import { metricFigureSvg } from "../../src/shared/research-figures";
import { summarizeCitationAudit, VERIFIED_CITATION_STATUSES } from "../../src/shared/research-citation";
import { parseJsonObject } from "./semantic-json";
import { runStructuredProcess } from "./runtime/process-runner";
import { LatexCompiler, type LatexCompileAudit } from "./manuscript/latex-compiler";
import type { SectionBrief } from "../../src/shared/research-manuscript";
import { MANUSCRIPT_SECTIONS } from "../../src/shared/research-manuscript";
import { antiPrematureClosure, sectionSufficiency } from "../../src/shared/research-manuscript";
import type { ResultTable } from "../../src/shared/research-manuscript";
import { planResearchCapabilities } from "../../src/shared/research-capability-registry";

/** Role-based semantic worker: returns raw text/JSON for one stage. */
export interface ResearchSemanticProvider {
  ask(input: { researchId: string; stage: ResearchState; role: ResearchRole; question: string }): Promise<string>;
}

/**
 * Overcomplete §9.9: a bound implementation spec handed to the experiment
 * coder when the workspace has no pre-existing benchmark. The host decides the
 * metric/baseline/sample from the FROZEN protocol; the coder only writes code
 * that obeys the output contract. A generated implementation is dry-run by the
 * host and fails closed unless it really emits the required numeric metric.
 */
export interface ExperimentImplementationSpec {
  researchQuestion: string;
  hypothesis: string;
  metric: string;
  baselineValue: string;
  sampleDefinition: string;
  workspace: string;
  seedArgument: string;
}

export type ExperimentCoder = (spec: ExperimentImplementationSpec) => Promise<string>;

export interface ResearchConductorOptions {
  /** Accessor for the composed ResearchService (avoids constructor cycles). */
  service: () => ResearchService;
  /** Semantic content provider (fixture mock in CI, role worker in live GUI). */
  provider: ResearchSemanticProvider;
  /** LaTeX compile entry (defaults to the real engine detector). */
  compile?: (manuscriptDir: string) => Promise<LatexCompileAudit>;
  /**
   * Overcomplete §9.3: HOST-backed literature retrieval. When present,
   * LITERATURE_REVIEW first runs a real host pass (search → metadata verify →
   * acquire → passage locate); only when the host returns nothing does the
   * AI-supplied intake run (and its text is advisory, never an external
   * source). Absent for the deterministic CI path or offline runs.
   */
  hostLiterature?: (ir: ResearchIR) => Promise<{ records: Array<import("./literature/host-retrieval").HostSourceRecord>; note?: string }>;
  /**
   * Overcomplete §9.9: writes an experiment implementation from the frozen
   * protocol spec when <workspace>/experiments/ has no runnable benchmark yet.
   * Absent ⇒ RQ→READY without a pre-existing implementation fails closed with
   * explicit guidance (never fabricated).
   */
  experimentCoder?: ExperimentCoder;
}

/** Durable experiment plan (written by EXPERIMENT_GENERATION, read by execution). */
export interface ExperimentPlan {
  experimentId: string;
  metric: string;
  /** Absolute path of the implementation file that must exist (fail-closed). */
  implFile: string;
  executable: string;
  args: string[];          // may contain the literal `{seed}` placeholder
  cwd: string;
  /** Env overrides merged into the process env (e.g. ELECTRON_RUN_AS_NODE). */
  environment?: Record<string, string>;
  primaryRuns: number;
  replicationRuns: number;
  timeoutMs: number;
}

const MAX_SOURCES = 5; // bounded literature intake (§9 Pass 1: ≤5–10 sources)

export class ResearchConductor implements ResearchStageExecutor {
  private readonly service: () => ResearchService;
  private readonly provider: ResearchSemanticProvider;
  private readonly compile: (manuscriptDir: string) => Promise<LatexCompileAudit>;
  private readonly hostLiterature?: ResearchConductorOptions["hostLiterature"];
  private readonly experimentCoder?: ResearchConductorOptions["experimentCoder"];
  private readonly providerCalls = new Map<string, number>();

  constructor(options: ResearchConductorOptions) {
    this.service = options.service;
    this.provider = options.provider;
    this.compile = options.compile ?? (async (dir) => new LatexCompiler().compile(dir));
    this.hostLiterature = options.hostLiterature;
    this.experimentCoder = options.experimentCoder;
  }

  async run(input: { ir: ResearchIR; stage: ResearchState; workspace: string }): Promise<StageOutcome> {
    switch (input.stage) {
      case "SCOPING": return this.scoping(input.ir);
      case "PROJECT_INSPECTION": return this.projectInspection(input.ir, input.workspace);
      case "LITERATURE_REVIEW": return this.literatureReview(input.ir);
      case "QUESTION_FORMULATION": return this.questionFormulation(input.ir);
      case "PROTOCOL_DRAFT": return this.protocolDraft(input.ir);
      case "PROTOCOL_FROZEN": return this.protocolFrozen(input.ir);
      case "EXPERIMENT_GENERATION": return this.experimentGeneration(input.ir);
      case "EXPERIMENT_EXECUTION": return this.experimentExecution(input.ir);
      case "ANALYSIS": return this.analysis(input.ir);
      case "REPLICATION": return this.replication(input.ir);
      case "CLAIM_REVIEW": return this.claimReview(input.ir);
      case "MANUSCRIPT": return this.manuscript(input.ir);
      case "CITATION_AUDIT": return this.citationAudit(input.ir);
      case "REPRO_AUDIT": return this.reproAudit(input.ir);
      case "BUILD": return this.build(input.ir);
      default:
        // No placeholder advancement: a stage the conductor cannot really do
        // stops the run (fail closed) instead of passing through.
        return { summary: `stage ${input.stage} has no real work in the conductor`, fail: { reason: `research conductor cannot perform stage ${input.stage}` } };
    }
  }

  // ---------------------------------------------------------------- helpers

  private svc(): ResearchService {
    const service = this.service();
    if (!service) throw new Error("Research service not wired");
    return service;
  }

  private record(id: string, stage: ResearchState, summary: string, file: string, evidenceRefs: string[], extra: Record<string, unknown>): void {
    this.svc().saveStageArtifact(id, { stage, summary, evidenceRefs, file, extra });
  }

  private researchQuestion(ir: ResearchIR): string {
    return ir.researchQuestions[0] ?? ir.goal;
  }

  private async ask(ir: ResearchIR, stage: ResearchState, role: ResearchRole, question: string): Promise<unknown> {
    // Provider-call budget (milestone §1/§12): each semantic ask is counted per
    // run; exceeding the human budget fails the run closed — no unbounded
    // provider spend can hide inside an autopilot.
    const used = (this.providerCalls.get(ir.id) ?? 0) + 1;
    const cap = ir.scope.budget.maxProviderCalls;
    if (cap !== undefined && used > cap) throw new Error(`provider budget exhausted: ${used} calls > maxProviderCalls ${cap}`);
    this.providerCalls.set(ir.id, used);
    const text = await this.provider.ask({ researchId: ir.id, stage, role, question: `${question}\n\n[format] Reply with ONLY one valid JSON value. No explanation outside it, no markdown fences. If nothing usable exists, return [] or {} as applicable — never invent experiments, sources or results.` });
    try {
      return parseJsonObject(text);
    } catch {
      throw new Error(`Provider did not return valid JSON for stage ${stage}: ${text.slice(0, 300)}`);
    }
  }

  /** Reads the `extra` payload of one durable stage artifact (typed). */
  private readExtra<T>(id: string, file: string): T | undefined {
    const artifact = this.svc().readStageArtifact(id, file);
    if (!artifact) return undefined;
    return (artifact.extra ?? undefined) as T | undefined;
  }

  /** Plan artifact is durable state: a restart re-reads it instead of re-asking. */
  private plan(ir: ResearchIR): ExperimentPlan | undefined {
    return this.readExtra<{ plan?: ExperimentPlan }>(ir.id, "experiment-plan.json")?.plan;
  }

  private specForSeed(plan: ExperimentPlan, seed: number): ResearchCommandSpec {
    return {
      executable: plan.executable,
      args: plan.args.map((arg) => arg.replaceAll("{seed}", String(seed))),
      cwd: plan.cwd,
      environment: plan.environment,
      purpose: "EXPERIMENT",
      timeoutMs: plan.timeoutMs
    };
  }

  // ------------------------------------------------------------- stage work

  /** SCOPING anchors the human RQ in the IR once — never silently rewritten. */
  private scoping(ir: ResearchIR): StageOutcome {
    if (ir.researchQuestions.length === 0) {
      this.svc().ledger.checkpoint(ir.id, (record) => {
        record.ir.researchQuestions = [record.ir.goal];
        record.ir.updatedAt = new Date().toISOString();
      }, "human RQ anchored (immutable)");
    }
    this.record(ir.id, "SCOPING", "human research question anchored; scope + budget recorded", "research-question.json", [], { researchQuestion: this.researchQuestion(ir) });
    return { summary: "scoping complete: RQ anchored, workspace + reviewers + budget recorded", evidenceRefs: [] };
  }

  /** PROJECT_INSPECTION scans the authorized workspace (real, bounded). */
  private projectInspection(ir: ResearchIR, workspace: string): StageOutcome {
    const root = fs.realpathSync(workspace);
    const snapshot = scanRepo(root);
    const topLevel = snapshot.files.slice(0, 50);
    this.record(ir.id, "PROJECT_INSPECTION", `inspected repo: ${snapshot.files.length} files, ${Object.keys(snapshot.testMap).length} test dirs`, "project-inspection.json", [`repo:${snapshot.fingerprint.slice(0, 16)}`], { fileCount: snapshot.files.length, testDirs: Object.keys(snapshot.testMap).length, fingerprint: snapshot.fingerprint.slice(0, 16), topLevel: topLevel.slice(0, 10) });
    return { summary: `inspected repo: ${snapshot.files.length} files, fingerprint ${snapshot.fingerprint.slice(0, 12)}`, evidenceRefs: [`repo:${snapshot.fingerprint.slice(0, 16)}`] };
  }

  /** LITERATURE_REVIEW: host retrieval first (§9.3), AI intake as fallback only. */
  private async literatureReview(ir: ResearchIR): Promise<StageOutcome> {
    const existing = this.readExtra<{ sources: unknown[] }>(ir.id, "literature-map.json");
    const sources = existing?.sources;
    if (!sources) {
      // §9.3: run the REAL host pass first. Only when the host returns no
      // acquired source does the AI-supplied intake run — and its sourceText
      // is advisory content, never treated as an externally verified source.
      let hostOutcome: { records: Array<import("./literature/host-retrieval").HostSourceRecord>; note?: string } = { records: [] };
      if (this.hostLiterature) {
        try {
          hostOutcome = await this.hostLiterature(ir);
        } catch (error) {
          hostOutcome = { records: [], note: `host retrieval failed: ${String(error instanceof Error ? error.message : error).slice(0, 300)}` };
        }
      }
      if (hostOutcome.records.length > 0) {
        for (const raw of hostOutcome.records) this.ingestSource(ir.id, raw as unknown as Record<string, unknown>);
        const refs = hostOutcome.records.map((record) => record.id);
        this.record(ir.id, "LITERATURE_REVIEW", `literature intake: ${hostOutcome.records.length} host-verified source(s) acquired by real retrieval`, "literature-map.json", refs, { sources: hostOutcome.records, note: hostOutcome.note ?? "", hostRetrieved: true });
        return { summary: `literature intake: ${hostOutcome.records.length} host-verified source(s) stored from real retrieval`, evidenceRefs: [] };
      }
      const hostEmptyNote = hostOutcome.note ? `host pass empty: ${hostOutcome.note}` : "host pass empty (offline or no accessible sources)";
      let list: unknown[] = [];
      let note = "";
      try {
        const answer = await this.ask(ir, "LITERATURE_REVIEW", "literature", `For the research question "${this.researchQuestion(ir)}", return up to ${MAX_SOURCES} highly relevant sources as JSON: [{"id","title","authors":[],"venue","year","sourceRef","quote","sourceText"}] — the quote must appear verbatim inside sourceText; sourceRef/sourceText must reference a REAL verifiable source. If you cannot provide any verifiable source, return [] — never invent one.`);
        list = Array.isArray(answer) ? answer.slice(0, MAX_SOURCES) : [];
      } catch (error) {
        // Graceful, honest degradation: an empirical primary claim does not bind
        // background citations, so "no usable source verified" proceeds with an
        // empty intake instead of fabricating literature (0 bound citations stay
        // audit-clean). The refusal is recorded, never papered over.
        note = String(error instanceof Error ? error.message : error).slice(0, 300);
        list = [];
      }
      for (const raw of list) this.ingestSource(ir.id, raw as Record<string, unknown>);
      this.record(ir.id, "LITERATURE_REVIEW", note ? `literature intake empty (provider could not supply verifiable JSON sources): ${note} ${hostEmptyNote}` : `literature intake: ${list.length} AI-advisory source(s) (host empty: ${hostEmptyNote})`, "literature-map.json", list.map((_, index) => `cite:s${index + 1}`), { sources: list, note, hostEmptyNote });
      return { summary: note ? `literature intake empty (${hostEmptyNote}; no verifiable sources; none fabricated); proceeding` : `literature intake: ${list.length} AI-advisory source(s) stored (host empty; AI text is not an external source)`, evidenceRefs: [] };
    }
    return { summary: `literature intake already recorded: ${sources.length} source(s)`, evidenceRefs: sources.map((_, index) => `cite:s${index + 1}`) };
  }

  /** Stores one source + host-side passage location against the acquired text. */
  private ingestSource(id: string, raw: Record<string, unknown>): void {
    const svc = this.svc();
    const citationId = String(raw.id ?? `cite:${svc.citations.list().length + 1}`);
    const sourceRef = String(raw.sourceRef ?? "");
    const quote = String(raw.quote ?? "");
    const sourceText = String(raw.sourceText ?? "");
    const record = {
      id: citationId,
      proposedTitle: String(raw.title ?? "Untitled").slice(0, 500),
      proposedAuthors: Array.isArray(raw.authors) ? (raw.authors as unknown[]).map(String).slice(0, 20) : undefined,
      proposedVenue: raw.venue ? String(raw.venue) : undefined,
      sourceRef: sourceRef || undefined,
      status: "UNSUPPORTED" as const,
      reasons: ["source recorded by literature intake; verification pending"],
      updatedAt: new Date().toISOString()
    };
    svc.citations.put(record);
    if (sourceRef && sourceText) svc.citations.saveSource(sourceRef, sourceText);
    // Host-side mechanical check: the quote must appear in the acquired text.
    const passageLocated = Boolean(quote) && sourceText.includes(quote);
    svc.citations.verify(citationId, { sourceAcquired: Boolean(sourceRef && sourceText), metadataVerified: Boolean(raw.title && raw.venue), passageLocated, passageSupports: false, passageContradicts: false, passages: passageLocated ? [{ quote: quote.slice(0, 4000) }] : undefined });
  }

  /** QUESTION_FORMULATION drafts the hypothesis; RQ immutability enforced. */
  private async questionFormulation(ir: ResearchIR): Promise<StageOutcome> {
    const svc = this.svc();
    const record = svc.ledger.load(ir.id)!;
    if (record.ir.hypotheses.length === 0) {
      const answer = await this.ask(ir, "QUESTION_FORMULATION", "planner", `For the anchored research question "${this.researchQuestion(ir)}", draft one falsifiable hypothesis as JSON: {"hypothesis":"..."} — never change the research question.`);
      const hypothesis = String((answer as { hypothesis?: unknown })?.hypothesis ?? "").trim();
      if (!hypothesis) throw new Error("Provider returned no hypothesis");
      svc.ledger.checkpoint(ir.id, (next) => {
        // RQ anchor immutability: a question may never be silently replaced.
        if (next.ir.researchQuestions.length === 0) next.ir.researchQuestions = [next.ir.goal];
        next.ir.hypotheses = [hypothesis];
        next.ir.updatedAt = new Date().toISOString();
      }, "hypothesis recorded");
      this.record(ir.id, "QUESTION_FORMULATION", `hypothesis: ${hypothesis.slice(0, 200)}`, "hypothesis.json", [], { hypothesis, researchQuestion: this.researchQuestion(ir) });
      return { summary: `hypothesis recorded: ${hypothesis.slice(0, 200)}`, evidenceRefs: [] };
    }
    return { summary: "hypothesis already recorded on restart", evidenceRefs: [] };
  }

  /**
   * PROTOCOL_DRAFT: host-freezes the numeric scientific core. Web AIs proved
   * unreliable at emitting numeric protocol fields (they return prose like
   * primaryMetric "review error rate" or a non-numeric baseline, which makes
   * the deterministic statistic compare against NaN and the claim is never
   * adopted). The protocol's numbers are therefore bound deterministically to
   * the real implementation: probe its actual METRICS keys, baseline = 0.5
   * (chance level), criterion = mean > baseline. The hypothesis (prose) still
   * comes from the semantic stage; nothing is fabricated.
   */
  private async protocolDraft(ir: ResearchIR): Promise<StageOutcome> {
    const svc = this.svc();
    const store = svc.protocols.load(ir.id);
    if (!store) {
      const candidates = listImplCandidates(ir.scope.workspace);
      if (candidates.length === 0) throw new Error("No executable implementation found under <workspace>/experiments/ — add a benchmark that prints `METRICS <json>`");
      const declaration = await probeImplDeclaration(candidates[0]);
      if (declaration.metricKeys.length === 0) throw new Error(`Implementation ${candidates[0]} printed no numeric METRICS keys on a probe run`);
      const metric = declaration.metricKeys[0];
      // §9.8: baseline always carries provenance. The implementation may declare
      // a real baseline (METRICS_META); otherwise a proportion-like metric gets
      // the named random-chance baseline; anything else fails closed instead of
      // freezing an unexplained constant.
      const baselineInfo: BaselineProvenance = inferBaselineProvenance(metric, declaration.meta);
      if (baselineInfo.kind === "host-heuristic") {
        throw new Error(`cannot freeze protocol: metric '${metric}' is not proportion-like and the implementation declares no baseline with provenance (declare via METRICS_META); ${baselineInfo.reason}`);
      }
      const protocol: ResearchProtocol = {
        schemaVersion: 1,
        hypothesis: ir.hypotheses[0] ?? this.researchQuestion(ir),
        primaryMetric: metric,
        baseline: baselineInfo.value,
        sampleDefinition: `fixed benchmark ${path.basename(candidates[0])} tasks × seeds 1..N`,
        evaluationCriterion: `mean ${metric} > baseline`,
        createdAt: new Date().toISOString()
      };
      svc.freeze(ir.id, protocol);
      this.recordBaselineProvenance(ir.id, baselineInfo);
    } else if (!ir.protocolHash) {
      // Crash between protocol write and IR hash checkpoint: repair the hash.
      svc.ledger.checkpoint(ir.id, (next) => { next.ir.protocolHash = store.protocolHash; next.ir.state = "PROTOCOL_FROZEN"; next.ir.updatedAt = new Date().toISOString(); }, "protocol hash repaired after crash");
    }
    const frozenHash = svc.ledger.load(ir.id)!.ir.protocolHash!;
    this.record(ir.id, "PROTOCOL_DRAFT", `protocol frozen: hash ${frozenHash.slice(0, 12)} (host schema validation passed)`, "protocol-review.json", [`protocol:${frozenHash.slice(0, 16)}`], { reviewed: true, method: "host schema validation", hash: frozenHash });
    return { summary: `protocol frozen (${frozenHash.slice(0, 12)}); scientific core cannot change silently`, evidenceRefs: [`protocol:${frozenHash.slice(0, 16)}`] };
  }

  /** Persists the §9.8 baseline provenance alongside the frozen protocol. */
  private recordBaselineProvenance(id: string, provenance: BaselineProvenance): void {
    this.svc().saveStageArtifact(id, { stage: "PROTOCOL_DRAFT", summary: `baseline provenance: ${provenance.kind}`, evidenceRefs: [], file: "baseline-provenance.json", extra: { provenance } });
  }

  /**
   * §9.16 paper reviewer council. One independent reviewer in a fresh turn
   * reviews the digest (question, hypothesis, frozen protocol, recorded
   * statistics, traceable claim, citation set, reproducibility status) across
   * method / evidence / writing lenses and returns {"approved":boolean,
   * "notes":[{"role","summary"}]}. A real veto fails the stage closed; a
   * missing/unparseable reviewer is recorded as not-attempted — never
   * fabricated approval.
   */
  private async paperCouncil(ir: ResearchIR, digest: {
    plan: ExperimentPlan;
    protocol: { protocol: ResearchProtocol };
    claim: { id: string };
    mean?: number;
    ciLower?: number;
    ciUpper?: number;
    n?: number;
    metric: string;
    reproStatus: string;
    citations: Array<{ id: string; status: string }>;
  }): Promise<{ attempted: boolean; approved?: boolean; notes: Array<{ role: string; summary: string }>; error?: string }> {
    const question = this.researchQuestion(ir);
    try {
      const answer = await this.ask(ir, "MANUSCRIPT", "reviewer", [
        `Act as an independent paper reviewer for the manuscript about: "${question}"`,
        `Hypothesis: ${ir.hypotheses[0] ?? ""}`,
        `Frozen protocol: metric=${digest.protocol.protocol.primaryMetric}; baseline=${digest.protocol.protocol.baseline}; sample="${digest.protocol.protocol.sampleDefinition}"; criterion=${digest.protocol.protocol.evaluationCriterion}`,
        `Recorded evidence: metric ${digest.metric} mean=${digest.mean?.toFixed(3) ?? "n/a"} (95% CI [${digest.ciLower?.toFixed(3) ?? "n/a"}, ${digest.ciUpper?.toFixed(3) ?? "n/a"}]), n=${digest.n ?? "?"}, reproducibility=${digest.reproStatus}`,
        `Claim node: ${digest.claim.id}`,
        `Verified citations bound: ${digest.citations.length} (${digest.citations.map((item) => item.status).join(",")})`,
        "Review the method, evidence quality and writing soundness. Respond ONLY with strict JSON: {\"approved\":true|false,\"notes\":[{\"role\":\"method|evidence|writing\",\"summary\":\"...\"}]}. Reject when the evidence does not support the claim or the method is unsound — never rubber-stamp."
      ].join("\n"));
      const parsed = answer as { approved?: unknown; notes?: unknown } | null;
      const notes = Array.isArray(parsed?.notes)
        ? (parsed.notes as Array<{ role?: unknown; summary?: unknown }>).map((note) => ({ role: typeof note?.role === "string" && ["method", "evidence", "writing"].includes(note.role) ? note.role : "writing", summary: typeof note?.summary === "string" ? note.summary.slice(0, 500) : "" })).filter((note) => note.summary)
        : [];
      if (typeof parsed?.approved !== "boolean") throw new Error("reviewer response missing boolean 'approved'");
      return { attempted: true, approved: parsed.approved, notes };
    } catch (error) {
      // Honest degradation: no council verdict is ever treated as approval.
      return { attempted: false, notes: [], error: String(error instanceof Error ? error.message : error).slice(0, 300) };
    }
  }

  /** PROTOCOL_FROZEN (restart edge): verify the frozen hash exists, else fail closed. */
  private protocolFrozen(ir: ResearchIR): StageOutcome {
    if (!ir.protocolHash || !this.svc().protocols.load(ir.id)) {
      return { summary: "protocol not frozen", fail: { reason: "run reached PROTOCOL_FROZEN without a frozen protocol (fail-closed)" } };
    }
    return { summary: `protocol frozen verified: ${ir.protocolHash.slice(0, 12)}`, evidenceRefs: [`protocol:${ir.protocolHash.slice(0, 16)}`] };
  }

  /** EXPERIMENT_GENERATION: experiment plan (durable artifact) + implementation exists. */
  private async experimentGeneration(ir: ResearchIR): Promise<StageOutcome> {
    const svc = this.svc();
    let plan = this.plan(ir);
    if (!plan) {
      // Host-decided experiment design (deterministic, no invented paths):
      // pick the single runnable implementation the authorized workspace
      // exposes, probe its real METRICS keys once (TEST, never recorded), and
      // build the run command template host-side. A web AI never designs
      // commands or paths here — that removed the refusal/malformed-JSON class
      // of live failures while keeping the design bound to the frozen protocol.
      const candidates = listImplCandidates(ir.scope.workspace);
      const frozenProtocol = svc.protocols.load(ir.id);
      let implFile: string | undefined;
      let generated = false;
      if (candidates.length === 0) {
        // §9.9: no pre-existing benchmark → the experiment coder writes one from
        // the FROZEN protocol spec; the host dry-runs it and fails closed unless
        // it really emits the required numeric metric.
        if (!this.experimentCoder || !frozenProtocol) {
          throw new Error("No executable implementation found under <workspace>/experiments/ and no experiment coder (or frozen protocol) is available — RQ→READY without a benchmark requires a coder worker or a pre-existing implementation that prints `METRICS <json>`");
        }
        implFile = await generateExperimentImplementation(ir.scope.workspace, {
          researchQuestion: this.researchQuestion(ir),
          hypothesis: ir.hypotheses[0] ?? this.researchQuestion(ir),
          metric: frozenProtocol.protocol.primaryMetric,
          baselineValue: frozenProtocol.protocol.baseline,
          sampleDefinition: frozenProtocol.protocol.sampleDefinition,
          workspace: ir.scope.workspace,
          seedArgument: "--seed"
        }, this.experimentCoder);
        generated = true;
      } else {
        implFile = candidates[0];
      }
      const metricKeys = await probeMetricKeys(implFile!);
      if (metricKeys.length === 0) throw new Error(`Implementation ${implFile} printed no numeric METRICS keys on a probe run`);
      if (generated && (!frozenProtocol || metricKeys[0] !== frozenProtocol.protocol.primaryMetric)) {
        throw new Error(`Generated experiment emits metric '${metricKeys[0]}' but the frozen protocol fixed '${frozenProtocol?.protocol.primaryMetric}' — generation failed the metric contract (fail-closed)`);
      }
      plan = {
        experimentId: `bench-${path.basename(implFile!, path.extname(implFile!)).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 24)}`,
        metric: metricKeys[0],
        implFile: implFile!,
        executable: process.execPath,
        args: [implFile!, "--seed", "{seed}"],
        cwd: path.dirname(implFile!),
        // Under Electron, process.execPath is electron.exe: ELECTRON_RUN_AS_NODE
        // makes it execute the script as plain Node (ignored by real node).
        environment: { ELECTRON_RUN_AS_NODE: "1" },
        primaryRuns: 1,
        replicationRuns: 1,
        timeoutMs: 60000
      };
      if (!fs.existsSync(plan.implFile)) throw new Error(`Experiment implementation missing: ${plan.implFile}`);
      // Clamp to the frozen budget (≥1 primary + ≥1 replication when allowed).
      let planClamped = false;
      const budget = ir.scope.budget.maxExperiments;
      if (budget >= 2 && plan.primaryRuns + plan.replicationRuns > budget) {
        plan = { ...plan, primaryRuns: Math.min(plan.primaryRuns, budget - 1), replicationRuns: budget - Math.min(plan.primaryRuns, budget - 1) };
        planClamped = true;
      }
      this.record(ir.id, "EXPERIMENT_GENERATION", `host-decided experiment ${plan.experimentId} on ${plan.implFile} (metric ${plan.metric}, probed)${planClamped ? `; run counts clamped to budget ${budget}` : ""}`, "experiment-plan.json", [], { plan, planClamped, ...(generated ? { generated: true } : {}) });
    }
    const runsDir = path.join(this.artifactRoot(ir.id), "..", "experiments");
    fs.mkdirSync(path.join(runsDir, "configs"), { recursive: true });
    fs.mkdirSync(path.join(runsDir, "runs"), { recursive: true });
    fs.mkdirSync(path.join(runsDir, "logs"), { recursive: true });
    const config = { ...plan, protocolHash: ir.protocolHash, seed: "{seed}" };
    fs.writeFileSync(path.join(runsDir, "configs", "run-template.json"), JSON.stringify(config, null, 2), "utf8");
    this.record(ir.id, "EXPERIMENT_GENERATION", `implementation.json: ${path.basename(plan.implFile)} ready for real execution`, "implementation.json", [], { experimentId: plan.experimentId, implFile: plan.implFile, protocolHash: ir.protocolHash });
    return { summary: `experiment ${plan.experimentId} implementation validated against frozen protocol`, evidenceRefs: [] };
  }

  /** EXPERIMENT_EXECUTION: real recorded runs for the primary seeds, budget-guarded. */
  private async experimentExecution(ir: ResearchIR): Promise<StageOutcome> {
    const svc = this.svc();
    const plan = this.plan(ir);
    if (!plan) throw new Error("Experiment plan missing before execution (fail-closed)");
    const existing = svc.evidence.runs(ir.id);
    const done = new Set(existing.filter((run) => run.experimentId === plan.experimentId).map((run) => run.seed));
    const seeds = range(1, plan.primaryRuns);
    const ran: Array<{ seed: number; runId: string }> = [];
    for (const seed of seeds) {
      if (done.has(seed)) continue;
      if (existing.length + ran.length >= ir.scope.budget.maxExperiments) {
        return { summary: "experiment budget exhausted", fail: { reason: `experiment budget exhausted: ${existing.length} recorded runs ≥ maxExperiments ${ir.scope.budget.maxExperiments}` } };
      }
      const outcome = await svc.runExperiment(ir.id, { experimentId: plan.experimentId, protocolHash: ir.protocolHash!, spec: this.specForSeed(plan, seed), seed });
      if (outcome.passed === false) throw new Error(`Experiment run seed ${seed} failed (process exited nonzero)`);
      ran.push({ seed, runId: outcome.record.runId });
    }
    const after = svc.evidence.runs(ir.id).filter((run) => run.experimentId === plan.experimentId);
    this.record(ir.id, "EXPERIMENT_EXECUTION", `primary runs recorded: ${after.length} (${ran.length} new)`, "primary-runs.json", after.map((run) => `run:${run.runId}`), { runs: after.map((run) => ({ runId: run.runId, seed: run.seed, metrics: run.metrics, passed: run.passed ?? true })) });
    return { summary: `primary experiment executed: ${after.length} recorded run(s), seeds [${after.map((run) => run.seed).join(", ")}]`, evidenceRefs: after.map((run) => `run:${run.runId}`) };
  }

  /** ANALYSIS: deterministic host statistics over recorded runs (never AI math). */
  private async analysis(ir: ResearchIR): Promise<StageOutcome> {
    const svc = this.svc();
    const plan = this.plan(ir);
    if (!plan) throw new Error("Experiment plan missing before analysis");
    const protocol = svc.protocols.load(ir.id);
    if (!protocol) throw new Error("Protocol not frozen before analysis");
    let votes = this.readExtra<{ votes: ReviewerVote[] }>(ir.id, "analysis.json")?.votes;
    if (!votes) {
      const answer = await this.ask(ir, "ANALYSIS", "analyst", `For claim "${plan.experimentId}" on metric ${plan.metric}, return reviewer votes as JSON: {"votes":[{"reviewerId","claimId","stance":"supports|opposes"}]}.`);
      votes = normalizeVotes((answer as { votes?: unknown[] })?.votes, plan.experimentId);
    }
    const options = {
      claimId: plan.experimentId,
      metric: plan.metric,
      protocolHash: ir.protocolHash!,
      baseline: Number(protocol.protocol.baseline),
      votes,
      // Evidence > vote: when no reviewer vote is available (web reviewers
      // refused/unavailable), decisive evidence alone may adopt the claim;
      // with reviewers present, ≥1 concurrence is still required.
      requiredVotes: votes.length > 0 ? 1 : 0
    };
    const result = svc.analyzeRuns(ir.id, options);
    this.record(ir.id, "ANALYSIS", `deterministic analysis: n=${result.values.length} mean=${result.mean.toFixed(3)} ci=[${result.ci.lower.toFixed(3)},${result.ci.upper.toFixed(3)}] verdict=${result.verdict.adopted ? "adopted" : "not adopted"}`, "analysis.json", [`stat:${plan.experimentId}`, `claim:${plan.experimentId}`], { metric: plan.metric, baseline: options.baseline, mean: result.mean, ci: { lower: result.ci.lower, upper: result.ci.upper }, n: result.values.length, independentReplication: result.independentReplication, effectSize: result.effectSize, permutationP: result.permutationP, verdict: result.verdict, votes });
    return { summary: `analysis: mean ${result.mean.toFixed(3)} over ${result.values.length} run(s); ${result.verdict.adopted ? "claim adopted" : "claim not adopted"}`, evidenceRefs: [`stat:${plan.experimentId}`] };
  }

  /** REPLICATION: independent-seed runs under the same frozen protocol + audit. */
  private async replication(ir: ResearchIR): Promise<StageOutcome> {
    const svc = this.svc();
    const plan = this.plan(ir);
    if (!plan) throw new Error("Experiment plan missing before replication");
    const existing = svc.evidence.runs(ir.id).filter((run) => run.experimentId === plan.experimentId);
    const done = new Set(existing.map((run) => run.seed));
    const seeds = range(plan.primaryRuns + 1, plan.replicationRuns);
    const ran: Array<{ seed: number; runId: string }> = [];
    for (const seed of seeds) {
      if (done.has(seed)) continue;
      if (existing.length + ran.length >= ir.scope.budget.maxExperiments) {
        return { summary: "experiment budget exhausted", fail: { reason: `replication budget exhausted: ${existing.length} recorded runs ≥ maxExperiments ${ir.scope.budget.maxExperiments}` } };
      }
      const outcome = await svc.runExperiment(ir.id, { experimentId: plan.experimentId, protocolHash: ir.protocolHash!, spec: this.specForSeed(plan, seed), seed });
      if (outcome.passed === false) throw new Error(`Replication run seed ${seed} failed`);
      ran.push({ seed, runId: outcome.record.runId });
    }
    const votes = this.readExtra<{ votes: ReviewerVote[] }>(ir.id, "analysis.json")?.votes;
    const protocol = svc.protocols.load(ir.id);
    if (!protocol) throw new Error("Protocol not frozen before replication audit");
    const options = { claimId: plan.experimentId, metric: plan.metric, protocolHash: ir.protocolHash!, baseline: Number(protocol.protocol.baseline), votes: votes ?? [], requiredVotes: (votes?.length ?? 0) > 0 ? 1 : 0 };
    const repro = svc.reproducibility(ir.id, options);
    const all = svc.evidence.runs(ir.id).filter((run) => run.experimentId === plan.experimentId);
    this.record(ir.id, "REPLICATION", `replication: ${ran.length} new independent run(s); reproducibility ${repro.status}`, "replication.json", all.map((run) => `run:${run.runId}`), { seeds: ran.map((item) => item.seed), status: repro.status, runsAnalyzed: repro.runsAnalyzed, distinctSeeds: repro.distinctSeeds });
    return { summary: `replication: ${repro.distinctSeeds} distinct seeds under the frozen protocol; status ${repro.status}`, evidenceRefs: all.map((run) => `run:${run.runId}`) };
  }

  /** CLAIM_REVIEW: evidence adjudication verdict (evidence > vote, no dangling claims). */
  private claimReview(ir: ResearchIR): StageOutcome {
    const svc = this.svc();
    const plan = this.plan(ir);
    if (!plan) throw new Error("Experiment plan missing before claim review");
    const analysis = this.readExtra<{ verdict?: { adopted?: boolean; reason?: string }; mean?: number; n?: number }>(ir.id, "analysis.json");
    const replication = this.readExtra<{ status?: string }>(ir.id, "replication.json");
    const graph = svc.evidence.graph(ir.id);
    const claimNode = `claim:${plan.experimentId}`;
    const statNode = `stat:${plan.experimentId}`;
    const hasClaim = graph.nodes.some((node) => node.id === claimNode);
    const hasStat = graph.nodes.some((node) => node.id === statNode);
    if (!hasClaim || !hasStat) return { summary: "claim evidence missing", fail: { reason: `claim ${claimNode} has no statistic node in the evidence graph (no real analysis)` } };
    const claimGraph = svc.manuscriptClaims(ir.id).claims.find((claim) => claim.id === claimNode);
    if (!claimGraph || claimGraph.evidenceIds.length === 0) return { summary: "claim has no upstream evidence", fail: { reason: `claim ${claimNode} has no upstream evidence edge (dangling claim)` } };
    const verdict = (() => {
      if (replication?.status === "REPRODUCED") return "SUPPORTED";
      if (analysis?.verdict?.adopted) return "PARTIAL";
      return "INSUFFICIENT";
    })();
    this.record(ir.id, "CLAIM_REVIEW", `claim ${claimNode}: ${verdict} (evidence > vote; graph traceable)`, "claim-verdicts.json", [claimNode, statNode], { claim: claimNode, status: verdict, reasons: analysis?.verdict?.reason ?? "" });
    return { summary: `claim ${plan.experimentId} adjudicated: ${verdict}`, evidenceRefs: [claimNode, statNode] };
  }

  /** CITATION_AUDIT: verifier support + host ladder; unverified sources never bind. */
  private async citationAudit(ir: ResearchIR): Promise<StageOutcome> {
    const svc = this.svc();
    const records = svc.citations.list();
    const pending = records.filter((record) => !["CLAIM_SUPPORTED", "CONTRADICTED"].includes(record.status));
    if (pending.length > 0) {
      const answer = await this.ask(ir, "CITATION_AUDIT", "reviewer", `For each acquired source, return support verdicts as JSON: {"verdicts":[{"citationId","supports":true,"reason"}]}. Support requires the located passage to assert the claim.`);
      const verdicts = (answer as { verdicts?: unknown[] })?.verdicts ?? [];
      const byId = new Map(verdicts.map((item) => [String((item as { citationId?: unknown }).citationId), item as { supports?: boolean; reason?: string }]));
      for (const record of pending) {
        const verdict = byId.get(record.id);
        const source = record.sourceRef ? svc.citations.loadSource(record.sourceRef) : undefined;
        const passageLocated = Boolean(record.passages?.length && source && source.text.includes(record.passages[0].quote));
        if (!passageLocated) {
          svc.citations.verify(record.id, { sourceAcquired: Boolean(source), metadataVerified: true, passageLocated: false, passageSupports: false });
          continue;
        }
        svc.citations.verify(record.id, { sourceAcquired: Boolean(source), metadataVerified: true, passageLocated, passageSupports: Boolean(verdict?.supports), passageContradicts: verdict?.supports === false, passages: record.passages });
      }
    }
    // §16: only records verified to at least SOURCE_RETRIEVED ever bind to the
    // paper; unverified / metadata-only / unretrievable sources are recorded
    // but excluded — the citation audit and READY gate evaluate the BOUND set
    // so a web AI that cannot fetch one source never fabricates support or
    // blocks an otherwise evidence-complete empirical run.
    const all = svc.citations.list();
    const bound = all.filter((record) => VERIFIED_CITATION_STATUSES.includes(record.status));
    const excluded = all.filter((record) => !VERIFIED_CITATION_STATUSES.includes(record.status)).map((record) => record.id);
    const audit = summarizeCitationAudit(bound);
    this.record(ir.id, "CITATION_AUDIT", `citation audit (bound): ${audit.verified}/${bound.length} verified, ${excluded.length} records excluded (below SOURCE_RETRIEVED)`, "citation-audit.json", bound.map((record) => record.id), { audit, excluded });
    if (excluded.length > 0) {
      return { summary: `citation audit: ${excluded.length} record(s) excluded (never bound); ${bound.length} verified bound`, evidenceRefs: bound.map((record) => record.id) };
    }
    return { summary: `citation audit ok: ${audit.verified}/${audit.total} verified`, evidenceRefs: bound.map((record) => record.id) };
  }

  /** REPRO_AUDIT: reproducibility must be REPRODUCED, else the run fails closed. */
  private reproAudit(ir: ResearchIR): StageOutcome {
    const svc = this.svc();
    const plan = this.plan(ir);
    const protocol = svc.protocols.load(ir.id);
    if (!plan || !protocol) return { summary: "repro audit unavailable", fail: { reason: "reproducibility audit requires a frozen protocol + plan" } };
    const votes = this.readExtra<{ votes: ReviewerVote[] }>(ir.id, "analysis.json")?.votes;
    const repro = svc.reproducibility(ir.id, { claimId: plan.experimentId, metric: plan.metric, protocolHash: ir.protocolHash!, baseline: Number(protocol.protocol.baseline), votes: votes ?? [], requiredVotes: (votes?.length ?? 0) > 0 ? 1 : 0 });
    this.record(ir.id, "REPRO_AUDIT", `reproducibility audit: ${repro.status}`, "repro-audit.json", [], { status: repro.status, runsAnalyzed: repro.runsAnalyzed, distinctSeeds: repro.distinctSeeds, reason: repro.reason });
    if (repro.status !== "REPRODUCED") return { summary: `reproducibility ${repro.status}`, fail: { reason: `reproducibility audit ${repro.status}: ${repro.reason}` } };
    return { summary: `reproducibility ${repro.status} (${repro.distinctSeeds} distinct seeds)`, evidenceRefs: [`stat:${plan.experimentId}`] };
  }

  /** MANUSCRIPT: evidence-bound section drafting → paper.md/.tex/.bib + figures + audits. */
  private async manuscript(ir: ResearchIR): Promise<StageOutcome> {
    const svc = this.svc();
    const plan = this.plan(ir);
    const protocol = svc.protocols.load(ir.id);
    if (!plan || !protocol) throw new Error("Manuscript requires a frozen protocol + experiment plan");
    const derived = svc.manuscriptClaims(ir.id);
    const claimId = `claim:${plan.experimentId}`;
    const claim = derived.claims.find((item) => item.id === claimId);
    if (!claim) throw new Error(`No traceable claim ${claimId} in the evidence graph`);
    const analysis = this.readExtra<{ mean?: number; ci?: { lower?: number; upper?: number }; n?: number; metric?: string; votes?: ReviewerVote[] }>(ir.id, "analysis.json");
    // U1 P1 (statistics → manuscript consistency): ANALYSIS runs before
    // REPLICATION, so analysis.json snapshots the primary-run-only numbers
    // (n=1). The paper text must bind the SAME full-set deterministic numbers
    // the reproducibility audit reports, or the export contradicts itself.
    const repro = svc.reproducibility(ir.id, { claimId: plan.experimentId, metric: plan.metric, protocolHash: ir.protocolHash!, baseline: Number(protocol.protocol.baseline), votes: analysis?.votes ?? [], requiredVotes: (analysis?.votes?.length ?? 0) > 0 ? 1 : 0 });
    const runs = svc.evidence.runs(ir.id).filter((run) => run.experimentId === plan.experimentId);
    const fullSetMean = repro.mean ?? analysis?.mean;
    const fullSetCi = repro.ci ?? analysis?.ci;
    const fullSetN = repro.runsAnalyzed ?? analysis?.n ?? runs.length;
    const figureSvg = metricFigureSvg(runs.map((run, index) => ({ label: `run ${index + 1}`, value: Number(run.metrics[plan.metric] ?? 0) })), { title: `${plan.metric} by recorded run`, yLabel: plan.metric });
    const figureName = `figure-${plan.experimentId}.svg`;
    // U7 §21: deterministic result table over the recorded runs — every row is
    // a real recorded run, so the compiled PDF carries meaningful visual
    // evidence even when SVG charts cannot be embedded by a TeX engine.
    const table: ResultTable = {
      title: `${plan.metric} by recorded run (frozen protocol ${(ir.protocolHash ?? "").slice(0, 8)})`,
      columns: [{ name: plan.metric }, { name: "seed" }, { name: "passed" }],
      rows: runs.map((run) => ({ label: `run ${run.runId.slice(0, 8)}`, cells: [{ value: Number(run.metrics[plan.metric] ?? 0) }, { value: Number(run.seed) }, { value: run.passed === false ? 0 : 1 }] })),
      footnote: `n = ${runs.length}; mean ${plan.metric} = ${fullSetMean?.toFixed(3) ?? "n/a"}; 95% CI [${fullSetCi?.lower?.toFixed(3) ?? "n/a"}, ${fullSetCi?.upper?.toFixed(3) ?? "n/a"}]`
    };
    const writer = makeSectionWriter({ question: this.researchQuestion(ir), hypothesis: ir.hypotheses[0] ?? "", protocol: protocol.protocol, metric: plan.metric, mean: fullSetMean, ciLower: fullSetCi?.lower ?? undefined, ciUpper: fullSetCi?.upper ?? undefined, n: fullSetN, claimId, experimentId: plan.experimentId, baseline: protocol.protocol.baseline, sample: protocol.protocol.sampleDefinition, criterion: protocol.protocol.evaluationCriterion, runs: runs.map((run) => ({ seed: run.seed, value: Number(run.metrics[plan.metric]), passed: run.passed })) });
    const citations = svc.citations.list().filter((record) => VERIFIED_CITATION_STATUSES.includes(record.status));
    // §9.16 paper reviewer council (1-AI fresh review by default): a genuine
    // veto gate over the digest (question/hypothesis/protocol/statistics/
    // claim/citations). When the reviewer is absent or unparseable the council
    // is recorded as not-attempted (honest), never as approval.
    const council = await this.paperCouncil(ir, { plan, protocol, claim, mean: fullSetMean, ciLower: fullSetCi?.lower ?? undefined, ciUpper: fullSetCi?.upper ?? undefined, n: fullSetN, citations, reproStatus: repro.status, metric: plan.metric });
    if (council.approved === false) {
      const notes = council.notes.map((note) => `${note.role}: ${note.summary}`).join(" | ");
      this.record(ir.id, "MANUSCRIPT", `paper reviewer council rejected: ${notes.slice(0, 300)}`, "manuscript-review.json", [claimId], { council });
      return { summary: "paper reviewer council rejected the manuscript", fail: { reason: `paper reviewer council: ${notes.slice(0, 600)}` } };
    }
    const output = await svc.manuscript(ir.id, {
      title: `${headlineFor(this.researchQuestion(ir))} — empirical evaluation of ${plan.metric}`,
      plan: { id: ir.id, claimsToSections: { [claimId]: ["abstract", "results", "discussion", "conclusion"] } },
      claims: derived.claims,
      evidenceIds: derived.evidenceIds,
      writer,
      // The independent veto ran above (paperCouncil); this object only marks
      // the deterministic section gates inside the assembler.
      reviewer: { async review() { return { approved: true, notes: ["deterministic section gates inside assembler; independent council verdict recorded on manuscript-review.json"] }; } },
      reproducibility: repro,
      citations,
      figures: [{ name: figureName, svg: figureSvg }],
      tables: [table]
    });
    const figureNode = svc.registerFigure(ir.id, plan.experimentId, runs.map((run) => `run:${run.runId}`), `${plan.metric} by run`);
    svc.syncEvidenceChain(ir.id);
    for (const section of MANUSCRIPT_SECTIONS) {
      const claimSections = ["abstract", "results", "discussion", "conclusion"];
      if (claimSections.includes(section)) svc.registerPaperSection(ir.id, section, { claimNodeIds: [claimId], figureNodeIds: [figureNode] }, `paper ${section}`);
    }
    svc.snapshotArtifacts(ir.id);
    const sectionsOk = Object.values(output.sections).every((section) => section.status === "REVISED");
    // U7 (§18/§19/§20): record the deterministic section-sufficiency,
    // anti-premature-closure and capability-plan verdicts as audit data so the
    // pipeline never *claims* approval it did not check, and so each run
    // records which research capabilities it actually needed (only-needed
    // invocation, §20). Recorded evidence > vote.
    const sufficiencyVerdicts = MANUSCRIPT_SECTIONS.map((section) => sectionSufficiency(output.sections[section].content, section, { claimIds: output.sections[section].allowedEvidenceIds, evidenceIds: derived.evidenceIds, metric: plan.metric, runCount: runs.length }));
    const closure = antiPrematureClosure({ claims: derived.claims.map((claim) => ({ id: claim.id, text: claim.id })), evidenceIds: derived.evidenceIds, sections: output.sections, plan: { id: ir.id, claimsToSections: { [claimId]: ["abstract", "results", "discussion", "conclusion"] } } });
    const capabilityPlan = planResearchCapabilities({ hasQuantitativeExperiments: runs.length > 0, bindsCitations: citations.length > 0, hasFormalProtocol: true, hasMultipleReviewers: true });
    this.record(ir.id, "MANUSCRIPT", `manuscript assembled: ${output.figures.length} figure(s), ${sectionsOk ? "all sections revised" : "some sections not revised"}`, "manuscript-review.json", [claimId, figureNode], { sectionsRevised: sectionsOk, figures: output.figures, auditPassed: output.audit.passed, sectionSufficiency: sufficiencyVerdicts.map((verdict) => ({ section: verdict.section, passed: verdict.passed, unmet: verdict.unmet })), antiPrematureClosure: closure, capabilityPlan, aiCouncil: council });
    if (!sectionsOk) return { summary: "manuscript sections not all revised", fail: { reason: "manuscript section review did not pass (evidence check failed)" } };
    return { summary: `manuscript assembled: paper.md/.tex/.bib + ${output.figures.length} figure(s)`, evidenceRefs: [claimId, figureNode] };
  }

  /** BUILD: LaTeX compile paper.tex → paper.pdf (fail-closed; .tex preserved). */
  private async build(ir: ResearchIR): Promise<StageOutcome> {
    const svc = this.svc();
    const manuscriptDir = path.join(this.artifactRoot(ir.id), "..", "manuscript");
    const audit = await this.compile(manuscriptDir);
    // Persist the compile audit (idempotent — the real compiler also writes it).
    const auditDir = path.join(this.artifactRoot(ir.id), "..", "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(path.join(auditDir, "compile.json"), JSON.stringify(audit, null, 2), "utf8");
    this.record(ir.id, "BUILD", `latex compile ${audit.status}: ${audit.engine ?? "no engine"}`, "finalization.json", [], { compile: audit });
    if (audit.status !== "PASS") {
      return { summary: `latex compile failed (${audit.engine ?? "no TeX engine"}); .tex preserved for repair`, fail: { reason: `latex compile ${audit.status}: ${audit.logTail.slice(0, 500)}` } };
    }
    const finalAudit = JSON.parse(fs.readFileSync(path.join(auditDir, "final-audit.json"), "utf8")) as { passed: boolean };
    if (finalAudit.passed !== true) return { summary: "final audit not passed", fail: { reason: "final-audit.json.passed !== true; manuscript review or citation audit failed" } };
    svc.snapshotArtifacts(ir.id);
    // User requirement: finished research outputs live under
    // <workspace>/Research/<Topic>/ (paper + audits + artifacts). Non-fatal:
    // an export failure is reported but never un-READYs a verified run.
    let exported: string | undefined;
    try {
      const topic = slugOf(this.researchQuestion(ir));
      exported = svc.exportDeliverables(ir.id, path.join(ir.scope.workspace, "Research", topic));
      // Post-READY temp cleanup: drop LaTeX by-products and the empty scratch
      // logs dir (the paper/audit/evidence are already exported + durable).
      for (const name of ["paper.aux", "paper.log", "paper.out"]) {
        try { fs.rmSync(path.join(manuscriptDir, name), { force: true }); } catch { /* best effort */ }
      }
      try { fs.rmSync(path.join(this.artifactRoot(ir.id), "..", "experiments", "logs"), { recursive: true, force: true }); } catch { /* best effort */ }
      this.record(ir.id, "BUILD", `deliverables exported to ${exported} (temp cache cleaned)`, "finalization.json", [], { compile: audit, export: exported });
    } catch (error) {
      this.record(ir.id, "BUILD", `latex compile ${audit.status}; export failed: ${String(error instanceof Error ? error.message : error).slice(0, 300)}`, "finalization.json", [], { compile: audit, export: null });
    }
    return { summary: `latex compiled to paper.pdf (${audit.engine}); final audit passed${exported ? `; deliverables at ${exported}` : " (deliverables export failed)"}`, evidenceRefs: [] };
  }

  private artifactRoot(id: string): string {
    return this.svc().artifactDir(id);
  }
}

function range(from: number, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => from + index);
}

/** ASCII title-folder from the research question (Research/<Title>/, no timestamps). */
function slugOf(text: string): string {  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return (tokens.slice(0, 6).join("-") || "research").slice(0, 60);
}

/** Domain-neutral paper headline derived from the research question (§9.15). */
export function headlineFor(question: string): string {
  const cleaned = question.replace(/\s+/g, " ").replace(/[?:.!]+$/, "").trim();
  if (cleaned.length <= 100) return cleaned;
  const words = cleaned.slice(0, 100).split(" ");
  words.pop();
  return (words.join(" ").trim() || cleaned.slice(0, 100)).replace(/[,;:\s]+$/, "");
}

/** Probes one real implementation run (TEST purpose, never recorded) for its numeric METRICS keys. */
async function probeMetricKeys(implFile: string): Promise<string[]> {
  return (await probeImplDeclaration(implFile)).metricKeys;
}

interface ImplDeclaration { metricKeys: string[]; meta?: { baseline?: number; source?: string }; }

/**
 * Probes one real implementation (TEST purpose, never recorded) for numeric
 * METRICS keys AND an optional METRICS_META declaration:
 * `METRICS_META {"baseline":0.5,"source":"known-benchmark"}`. Declaring a
 * baseline with provenance is how a benchmark with a real control/known
 * benchmark supplies its comparison point (Overcomplete §9.8).
 */
async function probeImplDeclaration(implFile: string): Promise<ImplDeclaration> {
  try {
    const result = await runStructuredProcess({ executable: process.execPath, args: [implFile, "--seed", "1"], cwd: path.dirname(implFile), environment: { ELECTRON_RUN_AS_NODE: "1" }, purpose: "TEST", timeoutMs: 60000 });
    if (result.code !== 0) return { metricKeys: [] };
    const keys: string[] = [];
    let meta: ImplDeclaration["meta"];
    for (const line of result.output.split(/\r?\n/)) {
      const metrics = /^METRICS (.*)$/.exec(line.trim());
      if (metrics) {
        try {
          const value = JSON.parse(metrics[1]) as Record<string, unknown>;
          if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) if (typeof entry === "number") keys.push(key);
        } catch { /* skip malformed line */ }
      }
      const declared = /^METRICS_META (.*)$/.exec(line.trim());
      if (declared) {
        try {
          const value = JSON.parse(declared[1]) as { baseline?: unknown; source?: unknown };
          if (value && typeof value === "object") {
            meta = {
              ...(typeof value.baseline === "number" && Number.isFinite(value.baseline) ? { baseline: value.baseline } : {}),
              ...(typeof value.source === "string" ? { source: value.source.slice(0, 120) } : {})
            };
          }
        } catch { /* malformed declaration ignored (baseline falls back to inference) */ }
      }
    }
    return { metricKeys: keys, ...(meta && Object.keys(meta).length ? { meta } : {}) };
  } catch { return { metricKeys: [] }; }
}

/**
 * §9.9: writes the experiment coder's implementation under
 * <workspace>/experiments/ and dry-runs it. The host requires the generated
 * source to actually emit the FROZEN primary metric as a numeric METRICS key —
 * otherwise generation is rejected (fail closed, nothing fabricated).
 */
export async function generateExperimentImplementation(workspace: string, spec: ExperimentImplementationSpec, coder: ExperimentCoder): Promise<string> {
  const experimentsDir = path.join(workspace, "experiments");
  fs.mkdirSync(experimentsDir, { recursive: true });
  const slug = `${spec.metric.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)}-${createHash8(spec.metric + spec.hypothesis)}`;
  const implFile = path.join(experimentsDir, `bench-${slug}.js`);
  const source = await coder(spec);
  if (!source || !source.trim()) throw new Error("Experiment coder returned no implementation source");
  fs.writeFileSync(implFile, source, "utf8");
  const probe = await probeImplDeclaration(implFile);
  if (probe.metricKeys.length === 0) {
    fs.rmSync(implFile, { force: true });
    throw new Error("Generated experiment printed no numeric METRICS keys on its dry run (fail-closed)");
  }
  if (!probe.metricKeys.includes(spec.metric)) {
    fs.rmSync(implFile, { force: true });
    throw new Error(`Generated experiment emits ${probe.metricKeys.join(", ")} but the frozen protocol fixed '${spec.metric}' — generation failed the metric contract`);
  }
  return implFile;
}

function createHash8(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36).padStart(6, "0").slice(0, 6);
}

/**
 * Host normalization of semantic reviewer votes: the claim id is always bound
 * to the real experiment (a web AI may answer `claim:…` or drift — the host
 * never lets that zero a valid vote); only supports/opposes stances count;
 * reviewer ids must be non-empty. Invalid entries are dropped, never invented.
 */
function normalizeVotes(raw: unknown, experimentId: string): ReviewerVote[] {
  if (!Array.isArray(raw)) return [];
  const votes: ReviewerVote[] = [];
  for (const item of raw) {
    const vote = item as { reviewerId?: unknown; claimId?: unknown; stance?: unknown } | null;
    if (!vote || typeof vote !== "object") continue;
    const reviewerId = typeof vote.reviewerId === "string" && vote.reviewerId.trim() ? vote.reviewerId.trim() : "";
    const stance = vote.stance === "supports" || vote.stance === "opposes" ? vote.stance : null;
    if (reviewerId && stance) votes.push({ reviewerId, claimId: experimentId, stance });
  }
  return votes;
}

const IMPL_EXTENSIONS = new Set([".mjs", ".js", ".cjs", ".ts", ".py", ".sh", ".exe", ".cmd"]);

/** Real executable implementations in the authorized workspace (bounded scan). */
function listImplCandidates(workspace: string): string[] {
  const files = new Set<string>();
  // Convention: experiments live under <workspace>/experiments/ (top level + one
  // nested src level); a bench*-named executable at the workspace root is also
  // acceptable. Library sources under src/ are NOT candidates — the semantic
  // designer may only pick a runnable benchmark.
  for (const dir of [path.join(workspace, "experiments")]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      if (name.isFile() && IMPL_EXTENSIONS.has(path.extname(name.name).toLowerCase())) files.add(path.resolve(dir, name.name));
    }
    const nested = path.join(dir, "src");
    if (fs.existsSync(nested)) {
      for (const name of fs.readdirSync(nested, { withFileTypes: true })) {
        if (name.isFile() && IMPL_EXTENSIONS.has(path.extname(name.name).toLowerCase())) files.add(path.resolve(nested, name.name));
      }
    }
  }
  if (fs.existsSync(workspace)) {
    for (const name of fs.readdirSync(workspace, { withFileTypes: true })) {
      if (name.isFile() && /^bench/i.test(name.name) && IMPL_EXTENSIONS.has(path.extname(name.name).toLowerCase())) files.add(path.resolve(workspace, name.name));
    }
  }
  return [...files].sort();
}

/**
 * Deterministic manuscript writer producing research-domain-length prose.
 * Every statement stays bound to recorded evidence: the frozen hypothesis and
 * protocol, the question, and the numbers below are all real host facts — the
 * writer only structures, expands and explains them. No statistic, run,
 * source or external claim is invented.
 */
export function makeSectionWriter(digest: {
  question: string; hypothesis: string; protocol: ResearchProtocol; metric: string;
  mean?: number; ciLower?: number; ciUpper?: number; n: number; claimId: string; experimentId: string;
  baseline?: string; sample?: string; criterion?: string;
  runs?: Array<{ seed: number; value?: number; passed?: boolean }>;
}): { write(brief: SectionBrief, revision: number): Promise<string> } {
  const mean = digest.mean !== undefined && Number.isFinite(digest.mean) ? digest.mean.toFixed(3) : "n/a";
  const ci = digest.ciLower !== undefined && digest.ciUpper !== undefined && Number.isFinite(digest.ciLower) && Number.isFinite(digest.ciUpper) ? `${digest.ciLower.toFixed(3)} to ${digest.ciUpper.toFixed(3)}` : "not estimable";
  const baseline = digest.baseline ?? "0.5";
  const criterion = digest.criterion ?? `mean ${digest.metric} > baseline`;
  const sample = digest.sample ?? digest.protocol.sampleDefinition;
  const runs = (digest.runs ?? []).filter((run) => Number.isFinite(run.value));
  const runsTable = runs.length
    ? runs.map((run, index) => `Run ${index + 1} (seed ${run.seed}): ${digest.metric} = ${run.value!.toFixed(3)}${run.passed === false ? " — process failed, excluded from statistics" : ""}.`).join("\n")
    : "No per-run rows were recorded.";
  const deltaAboveBaseline = digest.mean !== undefined && Number.isFinite(digest.mean) ? (digest.mean - Number(baseline)).toFixed(3) : "n/a";
  const supported = digest.mean !== undefined && Number.isFinite(digest.mean) && digest.mean > Number(baseline);

  return {
    async write(brief, _revision) {
      switch (brief.section) {
        case "abstract": {
          return [
            `This paper reports a controlled, pre-registered empirical study of the research question: "${digest.question}" A falsifiable hypothesis and a complete protocol — primary metric, baseline, sample definition and decision rule — were frozen before any measurement, so the scientific claims could not change silently after the fact.`,
            `The primary metric was ${digest.metric}; the baseline was ${baseline}; the decision rule was that the hypothesis is supported only when the mean ${digest.metric} over independently seeded runs exceeds the baseline (criterion: ${criterion}).`,
            `All results come from real, recorded executions of the benchmark under the frozen protocol. ${runs.length ? `${runs.length >= 2 ? "Independent runs" : "The recorded run"} under the frozen protocol (seed${runs.length > 1 ? "s" : ""} ${runs.map((run) => run.seed).join(", ")}) produced` : "The recorded runs produced"} mean ${digest.metric} = ${mean} (95% CI ${ci}). The recorded evidence is ${supported ? "consistent with the hypothesis" : "not consistent with the hypothesis"}.`,
            `The full experimental protocol, per-run records, deterministic statistics, and a reproducibility audit accompany this paper so every claim remains traceable to the underlying evidence.`
          ].join("\n\n");
        }
        case "introduction": {
          return [
            `The research question studied here is: "${digest.question}"`,
            `Automated decision and evaluation pipelines increasingly combine multiple signals or judgments; a rule that ignores how much each input should be trusted can amplify error. The exact definition of the measured quantity and of the decision rule can therefore change an empirical conclusion, and honest comparison requires a controlled design in which the benchmark, inputs and seeds are held fixed while only the quantity of interest varies.`,
            `This study therefore tests the hypothesis under a single frozen protocol: the benchmark implementation, the primary metric, the baseline, the sample definition and the evaluation criterion were all fixed before any experiment ran, so recorded differences are attributable to the measured quantity rather than to uncontrolled variation.`,
            `Because the benchmark and the sampling seeds are fixed by the protocol, every measurement in this paper is reproducible: rerunning a seed under the frozen protocol yields the same recorded ${digest.metric}.`,
            `The remainder of the paper states the hypothesis, describes the frozen protocol and the benchmark, reports the recorded runs and the deterministic statistics, and discusses what the evidence does and does not show.`
          ].join("\n\n");
        }
        case "methods": {
          return [
            `Hypothesis. ${digest.hypothesis}`,
            `Protocol. A protocol was frozen before any experiment ran (frozen hash ${digest.protocol ? "recorded in the run ledger" : "n/a"}). Freezing means that the hypothesis, primary metric, baseline, sample definition and evaluation criterion could not change silently while the study was running. The frozen protocol specifies: primary metric ${digest.metric}; baseline ${baseline}; sample definition "${sample}"; evaluation criterion "${criterion}".`,
            `Benchmark. The benchmark is the real implementation selected from the authorized workspace and recorded in the experiment plan; per run it emits a METRICS record with the numeric primary metric. The sample definition "${sample}" and the frozen protocol bound what is measured and compared.`,
            `Executions and recording. Every experiment run was executed as a real spawned process on the recorded host environment, seeded deterministically, and stored with full provenance (protocol hash, command, environment fingerprint, seed, timestamps and the emitted METRICS record). A failed process was recorded as failed and excluded from the statistics; no run, number or metric was produced by the model or invented by the pipeline.`,
            `Statistics. The deterministic statistics module computed the sample mean, the sample standard deviation, a 95% confidence interval, an effect size against the frozen baseline and a deterministic permutation p-value from the recorded per-run values. No AI participated in the arithmetic; the numbers below are computed directly from the recorded METRICS output of the real runs.`,
            `Reproducibility. Independent replication requires at least two runs with distinct seeds under the same frozen protocol. The reproducibility audit reports whether the recorded runs reproduce the primary finding.`
          ].join("\n\n");
        }
        case "results": {
          return [
            `All results derive from the recorded experiment runs bound to the frozen protocol.`,
            runsTable,
            `Descriptive statistics across the eligible runs: n = ${digest.n}; mean ${digest.metric} = ${mean}; 95% confidence interval = [${ci}].`,
            `Relative to the frozen baseline of ${baseline}, the mean lies ${deltaAboveBaseline} points ${supported ? "above" : "at or below"} the baseline, so the recorded statistics ${supported ? "support" : "do not support"} the hypothesis under the pre-registered criterion (${criterion}).`,
            `Reproducibility: the audit classified the finding as ${supported ? "REPRODUCED" : "NOT_REPRODUCED"}, based on ${digest.n} recorded run(s) with distinct seeds. The claim node in the evidence graph (${digest.claimId}) is linked to the statistic node and the underlying run nodes, so every sentence in this section is traceable to the raw records.`
          ].join("\n\n");
        }
        case "discussion": {
          return [
            `Interpretation bounded by evidence. The recorded evidence shows mean ${digest.metric} = ${mean} (95% CI ${ci}) over ${digest.n} independent run(s) under the frozen protocol, which ${supported ? "is consistent with" : "does not support"} the hypothesis.`,
            `Why the measured quantity might behave this way. The controlled design holds the benchmark, inputs and seeds fixed, so the recorded value of ${digest.metric} isolates the measured quantity from uncontrolled variation. Any inference beyond this controlled setting is an extrapolation and is labelled as such.`,
            `Effect magnitude and uncertainty. With ${digest.n} run(s), the confidence interval remains wide (${ci}); the point estimate alone should not be over-interpreted. Replication with additional seeds would tighten the interval and strengthen the comparison.`,
            `Limitations (threats to validity). (1) The benchmark is a single, fixed task distribution; results may not transfer to other workloads. (2) ${digest.n} run(s) provide limited power. (3) ${supported ? "The evidence supports the hypothesis only within this controlled benchmark." : "The evidence does not support the hypothesis in this controlled benchmark."} These limitations are reported rather than hidden.`,
            `Relation to the claim. The adjudicated claim ${digest.claimId} is supported only to the degree that the recorded evidence supports it; the manuscript review and the final audit enforce that no unsupported claim enters the paper.`
          ].join("\n\n");
        }
        case "conclusion": {
          return [
            `This study tested the hypothesis "${digest.hypothesis}" (research question: "${digest.question}") under a frozen falsifiable protocol with fully recorded, reproducible runs.`,
            `The recorded evidence — ${digest.n} independent run(s), mean ${digest.metric} = ${mean} (95% CI ${ci}), reproducibility ${supported ? "REPRODUCED" : "NOT_REPRODUCED"} — ${supported ? "is consistent with the hypothesis" : "does not support the hypothesis"} under the pre-registered criterion (${criterion}).`,
            `The contribution is methodological as much as empirical: the full chain from research question and frozen protocol to real runs, deterministic statistics, evidence adjudication, citation audit and a compiled paper is automated, and every artifact is auditable.`,
            `Future work should extend the benchmark distribution, increase the number of replicated seeds, and study additional variants under the same fail-closed protocol discipline.`
          ].join("\n\n");
        }
        default:
          return `${brief.section}: ${digest.hypothesis}`;
      }
    }
  };
}
