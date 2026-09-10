/**
 * Root Policy (Update-Plan/Isolation-Finalization.md §5, §7.1). Pure and
 * shareable: no fs, no electron, no DOM.
 *
 * The policy file (`.codex-boss/root/root-policy.json`) is repository-side Root
 * metadata. It holds POLICY ONLY. It must never hold a PAT, a private key, an
 * Owner session, an admin cookie, or anything usable for impersonation — and the
 * validator below rejects anything that even smells like secret material, so a
 * Candidate that "helpfully" commits a token into the policy file is refused
 * instead of trusted.
 *
 * Degrees of freedom, deliberately one-directional:
 *
 *   floor (contracts.ts)  ──►  policy file  ──►  path assessment
 *        ALLOW                                    DENY on escape
 *        REQUIRE_OWNER                            REQUIRE_OWNER on Root Surface
 *        DENY
 *
 * The final decision is the strictest of the three. A policy file can therefore
 * tighten the system and can never loosen it, and no run mode participates in
 * the composition at all.
 */

import {
  ROOT_OPERATION_FLOOR,
  foldRootDecisions,
  isRootDecision,
  strictestRootDecision,
  type RootDecision,
  type RootOperation
} from "./contracts";
import { scanSecrets } from "../secret-scan";

export const ROOT_POLICY_SCHEMA_VERSION = 1;

/** The seven policy knobs named by §7.1, plus an Owner-only additive list. */
export interface RootPolicy {
  schemaVersion: number;
  rootOwner: string;
  selfElevation: RootDecision;
  ownerCredentialAccess: RootDecision;
  directMainMutation: RootDecision;
  rulesetMutation: RootDecision;
  protectedSurfaceMutation: RootDecision;
  promotionGateMutation: RootDecision;
  emergencyControlMutation: RootDecision;
  /**
   * Additive only. Paths the Owner wants treated as Root Surface beyond
   * `.github/CODEOWNERS` and the compiled-in manifest. Never subtracts.
   */
  additionalProtectedPaths?: readonly string[];
}

/**
 * The policy used when `.codex-boss/root/root-policy.json` is missing or
 * unreadable. It is strictly the floor plus an explicit "no policy file" marker,
 * so absence of the file can never be read as Owner consent (§13 fail-closed).
 */
export const ROOT_POLICY_FALLBACK: RootPolicy = {
  schemaVersion: ROOT_POLICY_SCHEMA_VERSION,
  rootOwner: "unresolved",
  selfElevation: "DENY",
  ownerCredentialAccess: "DENY",
  directMainMutation: "DENY",
  rulesetMutation: "DENY",
  protectedSurfaceMutation: "REQUIRE_OWNER",
  promotionGateMutation: "REQUIRE_OWNER",
  emergencyControlMutation: "REQUIRE_OWNER"
};

/** The shipped repository-side policy (§7.1). */
export const DEFAULT_ROOT_POLICY: RootPolicy = {
  ...ROOT_POLICY_FALLBACK,
  rootOwner: "zhiheng-zhang-Mera"
};

/** Policy keys that are Root decisions; used for exhaustive mapping. */
export type RootPolicyDecisionKey =
  | "selfElevation"
  | "ownerCredentialAccess"
  | "directMainMutation"
  | "rulesetMutation"
  | "protectedSurfaceMutation"
  | "promotionGateMutation"
  | "emergencyControlMutation";

export const ROOT_POLICY_DECISION_KEYS: readonly RootPolicyDecisionKey[] = [
  "selfElevation",
  "ownerCredentialAccess",
  "directMainMutation",
  "rulesetMutation",
  "protectedSurfaceMutation",
  "promotionGateMutation",
  "emergencyControlMutation"
];

/** Which policy knob governs which operation. Total over ALLOW/REQUIRE groups. */
const OPERATION_POLICY_KEY: Readonly<Partial<Record<RootOperation, RootPolicyDecisionKey>>> = {
  "protected.surface.mutate": "protectedSurfaceMutation",
  "ci.gate.mutate": "protectedSurfaceMutation",
  "root.authority.mutate": "protectedSurfaceMutation",
  "root.policy.mutate": "protectedSurfaceMutation",
  "root.invariant.test.mutate": "protectedSurfaceMutation",
  "stable.candidate.boundary.mutate": "protectedSurfaceMutation",
  // The Credential Boundary *module* is a protected surface (§4 REQUIRE_OWNER
  // lists it explicitly). Using Owner credentials is a different operation and
  // is denied outright below.
  "credential.boundary.mutate": "protectedSurfaceMutation",
  "promotion.gate.mutate": "promotionGateMutation",
  // `promotion.execute` / `promotion.evaluate` are intentionally NOT mapped:
  // an ordinary Candidate with green gates may be promoted autonomously (§11.3).
  // The Root Surface check that turns a promotion into WAITING_FOR_ROOT_OWNER
  // lives in the PromotionController, keyed on the changed paths — not here.
  //
  // Changing *who the Root Owner is* from inside the autonomous path is a
  // self-elevation attempt (RT-08 ⇒ DENY). The legitimate way to change the
  // Owner is an Owner-authored edit to `.codex-boss/root/root-policy.json`,
  // which never travels through this classifier at all.
  "owner.identity.mutate": "selfElevation",
  "emergency.control.mutate": "emergencyControlMutation",
  "self.elevation": "selfElevation",
  "owner.credential.use": "ownerCredentialAccess",
  "owner.credential.scan": "ownerCredentialAccess",
  "repository.administration": "rulesetMutation",
  "main.direct.push": "directMainMutation",
  "git.force.push": "directMainMutation",
  "required.check.bypass": "promotionGateMutation",
  "ruleset.self.rewrite": "rulesetMutation",
  "main.protection.disable": "rulesetMutation",
  "emergency.stop.disable": "emergencyControlMutation",
  "stale.sha.promotion": "promotionGateMutation",
  "gate.self.rewrite": "promotionGateMutation"
};

