/**
 * Update-Plan/checkpoint-1.md §37 — Version Impact Assessment.
 *
 * Boss decides NONE / PATCH / MINOR / MAJOR itself, from the change's own
 * artefacts: API, schema, behaviour, compatibility, migration and user-facing
 * changes. §37 is explicit that a Worker may not decide this ("不得让 Worker 随意
 * 决定"), so this module also owns the rule that refuses a worker's claim when the
 * host's own assessment differs — the claim is evidence, not the verdict.
 *
 * Two §37 special cases are encoded: adding an ordinary custom theme is NONE/PATCH,
 * and a change to the Theme Engine contract forces a re-assessment rather than
 * inheriting the theme answer.
 *
 * Pure: no fs, no clock, no process.
 */
import { contentHashOf } from "./workbook";

export const VERSION_IMPACT_VERSION = "version-impact-1" as const;

export const VERSION_IMPACTS = ["NONE", "PATCH", "MINOR", "MAJOR"] as const;
export type VersionImpact = (typeof VERSION_IMPACTS)[number];

export const IMPACT_RANK: Readonly<Record<VersionImpact, number>> = { NONE: 0, PATCH: 1, MINOR: 2, MAJOR: 3 };

/** §37's six bases, each of which must be looked at. */
export const IMPACT_FACTORS = ["API", "SCHEMA", "BEHAVIOR", "COMPATIBILITY", "MIGRATION", "USER_FACING"] as const;
export type ImpactFactor = (typeof IMPACT_FACTORS)[number];

/** What the host observed, per file. Undefined means "not observed". */
export interface ChangeObservation {
  path: string;
  kind: "ADDED" | "MODIFIED" | "DELETED" | "RENAMED";
  /** Exported symbols this file had before and after (from the real source). */
  exports_before?: string[];
  exports_after?: string[];
  /** True when the file is part of the published/consumed surface. */
  public_surface?: boolean;
  /** True when the file declares or migrates a schema. */
  schema?: boolean;
  /** True when the file is compiled into what the user sees (renderer/theme/UI). */
  user_facing?: boolean;
  /** True when the file is a test or a document. */
  test_or_docs?: boolean;
  /** True when the file is a theme package of its own (§12). */
  theme_package?: boolean;
  /** True when the file is part of the Theme Engine's own contract (§9/§11). */
  theme_engine_contract?: boolean;
}

export interface ImpactFinding {
  factor: ImpactFactor;
  impact: VersionImpact;
  reason: string;
  /** The files that produced it. */
  evidence: string[];
}

export interface VersionAssessment {
  schemaVersion: 1;
  version: typeof VERSION_IMPACT_VERSION;
  impact: VersionImpact;
  findings: ImpactFinding[];
  /** §37: the factors that were looked at, and the ones that were not. */
  factors_examined: ImpactFactor[];
  factors_not_observed: ImpactFactor[];
  /** True when the answer depends on a contract that changed in this very change. */
  requires_reevaluation: boolean;
  /** §37: the assessment is the host's, never a worker's. */
  decided_by: "HOST";
  /** Every claim the worker made that the host did not confirm. */
  rejected_claims: { claimed: VersionImpact; reason: string }[];
  reason: string;
  hash: string;
}

export function maxImpact(left: VersionImpact, right: VersionImpact): VersionImpact {
  return IMPACT_RANK[right] > IMPACT_RANK[left] ? right : left;
}

/** §11/§9: the Theme Engine's own contract files. */
const THEME_ENGINE_PATHS = ["src/shared/theme.ts", "src/shared/theme-intent.ts", "src/shared/theme-generation.ts", "src/shared/theme-visual-check.ts"];

export function isThemeEngineContract(path: string): boolean {
  return THEME_ENGINE_PATHS.some((candidate) => path.replace(/\\/g, "/").endsWith(candidate));
}

/**
 * §37's rules, one per factor. Each returns either nothing (the factor was not
 * affected) or the impact it forces with the reason and the evidence.
 */
