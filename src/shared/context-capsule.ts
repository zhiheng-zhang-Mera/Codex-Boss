import { canonicalJson, canonicalSections } from "./context-fingerprint";

/** Context capsule compiler (plan §1.2 / AP09): C0 symbol-level, C1 module-level. */

export type ContextCapsuleLevel = "C0" | "C1";

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
  /** Contents of explicitly required files (C1 adds these within budget). */
  files?: Record<string, string>;
  /** Contents of dependency files/artifacts (C1 adds these within budget). */
  dependencies?: Record<string, string>;
  maxChars?: number;
}

const C0_CHARS = 4000;
const C1_CHARS = 24000;

/**
 * Compiles the smallest sufficient context capsule: C0 always fits
 * (role + objective); C1 layers required files then dependency outputs only
 * while under the budget. The fingerprint lets caches invalidate when the
 * assembled context drifts (plan §13.4).
 */
export function compileContextCapsule(input: CapsuleInput, hash = canonicalSections): ContextCapsule {
  const roleObjective: unknown[] = [{ role: input.role, objective: input.objective }];
  const c0 = { sections: roleObjective, chars: totalChars(roleObjective) };
  const level: ContextCapsuleLevel = c0.chars <= (input.maxChars ?? C1_CHARS) && hasFileLayers(input) ? "C1" : "C0";
  const sections: unknown[] = [...roleObjective];
  if (level === "C1") {
    for (const file of Object.entries(input.files ?? {})) sections.push({ file: file[0], content: file[1] });
    for (const dependency of Object.entries(input.dependencies ?? {})) sections.push({ dependency: dependency[0], content: dependency[1] });
  }
  const budget = input.maxChars ?? (level === "C1" ? C1_CHARS : C0_CHARS);
  const pruned = pruneToBudget(sections, budget);
  return { level, sections: pruned, chars: totalChars(pruned), fingerprint: hash(...pruned) };
}

function hasFileLayers(input: CapsuleInput): boolean {
  return Boolean(input.files && Object.keys(input.files).length) || Boolean(input.dependencies && Object.keys(input.dependencies).length);
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
