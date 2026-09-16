/**
 * Capability authorization contracts (platform foundation, Phase 03 Task A).
 *
 * The vocabulary for "who may do what, to which resource, for how long". Phase 01 named the
 * capabilities and Phase 02 gave authorization facts somewhere durable to live; this is the
 * decision layer that sits between them, and it exists because the repository's existing
 * boundaries were five unrelated mechanisms — the execution gate, root authority, the
 * provider registry, the credential boundary and the permission manifest — with no shared
 * answer to "may this subject do this?".
 *
 * ## The rules this file is written to enforce
 *
 *  - **Default deny.** A request that no grant covers is denied. There is no "trusted"
 *    shortcut, no `allowAll`, and no wildcard admin: an unrecognised resource, action or
 *    constraint value is a denial, not a hint.
 *  - **A decision always explains itself.** Every `Decision` carries a reason code and an
 *    evidence reference, because "denied" with no reason is indistinguishable from a bug.
 *  - **Permission is never a boolean.** A grant binds a subject to a capability, a resource
 *    pattern, a set of actions, a scope, a lifetime and constraints. The engineering book
 *    refuses a bare `isTrusted = true`, so there is no field shaped like one.
 *  - **No ambient authority.** Every constraint axis starts at its most restrictive value,
 *    so a grant that forgets to mention the network grants no network access.
 *
 * ## Pure and Electron-free
 *
 * Like the Phase 01 contract, this module holds shapes and total functions over them: no
 * filesystem, no clock beyond an injected timestamp, no Electron. The broker and the plugin
 * boundary are built on top, and a unit test can decide any request without a process.
 */

/** Who is asking. `plugin.*` subjects are untrusted by construction; `owner` is not a plugin. */
export type SubjectId = string;

/** What is being accessed, in a namespaced resource grammar, e.g. `repo:owner/name`. */
export type ResourceId = string;

/** A single verb, e.g. `read`, `commit.push`, `email.send`. */
export type ActionId = string;

/**
 * Scope narrows a grant to a context. `global` is the widest and must be asked for
 * explicitly; a project- or task-scoped grant never covers another project's resource.
 */
export interface CapabilityScope {
  project: string;
  task?: string;
}

/** How long a grant lives. `session` means "until the process exits or it is revoked". */
interface CapabilityLifetime {
  mode: "session" | "expiry" | "forever";
  /** Required when `mode` is `expiry`. An ISO timestamp. */
  expiresAt?: string;
}

/**
 * The non-negotiable halves of a grant's constraint set.
 *
 * Every axis is REQUIRED, which is the encoding of "no ambient authority": a grant cannot
 * omit the network line and hope, because there is nothing to omit — the type demands a
 * value and the most permissive value has to be written down and reviewed.
 */
export interface CapabilityConstraints {
  /** Filesystem reach: `none`, `workspace-read`, or `workspace-read-write`. */
  filesystem: "none" | "workspace-read" | "workspace-read-write";
  /** Network reach: `none`, `allowlist` (paired with `networkHosts`), or `any`. */
  network: "none" | "allowlist" | "any";
  /** Hosts the grant may reach, only meaningful when `network` is `allowlist`. */
  networkHosts?: string[];
  /** Whether the subject may start a child process or a shell. */
  shell: "none" | "spawn";
  /** Whether the subject may read secrets from the environment. */
  environment: "none" | "sanitized";
  /** Whether the subject may read credential material directly. Never anything but `none`. */
  credential: "none" | "reference-only";
  /** Repository operations that are administratively protected. */
  admin: boolean;
  /** Whether a force push is permitted. */
  forcePush: boolean;
}

/**
 * A grant of authority.
 *
 * `allowedActions` is an explicit list, never `*` — see `isWildcardAction`. Resource patterns
 * are matched by `resourceMatches`, which understands a `prefix:` wildcard and nothing else.
 */
export interface CapabilityGrant {
  /** Durable identity of this grant, so a decision can cite it as evidence. */
  id: string;
  subject: SubjectId;
  capability: string;
  /** Resource patterns this grant covers, e.g. `repo:owner/name`, `ui.theme:*`. */
  resources: string[];
  allowedActions: ActionId[];
  /** Actions explicitly withheld. Checked BEFORE `allowedActions`, so it can only narrow. */
  deniedActions?: ActionId[];
  scope: CapabilityScope;
  lifetime: CapabilityLifetime;
  constraints: CapabilityConstraints;
  /** Why this grant exists, in the granting authority's words. Required. */
  reason: string;
}

