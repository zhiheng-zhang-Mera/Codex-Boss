/**
 * Update-Plan/checkpoint-1.md 搂24 鈥?Theme 鈫?Knowledge integration.
 *
 * 搂24 asks the theme system to record, long term: the style intent, the user's
 * feedback, the visual decisions that worked, the surfaces that turned out to be
 * incompatible, and the validation failures 鈥?while explicitly NOT storing the
 * user's raw screenshots.
 *
 * Everything here goes through the CP2 write gate as a host-derived, verified
 * candidate, so a theme fact is as traceable as any other knowledge: the source
 * is the package hash, the producer is the deterministic host, and the evidence
 * is the validator report or the user's own words.
 */
import {
  KNOWLEDGE_PRODUCER_ID
} from "../../src/shared/knowledge-extraction";
import type { KnowledgeCandidate } from "../../src/shared/knowledge-object";
import type { ThemePackage, ThemeValidationReport } from "../../src/shared/theme";
import type { ThemeIntent } from "../../src/shared/theme-intent";
import { contentHashOf } from "../../src/shared/workbook";
import type { KnowledgeScope } from "../../src/shared/tenx/knowledge";

/** The narrow slice of the Knowledge Foundation this integration needs. */
export interface ThemeKnowledgePort {
  base: { commit(candidate: KnowledgeCandidate): { outcome: string; object?: { id: string } } };
}

export interface ThemeKnowledgeInput {
  scope: KnowledgeScope;
  taskRef: string;
  intent: ThemeIntent;
  pkg: ThemePackage;
  /** Package hash, used as the provenance source hash. */
  packageHash: string;
  validation?: ThemeValidationReport;
  /** The user's latest feedback message, when this records a revision. */
  feedback?: string;
  observedAt: string;
  /** Surfaces the validator rejected, recorded as incompatible. */
  incompatibleSurfaces?: { surface: string; property: string; reason: string }[];
  /** Capture summary only 鈥?never the images themselves (搂24). */
  captureSummary?: string;
}

const PRODUCER = `${KNOWLEDGE_PRODUCER_ID.slice(0, KNOWLEDGE_PRODUCER_ID.lastIndexOf("@")) || KNOWLEDGE_PRODUCER_ID}`;

/** The flat provenance fields a KnowledgeCandidate carries (搂5.2). */
function provenance(input: ThemeKnowledgeInput, source: string) {
  return {
    source,
    source_hash: themeKnowledgeHash(input.pkg, input.packageHash),
    captured_at: input.observedAt,
    producer: "DETERMINISTIC_HOST" as const,
    produced_by: "codex-boss/theme-engine@1",
    verification: "VERIFIED" as const,
    // The evidence is the validator report and/or the user's own words.
    verification_evidence: [
      `theme package ${input.pkg.manifest.id}@${input.pkg.manifest.version}`,
      ...(input.validation ? [`validation ${input.validation.ok ? "PASS" : "FAIL"} at ${input.validation.checkedAt}`] : []),
      ...(input.captureSummary ? [input.captureSummary] : [])
    ],
    task_ref: input.taskRef,
    run_ref: `theme:${input.pkg.manifest.id}`
  };
}

/**
 * Records the durable theme facts of one generation/preview/accept cycle.
 * Returns the gate outcomes so the caller can show what was kept.
 */
