import { createRequire } from "node:module";
import path from "node:path";

/**
 * Typed access to the shipped Phase 1B-B hosted-shadow modules.
 *
 * The runners are `.cjs` on purpose — the hosted `architecture` job invokes them with `node`, and they must be
 * loadable by a plain Node process with no build step, exactly like every other `scripts/*.cjs` in this
 * repository. That makes them untyped from TypeScript's point of view, and the alternative to this file would be
 * `as any` at each call site, which would silently accept a renamed export.
 *
 * The declarations below are deliberately narrow: they name the functions this suite uses and the shape it
 * relies on. If a rename happens, the type error appears here rather than as a runtime `undefined is not a
 * function` inside a test that then reads as a product failure.
 */

export type PolicyClass = "POLICY_VIOLATION" | "FAIL_CLOSED" | "INFORMATIONAL";

export interface NormalizedFinding {
  code: string;
  severity: string;
  subject: string;
  policy_class: string;
  detail_digest: string;
}

export interface FindingsComparison {
  parity: boolean;
  comparison_kind: string;
  local_findings_hash: string;
  hosted_findings_hash: string;
  local_count: number;
  hosted_count: number;
  count_only_match: boolean;
  only_local: NormalizedFinding[];
  only_hosted: NormalizedFinding[];
  multiplicity_differences: Array<{ finding: NormalizedFinding; local_count: number; hosted_count: number }>;
}

export interface HostedEnvironment {
  hosted: boolean;
  provider: string;
  observed: Record<string, string | null>;
  absence_note: string | null;
}

export interface BaselineSelfConsistency {
  path: string;
  exists: boolean;
  self_consistent: boolean;
  code: string | null;
  detail: string | null;
  baseline_version: number | null;
  baseline_hash: string | null;
  recomputed_baseline_hash: string | null;
  skipped_by_fixture?: boolean;
}

export interface HostedShadowRunner {
  SCHEMA: string;
  DIGEST_SCHEMA: string;
  MACHINERY_CODES: string[];
  classifyPolicy: (finding: { code?: string }) => PolicyClass;
  normalizeFinding: (finding: { code?: unknown; severity?: unknown; subject?: unknown; detail?: unknown }) => NormalizedFinding;
  sortNormalized: (entries: NormalizedFinding[]) => NormalizedFinding[];
  canonicalFinding: (entry: NormalizedFinding) => string;
  findingKey: (entry: NormalizedFinding) => string;
  semanticFindingsHash: (entries: NormalizedFinding[]) => string;
  compareFindings: (local: NormalizedFinding[], hosted: NormalizedFinding[]) => FindingsComparison;
  hostedEnvironment: () => HostedEnvironment;
  baselineSelfConsistency: (root: string, baselineOverride: string | null) => BaselineSelfConsistency;
}

export interface FindingsParityTool {
  normalizedOf: (artifact: unknown) => { source: string | null; findings: NormalizedFinding[] | null };
}

const requireFromHere = createRequire(path.join(process.cwd(), "package.json"));

export const hostedShadowRunner = requireFromHere(path.join(process.cwd(), "scripts", "architecture-shadow-hosted.cjs")) as HostedShadowRunner;

export const findingsParityTool = requireFromHere(path.join(process.cwd(), "scripts", "architecture-findings-parity.cjs")) as FindingsParityTool;