function apiFinding(observations: readonly ChangeObservation[]): ImpactFinding | undefined {
  const surface = observations.filter((observation) => observation.public_surface && observation.exports_before !== undefined);
  if (!surface.length) return undefined;
  const removed = surface.flatMap((observation) => (observation.exports_before ?? []).filter((symbol) => !(observation.exports_after ?? []).includes(symbol)).map((symbol) => `${observation.path}#${symbol}`));
  const added = surface.flatMap((observation) => (observation.exports_after ?? []).filter((symbol) => !(observation.exports_before ?? []).includes(symbol)).map((symbol) => `${observation.path}#${symbol}`));
  if (removed.length) {
    return { factor: "API", impact: "MAJOR", reason: `${removed.length} exported symbol(s) disappeared from the public surface, which breaks every consumer`, evidence: removed.slice(0, 8) };
  }
  if (added.length) {
    return { factor: "API", impact: "MINOR", reason: `${added.length} new exported symbol(s) extend the surface without breaking it`, evidence: added.slice(0, 8) };
  }
  return undefined;
}

function schemaFinding(observations: readonly ChangeObservation[]): ImpactFinding | undefined {
  const schema = observations.filter((observation) => observation.schema);
  if (!schema.length) return undefined;
  const migrated = schema.some((observation) => /migrat|schemaVersion|schema_version/i.test(observation.path));
  return {
    factor: "SCHEMA",
    impact: migrated ? "MAJOR" : "MINOR",
    reason: migrated
      ? "a stored schema changed, so existing data has to be migrated"
      : "a schema-carrying file changed without a migration",
    evidence: schema.map((observation) => observation.path).slice(0, 8)
  };
}

function compatibilityFinding(observations: readonly ChangeObservation[]): ImpactFinding | undefined {
  const deleted = observations.filter((observation) => observation.kind === "DELETED" && observation.public_surface);
  const renamed = observations.filter((observation) => observation.kind === "RENAMED" && observation.public_surface);
  const hits = [...deleted, ...renamed];
  if (!hits.length) return undefined;
  return {
    factor: "COMPATIBILITY",
    impact: "MAJOR",
    reason: "a public-surface file was deleted or renamed, so existing references break",
    evidence: hits.map((observation) => `${observation.kind}:${observation.path}`).slice(0, 8)
  };
}

