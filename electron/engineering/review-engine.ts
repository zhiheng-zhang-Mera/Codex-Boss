/**
 * Update-Plan/checkpoint-1.md §32 — the host side of the review gate.
 *
 * The pure checks live in `src/shared/review-checks.ts`; this module gathers the
 * artifacts they need: the §31.3 ledger rows per requirement, the per-requirement
 * ladder selections, the real contents of the files the change wrote, the
 * generated-directory classification and the §20 theme validation state. It then
 * assembles the §32 report and hands the label to the caller.
 *
 * The reviewer never widens its own authority: it inspects what the host can see,
 * records that as reviewed, and leaves the dimensions that need a reader of the
 * code (RACE, HIDDEN_FAILURE, SECURITY, FALSE_POSITIVE_TEST) unreviewed unless
 * another review layer supplies an evidence-bearing record.
 */
import fs from "node:fs";
import path from "node:path";
import { GENERATED_DIRECTORIES } from "./repo-inspector";
import { scanSecrets } from "../../src/shared/secret-scan";
import { outstandingEvidence, type EvidenceLedgerFile, type GateOutcome } from "../../src/shared/evidence-ledger";
import { signalsOf, type VerifiableRequirement, type WorkerScope } from "../../src/shared/verification";
import type { VerificationGate } from "../../src/shared/execution-planner";
import {
  buildReviewReport,
  planReview,
  type ReviewFinding,
  type ReviewPlan,
  type ReviewRecord,
  type ReviewReport
} from "../../src/shared/review";
import {
  hostReviewRecords,
  reviewFindings,
  type ReviewObservation,
  type RequirementObservation,
  type ThemeObservation
} from "../../src/shared/review-checks";

export interface ReviewEngineConfig {
  root: string;
  /** The verification engine whose §31.3 ledger is reviewed. */
  ledger: () => EvidenceLedgerFile;
  /** §31.2 rung demand per requirement (the verification engine's selection). */
  selectFor: (requirement: VerifiableRequirement) => { gates: readonly { gate: VerificationGate }[]; unavailable?: readonly { gate: VerificationGate }[] };
  generatedDirectories?: ReadonlyArray<{ path: string; reason: string }>;
  now?: () => Date;
}

export interface ReviewRequest {
  /** The requirements this change is supposed to satisfy. */
  requirements: readonly (VerifiableRequirement & { claims_complete: boolean })[];
  scope: WorkerScope;
  change: { changed_files: readonly string[]; new_files?: readonly string[] };
  refused_units?: readonly { problems: readonly string[] }[];
  unconfirmed_claims?: readonly { path: string; problem: string }[];
  themes?: readonly ThemeObservation[];
  /** Records and findings supplied by other review layers (a model reviewer). */
  extra_records?: readonly ReviewRecord[];
  extra_findings?: readonly ReviewFinding[];
}

export interface ReviewOutcome {
  plan: ReviewPlan;
  observation: ReviewObservation;
  findings: ReviewFinding[];
  records: ReviewRecord[];
  report: ReviewReport;
}

export interface ReviewEngine {
  review(request: ReviewRequest): ReviewOutcome;
  /** The §32 plan this host would apply to a change with these requirements. */
  planFor(requirements: readonly VerifiableRequirement[]): ReviewPlan;
}

