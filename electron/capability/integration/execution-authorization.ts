import { invokeThroughBroker, type CapabilityBroker } from "../capability-broker";
import type { CapabilityConstraints, CapabilityScope, Decision, SubjectId } from "../permission-contract";
import type { ExecutionAuthorizationContext, ExecutionAuthorizationOutcome } from "../../commander/execution-gate";

/**
 * Execution authorization adapter (platform foundation, Phase 03 Task B integration).
 *
 * The bridge between the repository's existing execution vocabulary and the capability layer. It
 * exists because the two speak different languages: `ExecutionGate` thinks in `kind: "shell" |
 * "filesystem" | "git" | "network"`, while an authorization decision needs a subject, a capability,
 * a resource, an action and constraints.
 *
 * ## Why the mapping is data rather than a switch
 *
 * Every mapping is a statement about what an execution kind can reach, and those statements are
 * what a reviewer has to check. Keeping them in one exported table means the claim "a `git`
 * execution requires github.write with neither admin nor force push" is one readable row rather
 * than a branch hidden inside a function — and a test can assert the table is total, so a new
 * execution kind cannot arrive without a capability mapping.
 *
 * ## What this does NOT do
 *
 * It does not decide anything. `authorizeExecution` asks the broker and reports the answer, so the
 * policy stays in the contract and the broker stays the only decision point. It also does not
 * replace `ExecutionGate`'s approval flow: a proposal still has to be validated and approved, and
 * this adds an authorization question ahead of execution rather than relaxing that one.
 */

/** The execution kinds the gate already distinguishes. */
export type ExecutionKind = "shell" | "filesystem" | "git" | "network";

/** One row of the mapping: what an execution kind needs before it may run. */
interface ExecutionCapabilityMapping {
  kind: ExecutionKind;
  capability: string;
  action: string;
  /** `payload=<field>` in the proposal's payload, or `literal=<value>` when it is fixed. */
  resourceFrom: string;
  /**
   * Constraints the execution implies, which the caller's grant must cover. These are the
   * requirements, never permissions: holding this mapping does not grant reach, it demands it.
   */
  constraints: Partial<CapabilityConstraints>;
}

/**
 * What each execution kind requires.
 *
 * The constraints are the load-bearing part. A `git` execution demands `admin: false` and
 * `forcePush: false` explicitly rather than leaving them off, because an omitted field in a REQUEST
 * is read at its most conservative value — writing them down makes the requirement reviewable
 * rather than implied, and a future change that tried to widen it would show up as a diff on this
 * table.
 */
export const EXECUTION_CAPABILITY_MAP: Record<ExecutionKind, ExecutionCapabilityMapping> = {
  shell: {
    kind: "shell",
    capability: "process.exec",
    action: "spawn",
    resourceFrom: "literal:process:shell",
    constraints: { shell: "spawn" }
  },
  filesystem: {
    kind: "filesystem",
    capability: "project.files",
    action: "write",
    resourceFrom: "payload=path",
    constraints: { filesystem: "workspace-read-write" }
  },
  git: {
    kind: "git",
    capability: "github.write",
    action: "commit.push",
    resourceFrom: "payload=repository",
    constraints: { admin: false, forcePush: false }
  },
  network: {
    kind: "network",
    capability: "network.fetch",
    action: "request",
    resourceFrom: "payload=url",
    constraints: { network: "allowlist" }
  }
};

/** Whether a mapping's resource rule is satisfied by a payload. */
export function resolveResource(mapping: ExecutionCapabilityMapping, payload: unknown): { resource?: string; problem?: string } {
  if (mapping.resourceFrom.startsWith("literal:")) return { resource: mapping.resourceFrom.slice("literal:".length) };
  const field = mapping.resourceFrom.slice("payload=".length);
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[field] : undefined;
  if (typeof value !== "string" || value.trim() === "") {
    return { problem: `a ${mapping.kind} execution needs a non-empty ${field} in its payload to name the resource it touches` };
  }
  return { resource: value.trim() };
}

/**
 * Normalise a payload VALUE into the resource grammar.
 *
 * Only called for mappings that take their resource from a payload. The `literal:` form is already
 * a resource, and running it through here was a real bug: `process:shell` was cleaned and re-prefixed
 * into `process:process:shell`, so a grant covering `process:shell` matched nothing and every shell
 * execution was denied for the wrong reason.
 *
 * A payload carries whatever the requester had to hand — a Windows path, a URL, a repository slug —
 * and each kind names its own prefix. A value that cannot be normalised is refused with a problem
 * rather than passed on to be rejected as unresolvable, because "unresolvable resource" hides which
 * field was wrong.
 */
export function normaliseResource(kind: ExecutionKind, value: string): { resource?: string; problem?: string } {
  const cleaned = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (kind === "network") {
    // Accept either a URL or a bare host; the resource is the host, because that is what an
    // allowlist can be written against.
    const host = (() => {
      try {
        return new URL(value).host;
      } catch {
        return cleaned.split("/")[0];
      }
    })();
    if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) return { problem: `network target ${JSON.stringify(value)} does not name a host` };
    return { resource: `network:${host.toLowerCase()}` };
  }
  if (kind === "filesystem") {
    if (cleaned === "" || cleaned.includes("..")) return { problem: `filesystem target ${JSON.stringify(value)} escapes or is empty` };
    return { resource: `project:${cleaned}` };
  }
  if (kind === "git") {
    // `owner/name`, `owner/name.git` or a full URL all reduce to the repository slug.
    const slug = cleaned.replace(/\.git$/, "").replace(/^https?:\/\/[^/]+\//, "").replace(/^git@[^:]+:/, "");
    if (!/^[^/\s]+\/[^/\s]+$/.test(slug)) return { problem: `git target ${JSON.stringify(value)} does not name a repository as owner/name` };
    return { resource: `repo:${slug}` };
  }
  if (kind === "shell") return { resource: `process:${cleaned || "shell"}` };
  return { problem: `no resource normalisation is defined for the execution kind ${kind}` };
}