export function recordThemeKnowledge(
  input: ThemeKnowledgeInput,
  port: ThemeKnowledgePort
): { recorded: { type: string; subject: string; outcome: string; id?: string }[] } {
  const recorded: { type: string; subject: string; outcome: string; id?: string }[] = [];
  const commit = (candidate: KnowledgeCandidate): void => {
    const result = port.base.commit(candidate);
    recorded.push({ type: candidate.type, subject: candidate.subject, outcome: result.outcome, ...(result.object ? { id: result.object.id } : {}) });
  };

  /* 1. The style intent that was asked for. */
  commit({
    type: "THEME",
    scope: input.scope,
    subject: `theme intent for ${input.pkg.manifest.id}`,
    content: [
      `prompt: ${input.intent.prompt}`,
      `intent: ${input.pkg.manifest.description ?? ""}`
    ].join("\n"),
    summary: `Theme intent: ${input.pkg.manifest.description ?? input.intent.prompt.slice(0, 80)}`,
    ...provenance(input, `theme-prompt:${input.pkg.manifest.id}`),
    confidence: 0.9,
    authority: "OWNER",
    freshness: input.observedAt
  });

  /* 2. The visual decisions that produced the draft. */
  const decisions = Object.entries(input.pkg.tokens).sort(([left], [right]) => left.localeCompare(right));
  commit({
    type: "THEME",
    scope: input.scope,
    subject: `theme tokens for ${input.pkg.manifest.id}`,
    content: [
      `tokens (${decisions.length}):`,
      ...decisions.map(([token, value]) => `- ${token}: ${value}`),
      input.pkg.overrides.length ? `surface overrides (${input.pkg.overrides.length}): ${input.pkg.overrides.map((entry) => `${entry.surface}.${entry.property}=${entry.value}`).join(", ")}` : "surface overrides: none"
    ].join("\n"),
    summary: `Theme tokens for ${input.pkg.manifest.id} (${decisions.length} tokens, ${input.pkg.overrides.length} overrides)`,
    ...provenance(input, `theme-package:${input.pkg.manifest.id}`),
    confidence: 0.85,
    authority: "HOST",
    freshness: input.observedAt
  });

  /* 3. The user's feedback, when there was any (a revision happened). */
  if (input.feedback?.trim()) {
    commit({
      type: "USER_OVERRIDE",
      scope: input.scope,
      subject: `theme feedback for ${input.pkg.manifest.id}`,
      content: input.feedback.trim().slice(0, 2000),
      summary: `Theme feedback: ${input.feedback.trim().slice(0, 120)}`,
      ...provenance(input, `theme-feedback:${input.pkg.manifest.id}`),
      confidence: 1,
      authority: "OWNER",
      freshness: input.observedAt
    });
  }

  /* 4. Validation outcome 鈥?including which surfaces turned out incompatible. */
  if (input.validation) {
    const errors = input.validation.diagnostics.filter((entry) => entry.severity === "ERROR");
    const warnings = input.validation.diagnostics.filter((entry) => entry.severity === "WARN");
    commit({
      type: "THEME_VALIDATION",
      scope: input.scope,
      subject: `theme validation for ${input.pkg.manifest.id}`,
      content: [
        `result: ${input.validation.ok ? "PASS" : "FAIL"}`,
        `contrast pairs measured: ${input.validation.contrast.length}`,
        errors.length ? `errors:\n${errors.map((entry) => `- ${entry.rule}: ${entry.message}`).join("\n")}` : "errors: none",
        warnings.length ? `warnings:\n${warnings.map((entry) => `- ${entry.rule}: ${entry.message}`).join("\n")}` : "warnings: none"
      ].join("\n"),
      summary: `Theme validation ${input.validation.ok ? "PASS" : "FAIL"} for ${input.pkg.manifest.id}`,
      ...provenance(input, `theme-validation:${input.pkg.manifest.id}`),
      confidence: 1,
      authority: "VERIFIED_HOST",
      freshness: input.observedAt
    });
  }
  for (const surface of input.incompatibleSurfaces ?? []) {
    commit({
      type: "THEME_VALIDATION",
      scope: input.scope,
      subject: `incompatible surface ${surface.surface}.${surface.property}`,
      content: `${surface.surface}.${surface.property} was refused for ${input.pkg.manifest.id}: ${surface.reason}`,
      summary: `${surface.surface}.${surface.property} is not themeable this way`,
      ...provenance(input, `theme-surface:${input.pkg.manifest.id}:${surface.surface}`),
      confidence: 0.9,
      authority: "VERIFIED_HOST",
      freshness: input.observedAt
    });
  }

  return { recorded };
}

/** Deterministic hash used as the knowledge provenance hash for a theme package. */
export function themeKnowledgeHash(pkg: ThemePackage, packageHash: string): string {
  return contentHashOf([PRODUCER, pkg.manifest.id, packageHash].join("\u0000"));
}

