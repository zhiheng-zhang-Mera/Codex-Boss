import { canonicalJson, canonicalSections } from "./context-fingerprint";

/**
 * Context capsule compiler (plan §1.2 / AP09): C0 symbol-level, C1 module-level,
 * C2 architecture-level. Pure and shareable; deterministic fingerprint = cache key.
 */

export type ContextCapsuleLevel = "C0" | "C1" | "C2";

export interface ContextCapsule {
  level: ContextCapsuleLevel;
  sections: unknown[];
  chars: number;
  /** Deterministic canonical fingerprint of the assembled sections (cache key). */
  fingerprint: string;
}

export interface CapsuleInput {
  role: string;
  objective: string;
  /** Contents of explicitly required files (C1+ adds these within budget). */
  files?: Record<string, string>;
  /** Contents of dependency files/artifacts (C1+ adds these within budget). */
  dependencies?: Record<string, string>;
  /** Architecture slice: interfaces/symbol summaries + dependency edges (C2 layer). */
  architecture?: Record<string, string>;
  maxChars?: number;
}

const C0_CHARS = 4000;
const C1_CHARS = 24000;
export const C2_CHARS = 64000;

/**
 * Compiles the smallest sufficient context capsule: C0 always fits (role +
 * objective); C1 layers required files then dependency outputs only while under
 * the budget; C2 adds the architecture slice (interfaces, module boundaries)
 * for cross-file/architectural work. The fingerprint lets caches invalidate
 * when the assembled context drifts (plan §13.4).
 */
export function compileContextCapsule(input: CapsuleInput, hash = canonicalSections): ContextCapsule {
  const roleObjective: unknown[] = [{ role: input.role, objective: input.objective }];
  const c0 = { sections: roleObjective, chars: totalChars(roleObjective) };
  const budget = input.maxChars ?? (input.architecture && Object.keys(input.architecture).length ? C2_CHARS : C1_CHARS);
  const level: ContextCapsuleLevel = c0.chars <= budget && hasFileLayers(input) ? (hasArchitecture(input) ? "C2" : "C1") : "C0";
  const sections: unknown[] = [...roleObjective];
  if (level === "C1" || level === "C2") {
    for (const file of Object.entries(input.files ?? {})) sections.push({ file: file[0], content: file[1] });
    for (const dependency of Object.entries(input.dependencies ?? {})) sections.push({ dependency: dependency[0], content: dependency[1] });
  }
  if (level === "C2") {
    for (const slice of Object.entries(input.architecture ?? {})) sections.push({ architecture: slice[0], content: slice[1] });
  }
  const pruned = pruneToBudget(sections, budget);
  return { level, sections: pruned, chars: totalChars(pruned), fingerprint: hash(...pruned) };
}

/**
 * Required-context resolver (plan AP09 / §13.3): decides which capsule layer a
 * step needs. A worker step with only dependencies → C1; a step whose scope
 * crosses module boundaries or touches interfaces/dependency edges → C2; exact
 * deterministic operations on a single file → C0/C1.
 */
export function requiredContextLevel(input: {
  kind: string;
  requiredFiles: string[];
  dependencies: string[];
  hasArchitecture?: boolean;
  crossModule?: boolean;
}): ContextCapsuleLevel {
  if (input.hasArchitecture || input.crossModule || input.requiredFiles.length > 3 || input.dependencies.length > 5) return "C2";
  if (input.requiredFiles.length || input.dependencies.length) return "C1";
  return "C0";
}

/**
 * Builds the cache-key input (plan §13.4 hash+version+policy). The caller adds
 * scope/kind/version via the content-addressed cache; the fingerprint alone is
 * the context-dependency part of the key.
 */
export function capsuleCacheKeyInput(input: CapsuleInput): { level: ContextCapsuleLevel; fingerprint: string; chars: number } {
  const capsule = compileContextCapsule(input);
  return { level: capsule.level, fingerprint: capsule.fingerprint, chars: capsule.chars };
}

function hasFileLayers(input: CapsuleInput): boolean {
  return Boolean(input.files && Object.keys(input.files).length) || Boolean(input.dependencies && Object.keys(input.dependencies).length);
}

function hasArchitecture(input: CapsuleInput): boolean {
  return Boolean(input.architecture && Object.keys(input.architecture).length);
}

function totalChars(sections: unknown[]): number {
  return sections.reduce((sum: number, section) => sum + JSON.stringify(section).length, 0);
}

function pruneToBudget(sections: unknown[], budget: number): unknown[] {
  const result: unknown[] = [];
  let used = 0;
  for (const section of sections) {
    const serialized = JSON.stringify(section);
    if (used + serialized.length > budget && result.length > 0) break;
    result.push(section);
    used += serialized.length;
  }
  return result;
}

export function capsuleFingerprint(input: CapsuleInput): string {
  return compileContextCapsule(input).fingerprint;
}

export function canonicalize(value: unknown): string { return canonicalJson(value); }
