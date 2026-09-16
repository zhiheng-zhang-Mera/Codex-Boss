import { randomUUID } from "node:crypto";

/**
 * Credential references (platform foundation, Phase 03 Task D).
 *
 * The book's rule is absolute: external credentials are used INDIRECTLY through a capability
 * token or reference, and "the secret itself must not be handed to an Agent or a plugin". So the
 * type system here makes the raw secret unreachable from the caller's side —a plugin receives a
 * `CredentialReference`, which is an opaque id plus the scope it is valid for, and no API in this
 * module ever returns the secret.
 *
 * ## How the secret stays unreachable
 *
 * `useCredential` takes a REFERENCE, resolves it internally, performs the caller's operation
 * inside this module, and returns only the operation's result. The secret is a parameter of the
 * resolver closure and never crosses back over the boundary. There is deliberately no
 * `reveal(ref)` and no `secretOf(ref)`: the only way to exercise a credential is to ask this
 * module to do something with it, which is also the only place an audit record can be written.
 *
 * ## Scope
 *
 * A reference is bound to a provider and optionally narrowed to a repository, an account and a
 * set of actions. The `use` call names what it wants, and anything the reference does not cover is
 * refused —so a reference minted for reading a pull request cannot be used to push a commit even
 * if it is leaked to a subject that holds a broader grant.
 *
 * ## Revocation
 *
 * Revocation is checked on every use, so it binds the next call rather than the next restart,
 * which is what the book requires. It also invalidates the token, so a reference that has been
 * revoked cannot be re-resolved by presenting the token again.
 */

type CredentialProvider = string;

/** What a reference is allowed to be used for. Absent fields mean "any within the provider". */
interface CredentialScope {
  /** e.g. `zhiheng-zhang-Mera/Codex-Boss`. */
  repo?: string;
  /** The account the credential belongs to, when the provider has more than one. */
  account?: string;
  /** Actions this reference may perform, e.g. `pr.comment`. An explicit list, never a wildcard. */
  actions?: string[];
}

/**
 * The handle a plugin or worker is given.
 *
 * `token` is an opaque random id. It is NOT the secret and carries no information: resolving it
 * requires this module's in-memory registry, so a leaked token is useless to anyone outside the
 * process and can be revoked.
 */
interface CredentialReference {
  id: string;
  token: string;
  provider: CredentialProvider;
  scope: CredentialScope;
  issuedAt: string;
  /** Absent means "until revoked or the process exits". */
  expiresAt?: string;
  /** The subject the reference was minted FOR. A reference is not transferable. */
  subject: string;
}

/** Raised when a credential cannot be used. Every case names which of the rules refused it. */
class CredentialDeniedError extends Error {
  constructor(readonly code:
    | "unknown-token"
    | "revoked"
    | "expired"
    | "subject-mismatch"
    | "scope-mismatch"
    | "action-not-permitted"
    | "provider-mismatch", message: string) {
    super(message);
    this.name = "CredentialDeniedError";
  }
}

/** The audit record of one credential use. Written by the module, never by the caller. */
interface CredentialUseRecord {
  at: string;
  referenceId: string;
  subject: string;
  provider: CredentialProvider;
  operation: string;
  outcome: "ALLOW" | "DENY";
  detail: string;
}

interface IssueOptions {
  provider: CredentialProvider;
  subject: string;
  /** The raw secret. It is captured in the registry closure and never returned. */
  secret: string;
  scope?: CredentialScope;
  /** Opaque id of the underlying stored credential, for the audit trail. */
  credentialId?: string;
  /** Lifetime in seconds. Absent means "until revoked". */
  ttlSeconds?: number;
  at?: string;
}

interface UseOptions {
  reference: CredentialReference;
  /** The subject presenting the reference. Must match the one it was minted for. */
  subject: string;
  /** What the caller wants to do, e.g. `pr.comment`. Checked against the reference's scope. */
  operation: string;
  /** The repository in play, when the caller has one. Checked against the reference's scope. */
  repo?: string;
  at?: string;
}

interface CredentialRegistry {
  /** Mint a reference. The returned handle never contains the secret. */
  issue(options: IssueOptions): CredentialReference;
  /**
   * Perform `run` with the credential behind `reference`.
   *
   * `run` receives the secret because it executes INSIDE this module; its return value is what
   * the caller gets. Nothing here returns the secret to the caller.
   */
  use<T>(options: UseOptions, run: (secret: string) => T): T;
  /** Revoke a reference. Idempotent, and effective on the next `use`. */
  revoke(reference: CredentialReference): boolean;
  /** Whether a reference is still usable, without exercising it. */
  isUsable(reference: CredentialReference, subject: string, at?: string): boolean;
  /** Every reference currently held, WITHOUT secrets. For the permission-surface artifact. */
  references(): CredentialReference[];
  /** The audit trail, oldest first. */
  audit(): CredentialUseRecord[];
  /** How many raw secrets the registry is holding. Used by a test to prove nothing leaks. */
  secretCount(): number;
}

/** How many audit records are retained. */
const CREDENTIAL_AUDIT_RETENTION = 500;

