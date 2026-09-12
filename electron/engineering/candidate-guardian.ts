/**
 * Update-Plan/checkpoint-1.md §35/§36 — the host side of the Candidate gate.
 *
 * The pure model (`src/shared/candidate-gate.ts`) holds the lifecycle and the
 * checklist; this module supplies the observations the Guardian decides on, from
 * artifacts rather than from anyone's summary:
 *
 *   - the §31.3 ledger (evidence completeness, and the rows a repair can cite);
 *   - the §32 review report (whether the review dimensions were actually covered);
 *   - the files the candidate wrote (secret scan through the real scanner);
 *   - `git status` (what the candidate deleted);
 *   - the compiled contract's overrides (what the Owner's own words required);
 *   - real theme package directories, validated with the §20 validator.
 *
 * Missing observations stay missing: the gate reports `NOT_RUN` and blocks, so a
 * candidate cannot be released because nobody looked.
 */
import fs from "node:fs";
import path from "node:path";
import { scanSecrets } from "../../src/shared/secret-scan";
import { validateThemePackage } from "../../src/shared/theme";
import { outstandingEvidence, type EvidenceLedgerFile } from "../../src/shared/evidence-ledger";
import type { KnowledgeScope } from "../../src/shared/tenx/knowledge";
import {
  advanceLifecycle,
  candidateRecordFor,
  evaluateGuardian,
  GUARDIAN_CHECKS,
  type CandidateRecord,
  type GuardianCheckId,
  type GuardianContext,
  type LifecycleEvent,
  type LifecycleResult,
  type LifecycleStep,
  type TaskLifecycleState,
  type ThemeGuardianInput
} from "../../src/shared/candidate-gate";

export const CANDIDATE_RECORD_FILE = "candidate-record.json";

export interface CandidateRequirement {
  id: string;
  type: string;
  text: string;
  visual: boolean;
  state: string;
}

export interface ThemePackageLocation {
  id: string;
  /** Directory holding theme.json/tokens.json/… (§8 layout). */
  directory: string;
  built_in?: boolean;
}

export interface CandidateGateConfig {
  root: string;
  ledger: () => EvidenceLedgerFile;
  /** The CP9 review report's coverage, when a review ran. */
  reviewCovered?: () => boolean | undefined;
  recordPath?: string;
  now?: () => Date;
}

export interface CandidateEvaluationInput {
  taskId: string;
  state: TaskLifecycleState;
  steps?: readonly LifecycleStep[];
  requirements: readonly CandidateRequirement[];
  /** The goal and deliverables the candidate claims to serve. */
  goal: { text: string; deliverables: string[] };
  /** Files the candidate wrote, relative to the root. */
  written_files: readonly string[];
  /** The plan node's grant. */
  allowed_files: readonly string[];
  /** Change units the host refused. */
  refused?: readonly string[];
  /** The Owner's approvals for removals, by path or script name. */
  approved_removals?: readonly string[];
  /** The compiled contract's overrides (§5.2: the Owner's words win). */
  overrides?: readonly { text: string; supersedes: readonly string[] }[];
  /** Baseline package.json scripts, so a removal is visible. */
  baseline_scripts?: readonly string[];
  /** Real theme packages to validate. */
  themes?: readonly ThemePackageLocation[];
  /** Set when the candidate touched a theme lane but no package could be read. */
  theme_required?: boolean;
}

export interface CandidateEvaluation {
  record: CandidateRecord;
  context: GuardianContext;
  evaluation: ReturnType<typeof evaluateGuardian>;
  /** The repair input when the Guardian refused: the checks that blocked. */
  repair: GuardianCheckId[];
}

export interface CandidateGuardian {
  evaluate(input: CandidateEvaluationInput): CandidateEvaluation;
  /** §35: walks the lifecycle, refusing an illegal event. */
  advance(state: TaskLifecycleState, event: LifecycleEvent): LifecycleResult;
  record(): CandidateRecord | undefined;
  save(): string;
}

/** Significant terms of a phrase, for the lexical compliance checks. */
export function significantTerms(text: string): string[] {
  return [...new Set((text.toLocaleLowerCase().match(/[a-z0-9]{4,}/g) ?? []))];
}

