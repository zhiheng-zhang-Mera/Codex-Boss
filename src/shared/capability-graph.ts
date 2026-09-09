/**
 * Capability graph resolution (plan §4.4 / AP06). Pure and shareable.
 *
 * The planner must face a capability graph, not brand names:
 * `TaskIR.requiredCapabilities` today is free text ("native",
 * "general_reasoning", "web_search", "code_edit", …) that nothing ever
 * resolves against the executor vocabulary. This module canonicalizes those
 * tokens into (a) AI role capabilities the router can enforce and (b) whether
 * a deterministic/native executor already suffices — the graph half of the
 * AP06 "requiredCapabilities graph resolution" seam.
 */

import { resolveCapabilityToKind, type ExecutionCostKind } from "./cheapest-execution";

/** AI role capabilities (mirrors RuntimeCapability values; kept local to stay pure). */
export type AICapability = "planning" | "research" | "review" | "synthesis" | "coding" | "validation" | "critique";
export const AI_CAPABILITIES: readonly AICapability[] = ["planning", "research", "review", "synthesis", "coding", "validation", "critique"];

/** Capabilities satisfied by a deterministic/native executor without any model. */
export const NATIVE_CAPABILITIES = new Set<string>([
  "native", "read_file", "read files", "list_files", "list files", "repo_read", "git_status", "git status", "computer", "run_test", "run_build", "run_lint", "run_typecheck"
]);

/** Generic-reasoning tokens: any model-capable runtime can serve them. */
export const GENERIC_CAPABILITIES = new Set<string>([
  "general_reasoning", "general reasoning", "reasoning", "model", "api", "llm", "analysis", "summarize", "summarization", "question answering"
]);

/** Canonical token → AI role(s) it requires. Unknown canonical tokens resolve to no AI role. */
const ROLE_BY_TOKEN: Record<string, AICapability[]> = {
  planning: ["planning"], decompose: ["planning"], replan: ["planning"],
  research: ["research"], web_search: ["research"], literature: ["research"],
  review: ["review"], critique: ["critique"], critic: ["critique"],
  synthesis: ["synthesis"], synthesize: ["synthesis"],
  coding: ["coding"], code_edit: ["coding"], codex: ["coding"], implement: ["coding"], refactor: ["coding"],
  validation: ["validation"], verify: ["validation"], test: ["validation"],
  vision: ["research"], image_generation: ["synthesis"],
  email_send: ["research"], general_reasoning: []
};

export interface CapabilityResolution {
  /** AI roles the required capabilities map to (empty = no AI role demand). */
  aiRoles: AICapability[];
  /** True when at least one token is native/deterministic-capable. */
  nativeSufficient: boolean;
  /** Execution kinds implied by the tokens (deterministic/web/codex/api). */
  kinds: ExecutionCostKind[];
  /** Tokens that could not be recognized at all (never silently dropped). */
  unresolved: string[];
}

function canonicalToken(token: string): string {
  return token.trim().toLocaleLowerCase().replace(/\s+/g, " ").replace(/_/g, " ");
}

const ROLE_BY_CANONICAL: Record<string, AICapability[]> = {};
for (const [token, roles] of Object.entries(ROLE_BY_TOKEN)) {
  ROLE_BY_CANONICAL[canonicalToken(token)] = roles;
  // Underscore and hyphen forms both canonicalize to the spaced form.
  ROLE_BY_CANONICAL[canonicalToken(token.replace(/_/g, "-"))] = roles;
}

/**
 * Resolves free-text required capabilities into router-enforceable facts.
 * Deterministic: same tokens always yield the same resolution. Unknown tokens
 * are reported, not assumed satisfied (fail-open for the caller to decide).
 */
export function resolveCapabilityGraph(capabilities: string[]): CapabilityResolution {
  const aiRoles = new Set<AICapability>();
  const kinds = new Set<ExecutionCostKind>();
  let nativeSufficient = false;
  const unresolved: string[] = [];
  for (const token of capabilities ?? []) {
    if (typeof token !== "string" || !token.trim()) continue;
    const canonical = canonicalToken(token);
    if (NATIVE_CAPABILITIES.has(token.trim().toLocaleLowerCase()) || NATIVE_CAPABILITIES.has(canonical)) { nativeSufficient = true; kinds.add("deterministic"); continue; }
    if (GENERIC_CAPABILITIES.has(canonical) || GENERIC_CAPABILITIES.has(token.trim().toLocaleLowerCase())) { continue; } // any model runtime can serve generic reasoning; no kind/role demand
    const roles = ROLE_BY_CANONICAL[canonical];
    if (roles) { roles.forEach((role) => aiRoles.add(role)); }
    const kind = resolveCapabilityToKind(token);
    if (kind !== "unknown") kinds.add(kind);
    if (!roles && kind === "unknown" && !NATIVE_CAPABILITIES.has(canonical)) unresolved.push(token);
  }
  return { aiRoles: AI_CAPABILITIES.filter((role) => aiRoles.has(role)), nativeSufficient, kinds: [...kinds], unresolved };
}

/**
 * Router gate: a plan that requires explicit capabilities may only route to a
 * candidate that can satisfy them. When the graph found no AI role and no
 * deterministic sufficiency the request is treated as generic reasoning (any
 * AI runtime can serve it).
 */
export function capabilitySatisfiedBy(resolution: CapabilityResolution, input: { roles: readonly string[]; consumesModel?: boolean; supportsNative?: boolean }): boolean {
  if (resolution.unresolved.length) return false;
  if (resolution.nativeSufficient && input.supportsNative) return true;
  if (resolution.aiRoles.length === 0) return input.consumesModel !== false && (input.roles.length > 0 || resolution.nativeSufficient);
  return resolution.aiRoles.every((role) => input.roles.includes(role));
}