function migrationFinding(observations: readonly ChangeObservation[]): ImpactFinding | undefined {
  const migrations = observations.filter((observation) => /(^|\/)(migrations?|upgrades?)\//i.test(observation.path) || /migrat/i.test(observation.path));
  if (!migrations.length) return undefined;
  return {
    factor: "MIGRATION",
    impact: "MAJOR",
    reason: "the change ships a migration, so the previous version's data is no longer read as-is",
    evidence: migrations.map((observation) => observation.path).slice(0, 8)
  };
}

function behaviourFinding(observations: readonly ChangeObservation[]): ImpactFinding | undefined {
  const source = observations.filter((observation) => !observation.test_or_docs && !observation.theme_package);
  if (!source.length) return undefined;
  return {
    factor: "BEHAVIOR",
    impact: "PATCH",
    reason: `${source.length} implementation file(s) changed, so behaviour may differ in ways no API or schema rule captures`,
    evidence: source.map((observation) => observation.path).slice(0, 8)
  };
}

function userFacingFinding(observations: readonly ChangeObservation[]): ImpactFinding | undefined {
  const visible = observations.filter((observation) => observation.user_facing && !observation.theme_package);
  if (!visible.length) return undefined;
  return {
    factor: "USER_FACING",
    impact: "MINOR",
    reason: "what the user sees changed, which is a feature-level change rather than a fix",
    evidence: visible.map((observation) => observation.path).slice(0, 8)
  };
}

const FACTOR_RULES: Readonly<Record<ImpactFactor, (observations: readonly ChangeObservation[]) => ImpactFinding | undefined>> = {
  API: apiFinding,
  SCHEMA: schemaFinding,
  BEHAVIOR: behaviourFinding,
  COMPATIBILITY: compatibilityFinding,
  MIGRATION: migrationFinding,
  USER_FACING: userFacingFinding
};

export interface AssessInput {
  changes: readonly ChangeObservation[];
  /** A version impact a worker claimed, which the host will check (§37). */
  worker_claim?: VersionImpact;
  /** Semver the change would be applied to, for the suggested bump. */
  current_version?: string;
}

/**
 * §37: the impact of a change, computed from what changed.
 *
 * The result is the strongest finding, and the findings are kept so the answer can
 * be argued with. A change that only touches tests or documents is NONE; a plain
 * custom theme is NONE/PATCH (its package is additive); a change to the Theme
 * Engine contract sets `requires_reevaluation` so the theme answer cannot be
 * inherited.
 */
export function assessVersionImpact(input: AssessInput): VersionAssessment {
  const findings: ImpactFinding[] = [];
  const examined: ImpactFactor[] = [];
  const notObserved: ImpactFactor[] = [];
  for (const factor of IMPACT_FACTORS) {
    const finding = FACTOR_RULES[factor](input.changes);
    const observed = input.changes.some((change) => {
      if (factor === "API" || factor === "COMPATIBILITY") return change.public_surface !== undefined || change.exports_before !== undefined;
      if (factor === "SCHEMA") return change.schema !== undefined;
      if (factor === "MIGRATION") return change.schema !== undefined || change.public_surface !== undefined;
      if (factor === "USER_FACING") return change.user_facing !== undefined;
      return change.test_or_docs !== undefined || change.kind !== undefined;
    });
    if (observed) examined.push(factor);
    else notObserved.push(factor);
    if (finding) findings.push(finding);
  }

  const themeOnly = input.changes.length > 0 && input.changes.every((change) => change.theme_package === true);
  const themeContractChanged = input.changes.some((change) => change.theme_engine_contract === true || isThemeEngineContract(change.path));
  const substantive = findings.filter((finding) => !(themeOnly && finding.factor === "BEHAVIOR"));
  let impact: VersionImpact = substantive.reduce<VersionImpact>((strongest, finding) => maxImpact(strongest, finding.impact), "NONE");

  const reasons: string[] = [];
  if (themeOnly) {
    // §37: an ordinary new custom theme is additive — NONE at worst PATCH.
    impact = impact === "NONE" ? "NONE" : "PATCH";
    reasons.push("every changed file is a theme package of its own, which §37 treats as NONE/PATCH");
  }
  if (themeContractChanged) reasons.push("the Theme Engine contract changed in this change, so the theme impact answer must be re-assessed rather than inherited (§37)");

  const rejected: { claimed: VersionImpact; reason: string }[] = [];
  if (input.worker_claim) {
    if (input.worker_claim !== impact) {
      rejected.push({
        claimed: input.worker_claim,
        reason: `the host's own assessment is ${impact} (${findings.map((finding) => `${finding.factor}=${finding.impact}`).join(", ") || "no factor was affected"}); §37 does not let a worker decide the version impact`
      });
    }
  }
  const reason = reasons.length
    ? `${reasons.join("; ")} ⇒ ${impact}`
    : findings.length
      ? `${findings.map((finding) => `${finding.factor}:${finding.impact}`).join(", ")} ⇒ ${impact}`
      : "no observed change affected the API, schema, behaviour, compatibility, migration or user-facing surface";

  const assessment: Omit<VersionAssessment, "hash"> = {
    schemaVersion: 1,
    version: VERSION_IMPACT_VERSION,
    impact,
    findings,
    factors_examined: examined,
    factors_not_observed: notObserved,
    requires_reevaluation: themeContractChanged,
    decided_by: "HOST",
    rejected_claims: rejected,
    reason
  };
  return { ...assessment, hash: contentHashOf(JSON.stringify(assessment)) };
}

/** §37: the semver bump the assessment implies, when a version was supplied. */
export function suggestedVersion(assessment: VersionAssessment, current: string): { from: string; to: string; reason: string } | undefined {
  const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(current.trim());
  if (!parsed) return undefined;
  const [major, minor, patch] = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  if (assessment.impact === "MAJOR") return { from: current, to: `${major + 1}.0.0`, reason: "MAJOR: a breaking change" };
  if (assessment.impact === "MINOR") return { from: current, to: `${major}.${minor + 1}.0`, reason: "MINOR: additive change" };
  if (assessment.impact === "PATCH") return { from: current, to: `${major}.${minor}.${patch + 1}`, reason: "PATCH: behaviour change" };
  return { from: current, to: current, reason: "NONE: nothing the version identifies changed" };
}