/** A request for authority. Absent fields are the most restrictive interpretation. */
export interface CapabilityRequest {
  subject: SubjectId;
  capability: string;
  resource: ResourceId;
  action: ActionId;
  scope: CapabilityScope;
  /** Constraints the caller needs. A request can never widen a grant, only fail to fit it. */
  constraints?: Partial<CapabilityConstraints>;
}

/**
 * Why a decision came out the way it did.
 *
 * A closed set rather than free text: a caller that wants to react to a denial needs to
 * branch on the reason, and `message` is for the human reading the log.
 */
export type DenialReason =
  | "no-grant"
  | "subject-mismatch"
  | "capability-mismatch"
  | "resource-not-covered"
  | "action-not-allowed"
  | "action-explicitly-denied"
  | "scope-mismatch"
  | "expired"
  | "revoked"
  | "constraint-filesystem"
  | "constraint-network"
  | "constraint-shell"
  | "constraint-environment"
  | "constraint-credential"
  | "constraint-admin"
  | "constraint-force-push"
  | "unresolvable-resource"
  | "unresolvable-action";

type AllowReason = "granted" | "granted-with-narrower-constraints";

/**
 * The outcome. `DENY` is the only answer this type can give for an unknown request, because
 * `evaluate` cannot return `ALLOW` without a matching grant in hand.
 */
export interface Decision {
  outcome: "ALLOW" | "DENY";
  subject: SubjectId;
  capability: string;
  resource: ResourceId;
  action: ActionId;
  reason: AllowReason | DenialReason;
  /** One line for a human: never the only information, always present. */
  message: string;
  /** What the decision was based on: the grant id, or the files that declare the subject. */
  evidence: string;
  /** The constraints actually in force, which may be narrower than the request. */
  effective?: Partial<CapabilityConstraints>;
  decidedAt: string;
}

/**
 * Whether an action string is a wildcard.
 *
 * Exported because it is the check that keeps `allowAll` out of the system: `validateGrant`
 * rejects a wildcard, and a test asserts that, so no future grant can reintroduce one by
 * accident. It is also why the book's rollback rule ("any `allowAll`, wildcard admin or
 * ambient token added for compatibility is a phase failure") is machine-checkable.
 */
export function isWildcardAction(action: string): boolean {
  return action === "*" || action === "all" || action.endsWith(".*") || action.endsWith(":*");
}

/**
 * Whether an action is the literal `all`.
 *
 * Separate from `isWildcardAction` because `isResolvableAction` must reject BOTH spellings, and the
 * first version only excluded `*` — so `all` passed the grammar check and reached `evaluate`, where
 * it was refused as an unresolvable action only by luck of ordering. Asserted directly now.
 */
function isAllAction(action: string): boolean {
  return action === "all";
}

/**
 * Match a resource against a grant's pattern.
 *
 * Two forms only: an exact id, or `prefix:` meaning "this prefix and anything under it". The
 * `:` separator is the structure, so `repo:owner/name` matches `repo:owner/name` and
 * `repo:owner/name:branch` but NOT `repo:owner/name-other` — a prefix match on the raw string
 * would have let `name-other` through, which is the classic scope-escape bug.
 */
export function resourceMatches(pattern: string, resource: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed === resource) return true;
  if (!trimmed.endsWith(":")) return false;
  return resource.startsWith(trimmed);
}

/**
 * Whether a grant's scope covers a request's scope.
 *
 * Narrowing is one-directional: a `project: alpha` grant never covers `project: beta`, and an
 * `global` grant covers any project. A task-scoped request is only covered by a grant with the
 * same task, or a grant with no task (which means "any task in this project").
 */
export function scopeCovers(grantScope: CapabilityScope, requestScope: CapabilityScope): boolean {
  const projectCovers = grantScope.project === "global" || grantScope.project === requestScope.project;
  if (!projectCovers) return false;
  if (grantScope.task === undefined) return true;
  return grantScope.task === requestScope.task;
}

/** The most restrictive constraint set: what a subject has when nobody granted it anything. */
export const NO_AUTHORITY: CapabilityConstraints = {
  filesystem: "none",
  network: "none",
  shell: "none",
  environment: "none",
  credential: "none",
  admin: false,
  forcePush: false
};

