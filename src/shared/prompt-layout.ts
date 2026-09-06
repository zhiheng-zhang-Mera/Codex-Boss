/**
 * Stable prompt layout (plan 9-7 §20/§21). DeepSeek context caching keys on a
 * repeated prefix, so prompt assembly must keep the static sections first and
 * byte-stable while dynamic content follows. Never reorders system sections,
 * never injects timestamps/random ids before the static prefix.
 *
 * Pure + shareable.
 */

export interface StaticPromptSections {
  systemPolicy?: string;
  role?: string;
  toolContract?: string;
  outputSchema?: string;
  projectManifest?: string;
}

export interface DynamicPromptSections {
  task?: string;
  contextPackage?: string;
  toolResults?: string;
}

/** Versions a static contract so cache keys/audits can name it (plan §21). */
export interface PromptVersion {
  /** e.g. "planner-contract-v1" */
  id: string;
  version: number;
}

/**
 * Assembles a prompt with the cache-friendly layout. Static sections render
 * first in a fixed order; dynamic sections follow after a separator. When the
 * static inputs are unchanged the static half is byte-identical → prefix hits.
 */
export function assembleStablePrompt(staticSections: StaticPromptSections, dynamicSections: DynamicPromptSections = {}): string {
  const orderedStatic: Array<[string, string | undefined]> = [
    ["SYSTEM POLICY", staticSections.systemPolicy],
    ["BOSS ROLE", staticSections.role],
    ["TOOL CONTRACT", staticSections.toolContract],
    ["OUTPUT SCHEMA", staticSections.outputSchema],
    ["PROJECT MANIFEST", staticSections.projectManifest]
  ];
  const staticBlock = orderedStatic
    .filter(([, content]) => content !== undefined && content.trim().length > 0)
    .map(([title, content]) => `[${title}]\n${content!.trim()}`)
    .join("\n\n");

  const orderedDynamic: Array<[string, string | undefined]> = [
    ["TASK", dynamicSections.task],
    ["CONTEXT PACKAGE", dynamicSections.contextPackage],
    ["TOOL RESULTS", dynamicSections.toolResults]
  ];
  const dynamicBlock = orderedDynamic
    .filter(([, content]) => content !== undefined && content.trim().length > 0)
    .map(([title, content]) => `[${title}]\n${content!.trim()}`)
    .join("\n\n");

  return [staticBlock, dynamicBlock].filter(Boolean).join("\n" + "-".repeat(40) + "\n");
}

/** 64-bit-ish deterministic hash of the *static* half (pure, no node:crypto). */
export function staticPrefixFingerprint(sections: StaticPromptSections): string {
  const input = [
    sections.systemPolicy ?? "",
    sections.role ?? "",
    sections.toolContract ?? "",
    sections.outputSchema ?? "",
    sections.projectManifest ?? ""
  ].join("\u0000");
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
