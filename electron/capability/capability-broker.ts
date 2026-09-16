import { evaluate, validateGrants, type EvaluateOptions } from "./authorization";
import { validateGrant } from "./permission-contract";
import type {
  CapabilityGrant,
  CapabilityRequest,
  Decision,
  ResourceId,
  SubjectId
} from "./permission-contract";

/**
 * Capability broker (platform foundation, Phase 03 Task B).
 *
 * The single door between "a subject asks for a capability" and "the subject gets something it
 * can call". Two properties define it, and both are structural rather than promised:
 *
 *  - **It holds no business state.** The broker owns a grant set, a revocation set, an audit
 *    trail and a set of ADAPTER PROVIDERS. It does not hold a task, a conversation, a decision or
 *    a credential; anything with meaning lives in the domain that owns it. That is what keeps it
 *    from becoming the service locator Phase 01 forbade under a different name.
 *  - **An adapter is unreachable without a decision.** `authorize` is the only way to obtain a
 *    handle, and it returns one only for an `ALLOW`. There is no `getAdapter(name)` and no way to
 *    enumerate providers, so a caller cannot route around the check — the book's "adapters must
 *    not bypass the broker to reach a high-privilege credential" is enforced by there being
 *    nothing to bypass.
 *
 * ## Evidence
 *
 * Every decision and every invocation is appended to an in-memory audit trail, and the trail is
 * the source the Phase 03 artifact reports. Phase 02 gave authorization facts a durable home;
 * this module produces the facts, and a later task can persist them without changing the shape.
 *
 * ## What a plugin can reach
 *
 * A provider's capability names are not in the `plugin.*` namespace, and `authorize` refuses to
 * hand a plugin subject any capability that is not in the public plugin list. So a plugin granted
 * `ui.theme` cannot ask for `repository.write` even if a mis-authored grant would allow it: the
 * contract is checked before the grant.
 */

export interface CapabilityAdapter {
  invoke(request: { action: string; resource: ResourceId; input?: unknown }): unknown;
}

export interface AdapterProvider {
  capability: string;
  /** A one-line statement of what invoking this capability is able to do. */
  describes: string;
  /**
   * Whether a plugin subject may ever hold this capability.
   *
   * `false` for anything touching the filesystem, a shell, a credential or the network — the
   * book forbids a plugin default access to all four, and a UI/theme plugin must never reach
   * them at all.
   */
  pluginSafe: boolean;
  /** Build the adapter. Called once per process, and only after a decision says ALLOW. */
  create(): CapabilityAdapter;
}

export interface BrokerInvocation {
  at: string;
  subject: SubjectId;
  capability: string;
  resource: ResourceId;
  action: string;
  outcome: "ALLOW" | "DENY";
  detail: string;
}

export interface BrokerDecisionRecord {
  at: string;
  principal: SubjectId;
  decision: Decision;
}

export interface AuthorizeResult {
  allowed: boolean;
  decision: Decision;
  /** Present only for an `ALLOW`. */
  adapter?: CapabilityAdapter;
}

export interface CapabilityBroker {
  /** Current grants, for a report. A plain array, not a live handle. */
  grants(): CapabilityGrant[];
  /** Every decision this process has taken, oldest first. */
  decisions(): BrokerDecisionRecord[];
  /** Every invocation attempt, oldest first, including the refused ones. */
  invocations(): BrokerInvocation[];
  /** Add a grant. Validated, so a wildcard cannot enter through this door either. */
  grant(grant: CapabilityGrant): void;
  /**
   * Decide and, on an allow, hand back the adapter.
   *
   * `principal` is who is asking ON BEHALF OF the subject — the caller. It is recorded rather
   * than used to widen anything, so an audit can tell a plugin's own request from one a core
   * module made for it.
   */
  authorize(subject: SubjectId, request: Omit<CapabilityRequest, "subject">, principal: SubjectId, at: string): AuthorizeResult;
  /** Revoke a grant by id. Effective on the next `authorize`, not the next restart. */
  revoke(grantId: string): boolean;
  /** Replace the grant set, e.g. when a manifest is reloaded. Validation is applied. */
  setGrants(grants: readonly CapabilityGrant[]): void;
  /**
   * Append an invocation record.
   *
   * On the broker rather than in a helper because the broker is the single owner of its own
   * audit. `invokeThroughBroker` used to push onto `broker.invocations()`, which returns a COPY —
   * so the entry was silently discarded and the trail stayed empty.
   */
  recordInvocation(entry: BrokerInvocation): void;
}

export interface BrokerOptions {
  providers: readonly AdapterProvider[];
  grants?: readonly CapabilityGrant[];
  /** Capabilities a plugin subject may hold, whatever a provider says. */
  pluginCapabilityAllowlist?: readonly string[];
}

/**
 * The capabilities a plugin may hold by default: none that reach the machine.
 *
 * A caller can extend this, but the extension is an explicit act with a name attached rather
 * than a default, and every provider still has to declare itself `pluginSafe` as well.
 */
export const DEFAULT_PLUGIN_CAPABILITIES: readonly string[] = ["ui.theme"];

export class BrokerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokerConfigurationError";
  }
}

/** How many records each trail retains. */
export const BROKER_AUDIT_RETENTION = 1000;

