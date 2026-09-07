/**
 * Work mode 1/3/5 + role assignment (plan §6/§6.4/§34). Pure + shareable.
 *
 * The unified plan forbids orchestration code from assuming a fixed number of
 * AI workers: work is configured by `WorkAgentCount = 1 | 3 | 5` and the Role
 * Assignment Engine maps that count to a role set. Roles are a vocabulary of
 * review duties — never a hard-coded provider brand — so a 5-AI intensive run
 * widens review (adds Security/Failure + Performance/Maintainability) while a
 * 1-AI run rotates through isolated stages with fresh context.
 *
 * This module only decides; executors/supervisors still own how many physical
 * workers/execution planes run (plan §35 decouples coding workers from the
 * cognitive/review pool).
 */

export type WorkAgentCount = 1 | 3 | 5;

export const WORK_AGENT_COUNTS: readonly WorkAgentCount[] = [1, 3, 5];

/** Review-role vocabulary (plan §6.2/§6.3 + §34). */
export type WorkRole = "architecture" | "correctness" | "qa" | "security" | "performance" | "maintainability";

export const WORK_ROLES: readonly WorkRole[] = ["architecture", "correctness", "qa", "security", "performance", "maintainability"];

/** §6.2/§6.3 default role pool per agent count (1/3/5). */
const DEFAULT_ROLES: Record<WorkAgentCount, readonly WorkRole[]> = {
  1: ["architecture"],
  3: ["architecture", "correctness", "qa"],
  5: ["architecture", "correctness", "qa", "security", "performance"]
};

/** Role focus prompt suffix — keeps review briefs distinct, never boilerplate. */
export const ROLE_FOCUS: Record<WorkRole, string> = {
  architecture: "Focus on structure, dependency boundaries, interface design and scalability of the proposal.",
  correctness: "Focus on correctness, edge cases, logic errors and adversarial cases. Find reproducible bugs over agreement.",
  qa: "Focus on reliability: tests, failure modes, error handling, recovery and verification evidence.",
  security: "Focus on security and failure modes: injection, secrets, privilege, data integrity and denial-of-service.",
  performance: "Focus on performance and maintainability: complexity, hot paths, clarity, duplication and dead code.",
  maintainability: "Focus on maintainability: readability, naming, structure, duplication and long-term changeability."
};

export function isWorkAgentCount(value: unknown): value is WorkAgentCount {
  return value === 1 || value === 3 || value === 5;
}

export function isWorkRole(value: unknown): value is WorkRole {
  return typeof value === "string" && (WORK_ROLES as readonly string[]).includes(value);
}

/**
 * Default role set for an agent count (plan §6.4: count and roles are
 * decoupled — this is only the default automatic mapping, overridable).
 */
export function rolesForAgentCount(count: WorkAgentCount): readonly WorkRole[] {
  return DEFAULT_ROLES[count];
}

/**
 * Deterministic role assignment for an ordered worker/provider list of any
 * size: roles repeat over the pool when the count exceeds the default set, so
 * a custom 5-wide pool still gets a well-defined role for every index.
 */
export function roleForWorkerIndex(index: number, count: WorkAgentCount): WorkRole {
  if (!Number.isInteger(index) || index < 0) throw new Error("Worker index must be a non-negative integer");
  const set = DEFAULT_ROLES[count];
  return set[index % set.length];
}

/** Builds a role-briefed review instruction for one worker (plan §34 fresh roles). */
export function roleBrief(role: WorkRole): string {
  return `You are the ${role} reviewer in this AI review pool.\n${ROLE_FOCUS[role]}`;
}

export interface WorkConfig {
  /** 1 | 3 | 5 — the cognitive/review pool size (plan §6). */
  agentCount: WorkAgentCount;
  /** Explicit role list (optional; default automatic mapping when absent). */
  roles?: WorkRole[];
}

export function validateWorkConfig(config: unknown): config is WorkConfig {
  if (!config || typeof config !== "object") return false;
  const value = config as Partial<WorkConfig>;
  if (!isWorkAgentCount(value.agentCount)) return false;
  if (value.roles !== undefined && (!Array.isArray(value.roles) || value.roles.some((role) => !isWorkRole(role)))) return false;
  return true;
}

/** Effective roles for a config: explicit roles when valid, else the default map. */
export function effectiveRoles(config: WorkConfig): readonly WorkRole[] {
  return config.roles?.length ? config.roles : rolesForAgentCount(config.agentCount);
}

/**
 * Assigns roles to an ordered worker/provider list. Workers beyond the pool
 * are advisory readers (undefined role) — they never own a review duty they
 * were not assigned.
 */
export function assignRoles(workers: readonly string[], config: WorkConfig): ReadonlyMap<string, WorkRole> {
  const roles = effectiveRoles(config);
  return new Map(workers.map((worker, index) => [worker, roles[index % roles.length]]));
}

/**
 * Role briefs for an ordered worker/provider pool (council default mapping).
 * Each worker index maps deterministically onto the WorkRole vocabulary so a
 * multi-AI council is never N identical reviewers (plan §34): index 0 →
 * architecture, 1 → correctness, 2 → qa, 3 → security, 4 → performance.
 */
export function roleBriefsForWorkerOrder(workers: readonly string[]): ReadonlyMap<string, string> {
  return new Map(workers.map((worker, index) => [worker, roleBrief(WORK_ROLES[index % WORK_ROLES.length])]));
}

/** Derives a default WorkConfig from the number of chosen workers, or null for sizes 2/4. */
export function defaultConfigForWorkerCount(workerCount: number): WorkConfig | null {
  if (!Number.isInteger(workerCount) || workerCount < 1) return null;
  if (workerCount <= 1) return { agentCount: 1 };
  if (workerCount <= 3) return { agentCount: 3 };
  if (workerCount <= 5) return { agentCount: 5 };
  return null;
}

/**
 * Default ordered role map for an actual worker/provider pool of 1..5 workers
 * (plan §6.2 default auto-mapping for the visible-web Work flow). Distinct per
 * index so a 5-wide pool gets Architecture/Correctness/QA/Security/Performance;
 * 1-wide gets Architecture, 2-wide Architecture+Correctness, etc.
 */
export function defaultRolesForWorkers(workerCount: number): readonly WorkRole[] {
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 5) throw new Error("Work worker pool must be 1–5");
  return WORK_ROLES.slice(0, workerCount);
}
