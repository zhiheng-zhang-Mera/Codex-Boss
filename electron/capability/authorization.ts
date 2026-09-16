import {
  isLifetimeActive,
  resourceMatches,
  scopeCovers,
  validateGrant,
  type ActionId,
  type CapabilityConstraints,
  type CapabilityGrant,
  type CapabilityRequest,
  type Decision,
  type DenialReason,
  type ResourceId,
  type SubjectId
} from "./permission-contract";

/**
 * Capability authorization engine (platform foundation, Phase 03 Task A).
 *
 * The single function that answers "may this subject do this?". Everything else in Phase 03 —
 * the broker, the plugin boundary, the credential references — asks this and obeys the answer.
 *
 * ## Default deny, structurally
 *
 * `evaluate` cannot return `ALLOW` without a matching grant in hand: there is no branch that
 * allows on absence, on an unparsed resource, or on a "trusted" flag. A subject with no grants
 * is denied with `no-grant`, and a request naming something the grammar cannot parse is denied
 * with `unresolvable-resource` or `unresolvable-action` before any grant is even consulted.
 *
 * ## Constraints can only narrow
 *
 * A grant's constraints are what it can do; a request's constraints are what it says it needs.
 * The engine requires the grant to be at least as permissive as the request on every axis, and
 * reports the effective set as the GRANT's (not the request's) so a caller never believes it
 * received more reach than it did. A request that omits a constraint is read at the most
 * restrictive value, so nothing is widened by forgetting to mention it.
 *
 * ## Decisions are evidence
 *
 * Every decision names the grant it was based on, or the absence of one, in `evidence`. Phase 02
 * provided the durable place to store those facts; this module only produces them.
 */

/**
 * The resource grammar.
 *
 * `<namespace>:<path>`, where the namespace is a lowercase identifier and the path is one or more
 * segments joined by `:`, `/` or `.`, with every segment requiring at least one alphanumeric.
 *
 * Written as explicit segment validation rather than one regex, after three regex attempts were
 * each wrong in a different way the tests caught: a required trailing separator, a continuation
 * class whose `.` swallowed the separator colon, and then a grammar that could not tell an
 * internal dot (`api.example.com`) from a separating one. Two roles for the same character is not
 * a pattern problem worth solving — splitting on the separators and validating the parts is
 * clearer, and its failure messages name the offending segment.
 *
 * `*` is deliberately NOT in the alphabet. It was in the very first version, so `ui.theme:*` parsed
 * as a resolvable resource and a grant could carry it — a wildcard resource by the back door, and
 * exactly the `allowAll` shape the engineering book calls a phase failure. Rejecting it makes
 * `isResolvableResource("ui.theme:*")` false, so `evaluate` denies any request naming one AND
 * `validateGrant` refuses a grant covering one.
 */
/**
 * The namespace part of a resource, e.g. `ui.theme`, `repo`, `project`, `credential`.
 *
 * Dots are allowed because capability namespaces are dotted — `ui.theme` is a namespace, not a
 * namespace plus a segment. The previous version required a bare identifier, which rejected
 * `ui.theme:current`; the diagnostic that found it is worth keeping in mind, because the resource
 * grammar has two places a dot is legal and only one of them is the path.
 */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/;
/** A bare segment: alphanumerics, `_`, `@`, `-`, and internal dots. No separators, no `*`. */
const SEGMENT_PATTERN = /^[A-Za-z0-9_@-]+(?:\.[A-Za-z0-9_@-]+)*$/;
const ACTION_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/;
const SUBJECT_PATTERN = /^[a-z][a-z0-9-]*(?:[._-][a-z0-9-]+)*$/;

export function isResolvableResource(resource: ResourceId): boolean {
  if (typeof resource !== "string") return false;
  // Reject any control character or space before splitting, so a resource cannot smuggle
  // whitespace past a segment check.
  if (/[\s]/.test(resource)) return false;
  const separator = resource.indexOf(":");
  if (separator <= 0) return false;
  const namespace = resource.slice(0, separator);
  const path = resource.slice(separator + 1);
  if (!NAMESPACE_PATTERN.test(namespace)) return false;
  // `*` is not in the alphabet, so a wildcard resource fails here.
  if (path.includes("*")) return false;
  const segments = path.split(/[:/.]/);
  if (segments.length === 0) return false;
  return segments.every((segment) => segment.length > 0 && SEGMENT_PATTERN.test(segment));
}