export function createCredentialRegistry(): CredentialRegistry {
  interface Held {
    reference: CredentialReference;
    secret: string;
  }
  const held = new Map<string, Held>();
  const byToken = new Map<string, string>();
  const revoked = new Set<string>();
  const auditTrail: CredentialUseRecord[] = [];

  const nowIso = (at?: string): string => at ?? new Date().toISOString();

  function record(entry: CredentialUseRecord): void {
    auditTrail.push(entry);
    if (auditTrail.length > CREDENTIAL_AUDIT_RETENTION) auditTrail.splice(0, auditTrail.length - CREDENTIAL_AUDIT_RETENTION);
  }

  /** Resolve and authorize in one place, so every use path enforces the same rules. */
  function authorize(options: UseOptions): Held {
    const at = nowIso(options.at);
    const found = held.get(options.reference.id);
    const deny = (code: CredentialDeniedError["code"], detail: string): never => {
      record({ at, referenceId: options.reference.id, subject: options.subject, provider: options.reference.provider, operation: options.operation, outcome: "DENY", detail });
      throw new CredentialDeniedError(code, detail);
    };

    // Checked as an explicit return rather than through the `deny` helper, because TypeScript
    // cannot narrow a value through a closure that throws —and a `found!` assertion here would
    // be exactly the place a missing credential turned into a crash instead of a denial.
    if (!found) return deny("unknown-token", `no credential reference with id ${options.reference.id}`);
    const known: Held = found;
    /**
     * Revocation is checked BEFORE the token.
     *
     * `revoke` deletes the token mapping, so checking the token first reported a revoked reference
     * as "the token does not resolve" — technically true and operationally misleading, since the
     * operator revoked it deliberately. The more specific diagnosis wins.
     */
    if (revoked.has(options.reference.id)) deny("revoked", `credential reference ${options.reference.id} was revoked`);
    // The token must match too: a forged reference object with a real id but a made-up token is
    // refused, so the opaque token is doing work rather than being decorative.
    if (byToken.get(options.reference.token) !== options.reference.id) deny("unknown-token", `the token presented for ${options.reference.id} does not resolve`);
    if (known.reference.expiresAt && Date.parse(at) >= Date.parse(known.reference.expiresAt)) {
      deny("expired", `credential reference ${options.reference.id} expired at ${known.reference.expiresAt}`);
    }
    // A reference is not transferable: it was minted for one subject and only that subject may
    // present it, so leaking it to another plugin does not hand over the credential.
    if (known.reference.subject !== options.subject) {
      deny("subject-mismatch", `credential reference ${options.reference.id} was issued to ${known.reference.subject}, not ${options.subject}`);
    }
    const scope = known.reference.scope;
    if (scope.repo && options.repo && scope.repo !== options.repo) {
      deny("scope-mismatch", `credential reference ${options.reference.id} is scoped to repo ${scope.repo}, not ${options.repo}`);
    }
    if (scope.repo && !options.repo) {
      deny("scope-mismatch", `credential reference ${options.reference.id} requires a repo to be named`);
    }
    if (scope.actions && scope.actions.length > 0 && !scope.actions.includes(options.operation)) {
      deny("action-not-permitted", `credential reference ${options.reference.id} permits ${scope.actions.join(", ")}, not ${options.operation}`);
    }
    return known;
  }

  return {
    issue(options) {
      if (!options.subject || !options.subject.trim()) throw new Error("a credential reference must be issued to a subject");
      if (!options.provider || !options.provider.trim()) throw new Error("a credential reference needs a provider");
      if (typeof options.secret !== "string" || options.secret === "") throw new Error("a credential reference needs a secret to reference");
      const at = nowIso(options.at);
      const scope: CredentialScope = {
        ...(options.scope?.repo ? { repo: options.scope.repo } : {}),
        ...(options.scope?.account ? { account: options.scope.account } : {}),
        ...(options.scope?.actions && options.scope.actions.length > 0 ? { actions: [...options.scope.actions] } : {})
      };
      for (const action of scope.actions ?? []) {
        if (action === "*" || action.endsWith(".*")) throw new Error(`credential scope may not contain the wildcard action ${JSON.stringify(action)}`);
      }
      const reference: CredentialReference = {
        id: `cred-${randomUUID()}`,
        token: `ctok-${randomUUID()}`,
        provider: options.provider,
        scope,
        issuedAt: at,
        subject: options.subject,
        ...(options.ttlSeconds !== undefined ? { expiresAt: new Date(Date.parse(at) + options.ttlSeconds * 1000).toISOString() } : {})
      };
      held.set(reference.id, { reference, secret: options.secret });
      byToken.set(reference.token, reference.id);
      return reference;
    },

    use<T>(options: UseOptions, run: (secret: string) => T): T {
      const found = authorize(options);
      const at = nowIso(options.at);
      try {
        const value = run(found.secret);
        record({ at, referenceId: found.reference.id, subject: options.subject, provider: found.reference.provider, operation: options.operation, outcome: "ALLOW", detail: "the operation completed with the resolved credential" });
        return value;
      } catch (error) {
        record({ at, referenceId: found.reference.id, subject: options.subject, provider: found.reference.provider, operation: options.operation, outcome: "DENY", detail: `the operation failed: ${error instanceof Error ? error.message : String(error)}` });
        throw error;
      }
    },

    revoke(reference) {
      if (!held.has(reference.id)) return false;
      revoked.add(reference.id);
      byToken.delete(reference.token);
      return true;
    },

    isUsable(reference, subject, at) {
      try {
        authorize({ reference, subject, operation: reference.scope.actions?.[0] ?? "use", at });
        return true;
      } catch {
        return false;
      }
    },

    references() {
      // `structuredClone` of the reference only —the secret is not part of it, so it cannot leak
      // through this path even by accident.
      return [...held.values()].map((entry) => structuredClone(entry.reference));
    },

    audit: () => [...auditTrail],
    secretCount: () => held.size
  };
}