/** Ordering used to decide whether a request fits inside a grant. Higher is more permissive. */
const FILESYSTEM_RANK: Record<CapabilityConstraints["filesystem"], number> = { none: 0, "workspace-read": 1, "workspace-read-write": 2 };
const NETWORK_RANK: Record<CapabilityConstraints["network"], number> = { none: 0, allowlist: 1, any: 2 };
const SHELL_RANK: Record<CapabilityConstraints["shell"], number> = { none: 0, spawn: 1 };
const ENVIRONMENT_RANK: Record<CapabilityConstraints["environment"], number> = { none: 0, sanitized: 1 };
const CREDENTIAL_RANK: Record<CapabilityConstraints["credential"], number> = { none: 0, "reference-only": 1 };

/** The refusal a validation helper throws. Distinct so a caller can catch it by type. */
export class GrantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantValidationError";
  }
}

/**
 * Validate a grant, refusing every shape the book forbids.
 *
 * Checked rather than trusted, because a manifest is data and data can be wrong: a wildcard
 * action, a missing reason, an expiry with no timestamp, a `credential` value that would hand
 * over raw material, or an `admin: true` with no stated justification are all rejected here.
 */
export function validateGrant(grant: CapabilityGrant): void {
  if (!grant.id || !grant.id.trim()) throw new GrantValidationError("a grant requires an id, so a decision can cite it");
  if (!grant.subject || !grant.subject.trim()) throw new GrantValidationError(`grant ${grant.id} has no subject`);
  if (!grant.capability || !grant.capability.trim()) throw new GrantValidationError(`grant ${grant.id} has no capability`);
  if (!grant.reason || !grant.reason.trim()) throw new GrantValidationError(`grant ${grant.id} has no stated reason; an unexplained grant is not reviewable`);
  if (grant.resources.length === 0) throw new GrantValidationError(`grant ${grant.id} covers no resource, so it can never match anything`);
  for (const pattern of grant.resources) {
    if (!pattern.trim()) throw new GrantValidationError(`grant ${grant.id} has an empty resource pattern`);
    // A `*` anywhere in a resource pattern is the wildcard-resource shape the book names as a
    // phase failure. `resourceMatches` understands one wildcard and it is the trailing `:`.
    if (pattern.includes("*")) throw new GrantValidationError(`grant ${grant.id} covers the wildcard resource ${JSON.stringify(pattern)}; use a trailing ':' prefix instead, which the matcher understands`);
  }
  if (grant.allowedActions.length === 0) throw new GrantValidationError(`grant ${grant.id} allows no action`);
  for (const action of grant.allowedActions) {
    if (isWildcardAction(action)) throw new GrantValidationError(`grant ${grant.id} allows the wildcard action ${JSON.stringify(action)}; the engineering book treats a wildcard grant as a phase failure`);
  }
  for (const action of grant.deniedActions ?? []) {
    if (isWildcardAction(action)) throw new GrantValidationError(`grant ${grant.id} denies the wildcard action ${JSON.stringify(action)}`);
  }
  if (grant.lifetime.mode === "expiry" && !grant.lifetime.expiresAt) {
    throw new GrantValidationError(`grant ${grant.id} has an expiry lifetime with no expiresAt`);
  }
  if (grant.lifetime.expiresAt && Number.isNaN(Date.parse(grant.lifetime.expiresAt))) {
    throw new GrantValidationError(`grant ${grant.id} has an unparseable expiresAt: ${grant.lifetime.expiresAt}`);
  }
  if (grant.constraints.credential === "none" && grant.allowedActions.some((action) => action.startsWith("credential."))) {
    throw new GrantValidationError(`grant ${grant.id} allows a credential action but forbids credential access`);
  }
  if (grant.constraints.admin && !/admin/i.test(grant.reason)) {
    throw new GrantValidationError(`grant ${grant.id} requests admin without saying why in its reason`);
  }
  if (grant.constraints.network === "allowlist" && (grant.constraints.networkHosts ?? []).length === 0) {
    throw new GrantValidationError(`grant ${grant.id} uses an allowlist network constraint with no hosts, which would allow nothing while reading as a network grant`);
  }
}

/** Whether a grant is still live at `at`. Revocation is handled by the broker, not here. */
export function isLifetimeActive(lifetime: CapabilityLifetime, at: string): boolean {
  if (lifetime.mode === "forever" || lifetime.mode === "session") return true;
  if (!lifetime.expiresAt) return false;
  return Date.parse(at) < Date.parse(lifetime.expiresAt);
}