export function isResolvableAction(action: ActionId): boolean {
  // `*` fails the grammar anyway; `all` would NOT, so it is excluded explicitly rather than left to
  // the pattern. An action named `all` is a wildcard grant by another name.
  return typeof action === "string" && ACTION_PATTERN.test(action.trim()) && action !== "*" && action !== "all";
}

export function isResolvableSubject(subject: SubjectId): boolean {
  return typeof subject === "string" && SUBJECT_PATTERN.test(subject.trim());
}

/**
 * Whether a subject is a plugin.
 *
 * Namespaced rather than a flag, so a plugin cannot claim otherwise: the subject id is written
 * into the grant and into every decision, and the broker refuses plugin subjects any capability
 * the plugin contract does not publish.
 */
export function isPluginSubject(subject: SubjectId): boolean {
  return subject.startsWith("plugin.");
}

/** The most restrictive reading of a request's constraints. */
function requestedConstraints(request: CapabilityRequest): CapabilityConstraints {
  const asked = request.constraints ?? {};
  return {
    filesystem: asked.filesystem ?? "none",
    network: asked.network ?? "none",
    ...(asked.networkHosts ? { networkHosts: asked.networkHosts } : {}),
    shell: asked.shell ?? "none",
    environment: asked.environment ?? "none",
    credential: asked.credential ?? "none",
    admin: asked.admin ?? false,
    forcePush: asked.forcePush ?? false
  };
}

/** One constraint axis that the grant does not cover. */
interface ConstraintShortfall {
  reason: DenialReason;
  detail: string;
}

/**
 * Compare a request's needs against a grant's reach.
 *
 * Returns the FIRST shortfall rather than all of them: a denial is actionable when it names one
 * concrete axis, and a caller acting on an allowlist of reasons would otherwise have to invent
 * an ordering.
 */
function constraintShortfall(grant: CapabilityConstraints, request: CapabilityConstraints): ConstraintShortfall | undefined {
  const rank = { filesystem: ["none", "workspace-read", "workspace-read-write"], network: ["none", "allowlist", "any"], shell: ["none", "spawn"], environment: ["none", "sanitized"], credential: ["none", "reference-only"] } as const;

  if (rank.filesystem.indexOf(grant.filesystem) < rank.filesystem.indexOf(request.filesystem)) {
    return { reason: "constraint-filesystem", detail: `filesystem ${request.filesystem} exceeds ${grant.filesystem}` };
  }
  if (rank.network.indexOf(grant.network) < rank.network.indexOf(request.network)) {
    return { reason: "constraint-network", detail: `network ${request.network} exceeds ${grant.network}` };
  }
  if (grant.network === "allowlist" && request.network === "allowlist") {
    // An allowlist grant only covers hosts both sides name, so a request naming a host the
    // grant does not is refused rather than silently narrowed to the intersection.
    const granted = new Set(grant.networkHosts ?? []);
    const unmatched = (request.networkHosts ?? []).filter((host) => !granted.has(host));
    if (unmatched.length > 0) return { reason: "constraint-network", detail: `network host(s) not granted: ${unmatched.join(", ")}` };
  }
  if (rank.shell.indexOf(grant.shell) < rank.shell.indexOf(request.shell)) {
    return { reason: "constraint-shell", detail: `shell ${request.shell} exceeds ${grant.shell}` };
  }
  if (rank.environment.indexOf(grant.environment) < rank.environment.indexOf(request.environment)) {
    return { reason: "constraint-environment", detail: `environment ${request.environment} exceeds ${grant.environment}` };
  }
  if (rank.credential.indexOf(grant.credential) < rank.credential.indexOf(request.credential)) {
    return { reason: "constraint-credential", detail: `credential ${request.credential} exceeds ${grant.credential}` };
  }
  if (request.admin && !grant.admin) return { reason: "constraint-admin", detail: "admin access was requested but is not granted" };
  if (request.forcePush && !grant.forcePush) return { reason: "constraint-force-push", detail: "force push was requested but is not granted" };
  return undefined;
}