export function createReviewEngine(config: ReviewEngineConfig): ReviewEngine {
  const root = fs.realpathSync(config.root);
  const now = config.now ?? (() => new Date());
  const generated = config.generatedDirectories ?? GENERATED_DIRECTORIES;

  const planFor = (requirements: readonly VerifiableRequirement[]): ReviewPlan => {
    const text = requirements.map((requirement) => requirement.text).join("\n");
    const signals = new Set(requirements.flatMap((requirement) => signalsOf(requirement.text)));
    return planReview({
      touches_theme: signals.has("theme"),
      touches_ui: requirements.some((requirement) => requirement.visual) || signals.has("appearance"),
      touches_persistence: signals.has("persistence") || signals.has("recovery"),
      touches_secrets_or_ipc: /ipc|preload|secret|credential|token|vault|密钥|凭据/i.test(text),
      files: []
    });
  };

  return {
    planFor,
    review(request) {
      const ledger = config.ledger();
      const plan = planFor(request.requirements);
      const byRequirement = new Map<string, RequirementObservation>();
      for (const requirement of request.requirements) {
        const rows = ledger.entries
          .filter((entry) => entry.requirement_ids.includes(requirement.id))
          .sort((left, right) => left.captured_at.localeCompare(right.captured_at) || left.id.localeCompare(right.id));
        // The review judges the CURRENT state: for each gate the newest row wins,
        // so a failure that a repair iteration already fixed stops blocking while
        // the historical rows stay visible through `evidence_ids`.
        const latest = new Map<VerificationGate, GateOutcome>();
        for (const row of rows) latest.set(row.gate, row.result);
        const selection = config.selectFor(requirement);
        byRequirement.set(requirement.id, {
          id: requirement.id,
          type: requirement.type,
          text: requirement.text,
          claims_complete: requirement.claims_complete,
          passed_gates: [...latest.entries()].filter(([, result]) => result === "PASS").map(([gate]) => gate),
          failed_gates: [...latest.entries()].filter(([, result]) => result === "FAIL").map(([gate]) => gate),
          evidence_ids: rows.map((row) => row.id),
          demanded_gates: selection.gates.map((decision) => decision.gate),
          unavailable_gates: (selection.unavailable ?? []).map((entry) => entry.gate),
          missing_evidence: outstandingEvidence(ledger, { nodes: request.requirements })
            .find((entry) => entry.requirement_id === requirement.id)?.missing ?? []
        });
      }

      const changedFiles = [...request.change.changed_files];

      // §32.2 SECRET_EXPOSURE: the real scanner reads the bytes that were written.
      const secretHits: { path: string; shapes: string[] }[] = [];
      for (const file of changedFiles) {
        const target = path.resolve(root, file);
        if (!target.startsWith(root) || !fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
        const content = fs.readFileSync(target, "utf8");
        const matches = scanSecrets(content);
        if (matches.length) secretHits.push({ path: file, shapes: [...new Set(matches.map((match) => match.shape))] });
      }

      // §32.1 architecture: generated artifacts must not be edited by hand.
      const generatedHits = changedFiles.filter((file) => generated.some((entry) => {
        const prefix = entry.path.replace(/\\/g, "/").replace(/\/$/, "");
        return file === prefix || file.startsWith(`${prefix}/`);
      }));

      const observation: ReviewObservation = {
        requirements: [...byRequirement.values()],
        scope: { allowed_files: [...request.scope.allowed_files], requirement_ids: [...request.scope.requirement_ids], workspace: request.scope.workspace || root },
        changed_files: changedFiles,
        changed_test_files: changedFiles.filter((file) => /(^|\/)(tests?|__tests__)\//i.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(file)),
        new_files: request.change.new_files ? [...request.change.new_files] : [],
        ...(request.refused_units ? { refused_units: request.refused_units.map((unit) => ({ problems: [...unit.problems] })) } : {}),
        ...(request.unconfirmed_claims ? { unconfirmed_claims: request.unconfirmed_claims.map((claim) => ({ ...claim })) } : {}),
        secret_hits: secretHits,
        generated_file_hits: generatedHits,
        ...(request.themes ? { themes: request.themes.map((theme) => ({ ...theme })) } : {})
      };

      const findings = [...reviewFindings(observation, now().toISOString()), ...(request.extra_findings ?? [])];
      const records = [...hostReviewRecords(observation, plan), ...(request.extra_records ?? [])];
      const report = buildReviewReport({
        plan,
        records,
        findings,
        outstanding_requirements: [...byRequirement.values()].filter((requirement) => (requirement.missing_evidence ?? []).length > 0).map((requirement) => requirement.id),
        failed_requirements: [...byRequirement.values()].filter((requirement) => requirement.failed_gates.length > 0).map((requirement) => requirement.id),
        now: now().toISOString()
      });
      return { plan, observation, findings, records, report };
    }
  };
}