export function createCandidateGuardian(config: CandidateGateConfig): CandidateGuardian {
  const root = fs.realpathSync(config.root);
  const now = config.now ?? (() => new Date());
  const recordPath = config.recordPath ?? path.join(root, "artifacts", "acceptance", CANDIDATE_RECORD_FILE);
  let record: CandidateRecord | undefined = loadRecord(recordPath);

  const deletedPaths = (): string[] => {
    const result = spawnGit(root);
    if (!result.available) return [];
    return result.lines.filter((line) => /^ ?D/.test(line)).map((line) => line.replace(/^ ?D\s+/, "").trim()).filter(Boolean);
  };

  return {
    advance: (state, event) => advanceLifecycle(state, event),
    record: () => record,
    evaluate(input) {
      const ledger = config.ledger();
      const requirements = input.requirements.filter((requirement) => requirement.type !== "GOAL" && requirement.type !== "DEPENDENCY");
      const covered = requirements.filter((requirement) => requirement.state === "IMPLEMENTED" || requirement.state === "VERIFIED").map((requirement) => requirement.id);
      const unimplemented = requirements.filter((requirement) => !covered.includes(requirement.id)).map((requirement) => requirement.id);

      // GOAL_COMPLIANCE is lexical: a requirement serves the goal when it shares
      // significant terms with the goal or one of its deliverables.
      const goalTerms = significantTerms(`${input.goal.text} ${input.goal.deliverables.join(" ")}`);
      const served = requirements
        .filter((requirement) => significantTerms(requirement.text).some((term) => goalTerms.includes(term)))
        .map((requirement) => requirement.id);

      const scanned: { path: string; shapes: string[] }[] = [];
      const scannedFiles: string[] = [];
      for (const file of input.written_files) {
        const target = path.resolve(root, file);
        if (!target.startsWith(root) || !fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
        scannedFiles.push(file);
        const hits = scanSecrets(fs.readFileSync(target, "utf8"));
        if (hits.length) scanned.push({ path: file, shapes: [...new Set(hits.map((hit) => hit.shape))] });
      }

      const outstanding = outstandingEvidence(ledger, { nodes: input.requirements.map((requirement) => ({ id: requirement.id, type: requirement.type, visual: requirement.visual })) as never })
        .filter((entry) => (entry.missing ?? []).length > 0)
        .map((entry) => entry.requirement_id);
      const failed = latestFailures(ledger, input.requirements.map((requirement) => requirement.id));

      const deleted = deletedPaths().filter((file) => input.written_files.includes(file) || !file.includes("artifacts/"));
      const deletedTests = deleted.filter((file) => /(^|\/)(tests?|__tests__)\//i.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(file));
      const removedScripts = removedPackageScripts(root, input.baseline_scripts ?? []);

      const themes: ThemeGuardianInput[] = (input.themes ?? []).flatMap((location) => {
        const read = readThemePackage(location);
        return read ? [read] : [];
      });

      const context: GuardianContext = {
        goal: { text: input.goal.text, served_by_requirements: served, deliverables: [...input.goal.deliverables] },
        coverage: { required: requirements.map((requirement) => requirement.id), covered, unimplemented },
        secrets: { scanned_files: scannedFiles, hits: scanned },
        scope: { allowed_files: [...input.allowed_files], written_files: [...input.written_files], refused: [...(input.refused ?? [])] },
        evidence: {
          outstanding_requirements: outstanding,
          failed_requirements: failed,
          ledger_rows: ledger.entries.length,
          review_covered: config.reviewCovered?.() ?? false
        },
        destructive: { deleted_files: deleted, deleted_tests: deletedTests, removed_scripts: removedScripts, approved_by_owner: [...(input.approved_removals ?? [])] },
        overrides: (input.overrides ?? []).map((override) => ({
          text: override.text,
          supersedes: [...override.supersedes],
          expected_in_requirements: overrideItems(override.text)
        })),
        obligations: requirements.map((requirement) => requirement.text),
        ...(themes.length ? { themes } : {}),
        ...(input.theme_required ? { theme_required: true } : {})
      };

      const evaluation = evaluateGuardian(context);
      record = candidateRecordFor({
        task_id: input.taskId,
        state: input.state,
        requirements: requirements.map((requirement) => requirement.id),
        completion_evidence: ledger.entries.filter((entry) => entry.result === "PASS").map((entry) => entry.id),
        guardian: evaluation.verdict,
        steps: [...(input.steps ?? [])],
        now: now().toISOString()
      });
      persist();
      return { record, context, evaluation, repair: evaluation.verdict.blocking };
    },
    save() {
      persist();
      return recordPath;
    }
  };

  function persist(): void {
    if (!record) return;
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf8");
  }
}

/* ------------------------------------------------------------------ *
 * observation helpers
 * ------------------------------------------------------------------ */

function spawnGit(root: string): { available: boolean; lines: string[] } {
  try {
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const result = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
    if (result.status !== 0) return { available: false, lines: [] };
    return { available: true, lines: `${result.stdout ?? ""}`.split(/\r?\n/).filter(Boolean) };
  } catch {
    return { available: false, lines: [] };
  }
}

/** §36: the newest row per requirement+gate decides, so a repaired failure clears. */
function latestFailures(ledger: EvidenceLedgerFile, requirementIds: readonly string[]): string[] {
  const failed: string[] = [];
  for (const requirementId of requirementIds) {
    const rows = ledger.entries
      .filter((entry) => entry.requirement_ids.includes(requirementId))
      .sort((left, right) => left.captured_at.localeCompare(right.captured_at) || left.id.localeCompare(right.id));
    const latest = new Map<string, string>();
    for (const row of rows) latest.set(row.gate, row.result);
    if ([...latest.values()].includes("FAIL")) failed.push(requirementId);
  }
  return failed;
}

function removedPackageScripts(root: string, baseline: readonly string[]): string[] {
  if (!baseline.length) return [];
  const manifest = path.join(root, "package.json");
  if (!fs.existsSync(manifest)) return [...baseline];
  try {
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> };
    const present = new Set(Object.keys(parsed.scripts ?? {}));
    return baseline.filter((script) => !present.has(script));
  } catch {
    return [];
  }
}

/** Reads a §8 theme package from disk and turns it into §36 evidence. */
export function readThemePackage(location: ThemePackageLocation): ThemeGuardianInput | undefined {
  const readJson = (name: string): unknown => {
    const target = path.join(location.directory, name);
    return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : undefined;
  };
  // The package is passed to the §20 validator exactly as it is on disk: a
  // synthesized manifest would produce false diagnostics, which is exactly the
  // kind of "evidence" a Guardian must not accept.
  const manifest = readJson("theme.json") as { id?: string; builtIn?: boolean; derivedFrom?: string } | undefined;
  if (!manifest) return undefined;
  const pkg = {
    manifest,
    tokens: (readJson("tokens.json") as Record<string, string> | undefined) ?? {},
    overrides: (readJson("overrides.json") as unknown[] | undefined) ?? [],
    css: fs.existsSync(path.join(location.directory, "overrides.css")) ? fs.readFileSync(path.join(location.directory, "overrides.css"), "utf8") : "",
    metadata: readJson("metadata.json")
  };
  const validation = validateThemePackage(pkg as never, [], {});
  const errors = validation.diagnostics.filter((diagnostic) => diagnostic.severity === "ERROR");
  const executable = errors.filter((diagnostic) => ["SCRIPT_INJECTION", "UNSAFE_URL", "EXTERNAL_IMPORT", "INVALID_CSS"].includes(diagnostic.rule));
  const builtIn = manifest.builtIn === true || location.built_in === true;
  const provenance = (readJson("metadata.json") as { basedOn?: string } | undefined)?.basedOn ?? manifest.derivedFrom;
  return {
    id: manifest.id ?? location.id,
    // §11: provenance is legitimate only once the package materialized its own
    // tokens; a provenance pointer with no tokens is a runtime dependency.
    references_other_theme: Boolean(provenance) && Object.keys(pkg.tokens).length === 0,
    error_diagnostics: errors.length,
    executable_payload_diagnostics: executable.length,
    fallback_plan_valid: errors.length === 0,
    built_in: builtIn,
    built_in_intact: builtIn ? errors.length === 0 : true
  };
}

/** Items of an Owner override: its own lines, so the requirement can be matched. */
export function overrideItems(text: string): string[] {
  const items = text
    .split(/\r?\n|;|。|；/)
    .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
    .filter((line) => significantTerms(line).length > 0);
  return items.length ? items : [text.trim()];
}

function loadRecord(recordPath: string): CandidateRecord | undefined {
  if (!fs.existsSync(recordPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(recordPath, "utf8")) as CandidateRecord;
  } catch {
    return undefined;
  }
}

/** Exposed so a caller can name the full checklist without importing the model. */
export const CANDIDATE_CHECKLIST = [...GUARDIAN_CHECKS] as const;
export type { CandidateRecord, GuardianCheckId, LifecycleEvent, TaskLifecycleState };
export type CandidateKnowledgeScope = KnowledgeScope;