const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export class RootPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RootPolicyError";
  }
}

/**
 * Validates an untrusted policy document. Fail-closed: any unknown
 * schemaVersion, any missing or malformed decision, any rootOwner that is not a
 * plausible single GitHub login, and any secret-shaped value is a hard error.
 * There is no lenient parse path, because a lenient parse is how a "policy"
 * quietly becomes a permission grant.
 */
export function parseRootPolicy(value: unknown): RootPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RootPolicyError("root policy must be a JSON object");
  const raw = value as Record<string, unknown>;

  if (raw.schemaVersion !== ROOT_POLICY_SCHEMA_VERSION) {
    throw new RootPolicyError(`root policy schemaVersion must be ${ROOT_POLICY_SCHEMA_VERSION} (fail-closed: unknown schema)`);
  }
  if (typeof raw.rootOwner !== "string" || !GITHUB_LOGIN.test(raw.rootOwner)) {
    throw new RootPolicyError("root policy rootOwner must be a single GitHub login");
  }
  for (const key of ROOT_POLICY_DECISION_KEYS) {
    if (!isRootDecision(raw[key])) throw new RootPolicyError(`root policy ${key} must be ALLOW, REQUIRE_OWNER or DENY`);
  }
  if (raw.additionalProtectedPaths !== undefined) {
    if (!Array.isArray(raw.additionalProtectedPaths) || raw.additionalProtectedPaths.some((item) => typeof item !== "string")) {
      throw new RootPolicyError("root policy additionalProtectedPaths must be an array of strings");
    }
  }

  const policy = raw as unknown as RootPolicy;

  // A policy file is not a secret store. Refuse to load one that carries
  // credential-shaped material instead of silently redacting it: an Owner token
  // in the repository is exactly the confusion this Phase exists to end.
  const serialized = JSON.stringify(policy);
  const secrets = scanSecrets(serialized);
  if (secrets.length) {
    throw new RootPolicyError(`root policy must not contain secret material (found ${secrets.map((item) => item.shape).join(", ")})`);
  }

  return policy;
}

/**
 * Serializes a policy for the repository. Round-trips through the validator so
 * a program can never write a policy it could not read back.
 */
export function serializeRootPolicy(policy: RootPolicy): string {
  const validated = parseRootPolicy(policy);
  return JSON.stringify(validated, null, 2) + "\n";
}

/**
 * The policy's decision for one operation, before the floor is applied.
 * Operations with no mapped knob (the ordinary ALLOW work) are ALLOW.
 */
export function policyDecisionFor(policy: RootPolicy, operation: RootOperation): RootDecision {
  const key = OPERATION_POLICY_KEY[operation];
  return key ? policy[key] : "ALLOW";
}

/**
 * The immutable outcome for one operation: `strictest(floor, policy)`.
 *
 * The floor is applied *after* the policy precisely so that a policy file — or a
 * future policy schema — can never promote a DENY operation to ALLOW. §4:
 * "OWNER_RESULT / AUTONOMOUS / 任何未来模式都不得把 DENY 转成 ALLOW."
 */
export function decideRootOperation(policy: RootPolicy, operation: RootOperation): RootDecision {
  return strictestRootDecision(ROOT_OPERATION_FLOOR[operation], policyDecisionFor(policy, operation));
}

/**
 * Reports whether a policy is a strict tightening or loosening of the floor.
 * Used by the acceptance tests and by the audit ledger: a policy that tries to
 * loosen the floor is recorded as ignored, not honoured.
 */
export function policyLoosensFloor(policy: RootPolicy): RootOperation[] {
  const loosened: RootOperation[] = [];
  for (const operation of Object.keys(ROOT_OPERATION_FLOOR) as RootOperation[]) {
    const policyDecision = policyDecisionFor(policy, operation);
    // Rank comparison without importing internals: DENY=2, REQUIRE_OWNER=1, ALLOW=0.
    const rank = (decision: RootDecision) => (decision === "DENY" ? 2 : decision === "REQUIRE_OWNER" ? 1 : 0);
    if (rank(policyDecision) < rank(ROOT_OPERATION_FLOOR[operation]) && OPERATION_POLICY_KEY[operation]) loosened.push(operation);
  }
  return loosened;
}

/** Convenience: the effective decision for many operations at once. */
export function decideRootOperations(policy: RootPolicy, operations: readonly RootOperation[]): RootDecision {
  return foldRootDecisions(operations.map((operation) => decideRootOperation(policy, operation)));
}