export interface EvaluateOptions {
  /** The decision timestamp. Injected so a test can decide an expiry without waiting. */
  at: string;
  /**
   * Grants revoked since they were issued. Checked before anything else, so a revocation takes
   * effect on the next call rather than at the next restart — the book requires revoke to bind
   * while the process is running.
   */
  revokedGrantIds?: ReadonlySet<string>;
}

/**
 * Decide one request.
 *
 * `grants` is the subject's full grant set. The function is pure: the same inputs and the same
 * `at` always produce the same decision, which is what makes it testable and what lets the
 * broker record a decision as durable evidence without a race.
 */
export function evaluate(grants: readonly CapabilityGrant[], request: CapabilityRequest, options: EvaluateOptions): Decision {
  const base = {
    subject: request.subject,
    capability: request.capability,
    resource: request.resource,
    action: request.action,
    decidedAt: options.at
  };

  // 1. The request must be well-formed before any grant is consulted. An unresolvable resource
  //    is a denial, never a pass-through: that is the rule the book states explicitly.
  if (!isResolvableSubject(request.subject)) {
    return { ...base, outcome: "DENY", reason: "unresolvable-resource", message: `subject ${JSON.stringify(request.subject)} is not a resolvable subject id`, evidence: "permission-contract:subject-grammar" };
  }
  if (!isResolvableResource(request.resource)) {
    return { ...base, outcome: "DENY", reason: "unresolvable-resource", message: `resource ${JSON.stringify(request.resource)} does not match <namespace>:<path>`, evidence: "permission-contract:resource-grammar" };
  }
  if (!isResolvableAction(request.action)) {
    return { ...base, outcome: "DENY", reason: "unresolvable-action", message: `action ${JSON.stringify(request.action)} is not a resolvable action id`, evidence: "permission-contract:action-grammar" };
  }

  const candidates = grants.filter((grant) => grant.subject === request.subject && grant.capability === request.capability);
  if (candidates.length === 0) {
    // Distinguish "this subject has nothing" from "this subject has grants, just not this one",
    // because the two are different problems for whoever reads the log.
    const subjectHasGrants = grants.some((grant) => grant.subject === request.subject);
    return {
      ...base,
      outcome: "DENY",
      reason: subjectHasGrants ? "capability-mismatch" : "no-grant",
      message: subjectHasGrants
        ? `subject ${request.subject} holds no grant for capability ${request.capability}`
        : `subject ${request.subject} holds no grants at all; default deny applies`,
      evidence: subjectHasGrants ? `grants:${grants.filter((grant) => grant.subject === request.subject).map((grant) => grant.id).join(",")}` : "grants:none"
    };
  }

  // Deterministic order: the most recently issued grant first, so a later grant can add reach
  // without the outcome depending on array order.
  const ordered = [...candidates].sort((left, right) => (left.id < right.id ? 1 : -1));
  const requested = requestedConstraints(request);
  const denials: Array<{ reason: DenialReason; detail: string; grant: string }> = [];

  for (const grant of ordered) {
    if (options.revokedGrantIds?.has(grant.id)) {
      denials.push({ reason: "revoked", detail: `grant ${grant.id} was revoked`, grant: grant.id });
      continue;
    }
    if (!isLifetimeActive(grant.lifetime, options.at)) {
      denials.push({ reason: "expired", detail: `grant ${grant.id} expired at ${grant.lifetime.expiresAt}`, grant: grant.id });
      continue;
    }
    if (!scopeCovers(grant.scope, request.scope)) {
      denials.push({ reason: "scope-mismatch", detail: `grant ${grant.id} is scoped to ${grant.scope.project}${grant.scope.task ? `/${grant.scope.task}` : ""}, the request to ${request.scope.project}${request.scope.task ? `/${request.scope.task}` : ""}`, grant: grant.id });
      continue;
    }
    if (!grant.resources.some((pattern) => resourceMatches(pattern, request.resource))) {
      denials.push({ reason: "resource-not-covered", detail: `grant ${grant.id} covers ${grant.resources.join(", ")}`, grant: grant.id });
      continue;
    }
    // Denied actions win over allowed ones, so a grant can only ever narrow an earlier one.
    if ((grant.deniedActions ?? []).includes(request.action)) {
      denials.push({ reason: "action-explicitly-denied", detail: `grant ${grant.id} explicitly denies ${request.action}`, grant: grant.id });
      continue;
    }
    if (!grant.allowedActions.includes(request.action)) {
      denials.push({ reason: "action-not-allowed", detail: `grant ${grant.id} allows ${grant.allowedActions.join(", ")}`, grant: grant.id });
      continue;
    }
    const shortfall = constraintShortfall(grant.constraints, requested);
    if (shortfall) {
      denials.push({ reason: shortfall.reason, detail: shortfall.detail, grant: grant.id });
      continue;
    }

    // The effective constraints are the GRANT's, so a caller never believes it received the
    // reach it asked for when the grant was in fact narrower on some axis it did not mention.
    const effective: Partial<CapabilityConstraints> = { ...grant.constraints };
    const narrowed = JSON.stringify({ ...grant.constraints }) !== JSON.stringify(requested);
    return {
      ...base,
      outcome: "ALLOW",
      reason: narrowed ? "granted-with-narrower-constraints" : "granted",
      message: `allowed by grant ${grant.id} (${grant.reason})`,
      evidence: `grant:${grant.id}`,
      effective
    };
  }

  // Nothing matched. Report the most specific refusal available: a revocation or an expiry is
  // more useful than "no grant covered the resource" when both are true.
  const priority: DenialReason[] = ["revoked", "expired", "action-explicitly-denied", "constraint-admin", "constraint-force-push", "constraint-credential", "constraint-shell", "constraint-environment", "constraint-network", "constraint-filesystem", "scope-mismatch", "resource-not-covered", "action-not-allowed", "capability-mismatch", "no-grant"];
  const chosen = priority.map((reason) => denials.find((denial) => denial.reason === reason)).find((entry) => entry !== undefined) ?? denials[0];
  return {
    ...base,
    outcome: "DENY",
    reason: chosen.reason,
    message: `denied: ${chosen.detail}`,
    evidence: `grant:${chosen.grant}`
  };
}