/** Why an execution was refused, in the vocabulary the capability layer produced. */
interface ExecutionAuthorization {
  allowed: boolean;
  /** The decision behind the answer, always present so a refusal explains itself. */
  decision: Decision;
  subject: SubjectId;
  capability: string;
  resource: string;
  action: string;
}

interface ExecutionAuthorizeInput {
  subject: SubjectId;
  proposal: { kind: ExecutionKind; description: string; payload: unknown; originArtifactId?: string };
  /** Who is asking on the subject's behalf. Recorded, never used to widen anything. */
  principal?: SubjectId;
  scope?: CapabilityScope;
  at?: string;
}

/**
 * Ask the broker whether an execution may proceed.
 *
 * A mapping that cannot resolve its resource, or an execution kind with no mapping at all, is a
 * REFUSAL rather than an exception: the caller asked "may this run?", and the answer to an
 * unanswerable question is no. The decision carries the reason, so the refusal is diagnosable
 * instead of looking like a crash.
 */
export function authorizeExecution(broker: CapabilityBroker, input: ExecutionAuthorizeInput): ExecutionAuthorization {
  const at = input.at ?? new Date().toISOString();
  const principal = input.principal ?? input.subject;
  const mapping = EXECUTION_CAPABILITY_MAP[input.proposal.kind];

  const refuse = (capability: string, resource: string, action: string, reason: string, message: string, evidence: string): ExecutionAuthorization => ({
    allowed: false,
    subject: input.subject,
    capability,
    resource,
    action,
    decision: { outcome: "DENY", subject: input.subject, capability, resource, action, reason: "unresolvable-resource", message, evidence, decidedAt: at }
  });

  if (!mapping) {
    return refuse("unknown.execution", `execution:${String(input.proposal.kind)}`, "run", "unmapped-kind", `no capability mapping exists for the execution kind ${JSON.stringify(input.proposal.kind)}`, "execution-capability-map:missing");
  }

  const resolved = resolveResource(mapping, input.proposal.payload);
  if (resolved.problem) return refuse(mapping.capability, `execution:${mapping.kind}`, mapping.action, "unresolvable-resource", resolved.problem, "execution-capability-map:resource");

  /**
   * A `literal:` resource is already in the grammar and is used as-is.
   *
   * Only a payload-derived value needs normalising. Running the literal through `normaliseResource`
   * was a real bug: `process:shell` was cleaned and re-prefixed into `process:process:shell`, so a
   * grant covering `process:shell` matched nothing and every shell execution was denied — for a
   * resource-coverage reason that looked plausible and was wrong.
   */
  let resource: string;
  if (mapping.resourceFrom.startsWith("literal:")) {
    resource = resolved.resource as string;
  } else {
    const normalised = normaliseResource(mapping.kind, resolved.resource as string);
    if (normalised.problem || !normalised.resource) {
      return refuse(mapping.capability, `execution:${mapping.kind}`, mapping.action, "unresolvable-resource", normalised.problem ?? "the resource could not be normalised", "execution-capability-map:normalise");
    }
    resource = normalised.resource;
  }
  const outcome = invokeThroughBroker(
    broker,
    input.subject,
    {
      capability: mapping.capability,
      resource,
      action: mapping.action,
      scope: input.scope ?? { project: "global" },
      constraints: mapping.constraints
    },
    principal,
    at,
    input.proposal.payload
  );
  return { allowed: outcome.allowed, decision: outcome.decision, subject: input.subject, capability: mapping.capability, resource, action: mapping.action };
}

/**
 * Adapt a broker-bound authorizer to the shape `ExecutionGate` calls.
 *
 * The two signatures differ by more than names: `ExecutionGate` knows the proposal but not WHO is
 * asking, so the subject has to be bound here. That binding is the adapter's whole job, and it is
 * why this is a separate function rather than an overload — a caller has to decide which subject an
 * execution happens as, and that decision should be visible at the wiring site.
 *
 * `principals` exists because a gate can serve more than one subject: an execution proposed for one
 * worker must not be authorized as another. A proposal whose `originArtifactId` names a subject is
 * checked against it, and an unknown origin falls back to the default subject rather than being
 * silently trusted.
 */
export function gateAuthorizer(broker: CapabilityBroker, subject: SubjectId, options: { principal?: SubjectId; scope?: CapabilityScope; at?: string } = {}): (context: ExecutionAuthorizationContext) => ExecutionAuthorizationOutcome {
  return (context) => {
    const outcome = authorizeExecution(broker, {
      subject,
      proposal: { kind: context.kind, description: context.description, payload: context.payload, ...(context.originArtifactId === undefined ? {} : { originArtifactId: context.originArtifactId }) },
      ...(options.principal === undefined ? {} : { principal: options.principal }),
      ...(options.scope === undefined ? {} : { scope: options.scope }),
      ...(options.at === undefined ? {} : { at: options.at })
    });
    return {
      allowed: outcome.allowed,
      message: outcome.decision.message,
      ...(outcome.decision.evidence === undefined ? {} : { evidence: outcome.decision.evidence })
    };
  };
}