export function createCapabilityBroker(options: BrokerOptions): CapabilityBroker {
  const providers = new Map<string, AdapterProvider>();
  for (const provider of options.providers) {
    if (providers.has(provider.capability)) throw new BrokerConfigurationError(`two adapter providers claim the capability ${provider.capability}`);
    if (!provider.describes || !provider.describes.trim()) {
      throw new BrokerConfigurationError(`the provider for ${provider.capability} does not say what it can do, which makes its grant unreviewable`);
    }
    providers.set(provider.capability, provider);
  }
  // Adapters are built lazily and ONCE, on the first allow, so a capability nobody is authorized
  // for never constructs anything — the broker does not pre-open doors.
  const adapters = new Map<string, CapabilityAdapter>();
  const pluginAllowlist = new Set(options.pluginCapabilityAllowlist ?? DEFAULT_PLUGIN_CAPABILITIES);

  let grants: CapabilityGrant[] = [];
  const revoked = new Set<string>();
  const decisionTrail: BrokerDecisionRecord[] = [];
  const invocationTrail: BrokerInvocation[] = [];

  function push<T>(trail: T[], entry: T): void {
    trail.push(entry);
    if (trail.length > BROKER_AUDIT_RETENTION) trail.splice(0, trail.length - BROKER_AUDIT_RETENTION);
  }

  function adapterFor(capability: string): CapabilityAdapter {
    const existing = adapters.get(capability);
    if (existing) return existing;
    const provider = providers.get(capability);
    if (!provider) throw new BrokerConfigurationError(`no adapter provider for ${capability}`);
    const adapter = provider.create();
    adapters.set(capability, adapter);
    return adapter;
  }

  const broker: CapabilityBroker = {
    grants: () => [...grants],
    decisions: () => [...decisionTrail],
    invocations: () => [...invocationTrail],

    grant(grant) {
      // Re-validated on the way in. `validateGrant` is exported for callers, and the broker
      // checks again so a caller that forgot cannot smuggle a wildcard past the only door.
      validateGrant(grant);
      if (grants.some((existing) => existing.id === grant.id)) throw new BrokerConfigurationError(`grant ${grant.id} already exists`);
      grants = [...grants, grant];
    },

    setGrants(next) {
      validateGrants(next);
      grants = [...next];
    },

    revoke(grantId) {
      if (!grants.some((grant) => grant.id === grantId)) return false;
      revoked.add(grantId);
      return true;
    },

    recordInvocation(entry) {
      push(invocationTrail, entry);
    },

    authorize(subject, request, principal, at) {
      const capability = request.capability;

      // 1. A plugin may only ever hold a capability the plugin contract publishes. Checked BEFORE
      //    the grant set, so an over-broad grant cannot hand a plugin the filesystem.
      const provider = providers.get(capability);
      if (provider === undefined) {
        const decision: Decision = {
          outcome: "DENY",
          subject,
          capability,
          resource: request.resource,
          action: request.action,
          reason: "capability-mismatch",
          message: `no capability named ${capability} is registered with the broker`,
          evidence: `providers:${[...providers.keys()].sort().join(",")}`,
          decidedAt: at
        };
        push(decisionTrail, { at, principal, decision });
        return { allowed: false, decision };
      }
      if (subject.startsWith("plugin.") && (!provider.pluginSafe || !pluginAllowlist.has(capability))) {
        const decision: Decision = {
          outcome: "DENY",
          subject,
          capability,
          resource: request.resource,
          action: request.action,
          reason: "capability-mismatch",
          message: provider.pluginSafe
            ? `capability ${capability} is not in the plugin allowlist, so a plugin subject may not hold it`
            : `capability ${capability} is not plugin-safe: it reaches beyond the plugin boundary`,
          evidence: `plugin-allowlist:${[...pluginAllowlist].sort().join(",")}`,
          decidedAt: at
        };
        push(decisionTrail, { at, principal, decision });
        return { allowed: false, decision };
      }

      // 2. The ordinary evaluation, with revocation folded in.
      const evaluateOptions: EvaluateOptions = { at, revokedGrantIds: revoked };
      const decision = evaluate(grants, { ...request, subject, capability }, evaluateOptions);
      push(decisionTrail, { at, principal, decision });
      if (decision.outcome !== "ALLOW") return { allowed: false, decision };
      return { allowed: true, decision, adapter: adapterFor(capability) };
    }
  };

  return broker;
}

/**
 * Invoke a capability through the broker.
 *
 * This is the shape every high-privilege operation is meant to take: ask, and only then act. It
 * records the attempt whether or not it was allowed, so a refusal is as visible as a success —
 * which is what the escape tests in Task E assert against.
 */
export function invokeThroughBroker(
  broker: CapabilityBroker,
  subject: SubjectId,
  request: Omit<CapabilityRequest, "subject">,
  principal: SubjectId,
  at: string,
  input?: unknown
): { allowed: boolean; decision: Decision; result?: unknown } {
  const outcome = broker.authorize(subject, request, principal, at);
  const record = (allowed: boolean, detail: string): void => {
    broker.recordInvocation({
      at,
      subject,
      capability: request.capability,
      resource: request.resource,
      action: request.action,
      outcome: allowed ? "ALLOW" : "DENY",
      detail
    });
  };

  if (!outcome.allowed || !outcome.adapter) {
    record(false, outcome.decision.message);
    return { allowed: false, decision: outcome.decision };
  }
  try {
    const result = outcome.adapter.invoke({ action: request.action, resource: request.resource, ...(input === undefined ? {} : { input }) });
    record(true, `invoked ${request.capability}:${request.action}`);
    return { allowed: true, decision: outcome.decision, result };
  } catch (error) {
    record(false, `the adapter threw: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