/** Validate every grant a subject holds. Throws `GrantValidationError` on the first bad one. */
export function validateGrants(grants: readonly CapabilityGrant[]): void {
  const seen = new Set<string>();
  for (const grant of grants) {
    validateGrant(grant);
    if (seen.has(grant.id)) throw new Error(`duplicate grant id: ${grant.id}`);
    seen.add(grant.id);
  }
}

/** Every grant a subject holds, sorted by id so a report is deterministic. */
export function grantsFor(grants: readonly CapabilityGrant[], subject: SubjectId): CapabilityGrant[] {
  return grants.filter((grant) => grant.subject === subject).sort((left, right) => (left.id < right.id ? -1 : 1));
}

/**
 * Whether a grant set contains an `allowAll`-shaped permission.
 *
 * A separate check because the book names it as a phase failure rather than a style problem:
 * "any `allowAll`, wildcard admin or ambient token added for compatibility counts as the phase
 * failing". This is the predicate a test and the artifact generator both call.
 */
export function findWildcardAuthority(grants: readonly CapabilityGrant[]): string[] {
  const offenders: string[] = [];
  for (const grant of grants) {
    if (grant.resources.some((pattern) => pattern === "*" || pattern === ":" ) || grant.resources.length === 0) offenders.push(`${grant.id}:resource-wildcard`);
    if (grant.allowedActions.some((action) => action === "*" || action === "all" || action.endsWith(".*"))) offenders.push(`${grant.id}:action-wildcard`);
    if (grant.constraints.admin && grant.allowedActions.some((action) => action === "admin")) offenders.push(`${grant.id}:wildcard-admin`);
    if (grant.constraints.credential !== "none" && grant.constraints.credential !== "reference-only") offenders.push(`${grant.id}:ambient-credential`);
  }
  return offenders;
}
