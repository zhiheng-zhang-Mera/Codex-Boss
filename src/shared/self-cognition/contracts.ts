/**
 * Self Cognition — the vocabulary Boss uses to describe itself.
 *
 * This module answers "what am I made of?" and nothing else. It does not decide whether anything
 * is wrong (that is self-diagnosis), it does not propose or perform a repair, and it does not keep
 * a history of past problems (that is the case record). `CAN_DESCRIBE_SELF = YES`,
 * `CAN_DIAGNOSE = NO`, `CAN_MUTATE_SELF = NO`, and the boundary is enforced by tests that read
 * this module's own surface rather than by this paragraph.
 *
 * Three rules shape the vocabulary:
 *
 *   1. **An answer is a fact with a source, or an absence with a reason.** `Availability<T>` has
 *      no bare value: every entry names where it came from, and an entry that could not be
 *      established says `UNKNOWN` or `NOT_MEASURED` and why. A missing manifest is therefore
 *      never reported as an absent component.
 *   2. **The anatomy is derived from the repository's own facts** — the capability manifests, the
 *      ownership map, the composition root's wiring, the architecture baseline and the real
 *      authority classifier — rather than transcribed into a list that would rot. Nothing here
 *      contains a hand-written count of modules.
 *   3. **Authority is classified, never asserted.** `authorityOf` runs the repository's own
 *      Root Trust classifier and owner-review guard; this module never decides for itself that a
 *      path is safe to change.
 */

/** The four trust tiers the repository's own classifier produces, plus the honest absence. */
export const AUTHORITY_CLASSES = ["ROOT_TRUST_SURFACE", "EVOLUTION_ENGINE", "VERIFICATION_SURFACE", "PRODUCT_SURFACE", "UNKNOWN"] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

/** What the owner-review guard answers for a component's paths. */
export const OWNER_REVIEW_DECISIONS = ["ALLOW", "REQUIRE_OWNER", "DENY", "UNKNOWN"] as const;
export type OwnerReviewDecision = (typeof OWNER_REVIEW_DECISIONS)[number];

/**
 * The availability vocabulary.
 *
 * `UNKNOWN` means the question was asked and the answer could not be established; `NOT_MEASURED`
 * means nothing observed it. Neither is allowed to mean "fine", and neither is allowed to mean
 * "does not exist".
 */
export const AVAILABILITY_STATUSES = ["AVAILABLE", "UNAVAILABLE", "UNKNOWN", "NOT_MEASURED"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export interface AvailabilityFact<T> {
  status: AvailabilityStatus;
  value?: T;
  /** Mandatory for every status except `AVAILABLE`. */
  reason?: string;
  /** Where the fact came from: a file, a manifest, a classifier. */
  source: string;
}

export type Availability<T> = AvailabilityFact<T>;

export function available<T>(value: T, source: string): Availability<T> {
  return { status: "AVAILABLE", value, source };
}

/** An absence that carries its reason. The reason is required, so silence is not an option. */
export function absent<T>(status: Exclude<AvailabilityStatus, "AVAILABLE">, reason: string, source: string): Availability<T> {
  return { status, reason, source };
}

/** The value when there is one, and `undefined` when there is not — never a substitute default. */
export function availabilityValue<T>(fact: Availability<T>): T | undefined {
  return fact.status === "AVAILABLE" ? fact.value : undefined;
}

/** A one-line reading of the fact, so a report never has to interpret a status word alone. */
export function describeAvailability(fact: Availability<unknown>): string {
  return fact.status === "AVAILABLE" ? `${String(fact.value)} (from ${fact.source})` : `${fact.status}: ${fact.reason ?? "no reason recorded"} (${fact.source})`;
}

/** What kind of thing a component is. Derived from where it appears in the repository's facts. */
export const COMPONENT_KINDS = ["CAPABILITY", "BOOT_MODULE", "MODULE", "SCRIPT", "CONFIGURATION"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/**
 * One thing Boss is made of.
 *
 * Every field is either derived from a repository fact or explicitly absent. `dependents` is
 * computed from other components' `dependencies` rather than declared, so it cannot disagree with
 * them.
 */
export interface BossComponentDescriptor {
  id: string;
  name: string;
  kind: ComponentKind;
  responsibility: string;
  /** Repository-relative paths, sorted. Never empty for a component derived from a fact. */
  sourcePaths: string[];
  /** The composition-root factory that wires it, when it is a boot module. */
  runtimeRegistration: Availability<string>;
  inputs: string[];
  outputs: string[];
  dependencies: string[];
  dependents: string[];
  /** Durable namespaces this component claims, if any. */
  ownedState: string[];
  capabilitiesProvided: string[];
  /** Health signals the component's own manifest declares. */
  healthSignals: string[];
  /**
   * Failure modes this component's manifest declares. Empty is a real answer here — the manifests
   * do not declare any — and it is distinguishable from an unreadable manifest, which removes the
   * component's facts entirely and is reported as `UNKNOWN`.
   */
  knownFailureModes: string[];
  /** Where a caller may ask this component to recover, when the repository names one. */
  recoveryInterfaces: string[];
  authority: AuthorityClass;
  ownerReview: OwnerReviewDecision;
  /** The paths the authority verdict was computed over, so the verdict is checkable. */
  authorityPaths: string[];
}

/** One capability, with who provides it and who consumes it. */
export interface BossCapabilityDescriptor {
  capabilityId: string;
  /** The contracts this capability's manifest declares it provides. */
  providedContracts: string[];
  providerComponents: Availability<string[]>;
  consumerComponents: Availability<string[]>;
  requirements: string[];
  available: AvailabilityFact<boolean>;
  authority: AuthorityClass;
  critical: boolean;
  ownedNamespaces: string[];
}

/** One movement of data the anatomy can name: a store written by one component and read by others. */
export interface BossDataFlow {
  id: string;
  namespace: string;
  owner: string;
  readers: string[];
  source: string;
}

export interface SelfGraph {
  nodes: string[];
  edges: Array<{ from: string; to: string; kind: string; source: string }>;
}

export interface BossSelfModel {
  schemaVersion: number;
  kind: "BOSS_SELF_MODEL";
  capturedAt: string;
  repositoryRoot: string;
  components: BossComponentDescriptor[];
  capabilities: BossCapabilityDescriptor[];
  dataFlows: BossDataFlow[];
  /** Facts the host could not read, kept as components instead of being dropped. */
  unreadable: Array<{ path: string; reason: string }>;
  /** The architecture baseline this model was built beside, when the repository has one. */
  architectureBaseline: Availability<{ metrics: Record<string, number>; updatedAt: string; reason: string }>;
  /** Literal capabilities, so a consumer cannot mistake this module for an actor. */
  authority: { canDescribeSelf: true; canDiagnose: false; canMutateSelf: false };
  notes: string[];
}
