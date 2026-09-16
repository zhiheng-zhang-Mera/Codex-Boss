/**
 * Capability contract (platform foundation, Phase 01 Task A).
 *
 * The vocabulary every other Phase 01 module is written in: what a capability is,
 * how it names what it gives and what it needs, and what one manifest file is
 * allowed to say.
 *
 * This module is deliberately inert. It declares shapes and nothing else — no
 * registry, no resolution, no wiring. Phase 01's whole point is a machine-readable
 * constraint layer that does not take over the explicit factory wiring the
 * composition root already does, so nothing here may construct anything.
 *
 * It also never imports Electron or the filesystem: a manifest has to be loadable
 * by a plain Node unit test, which this file's own tests rely on.
 */

/** Stable identity of a capability, e.g. `research.autopilot`, `persistence`. */
export type CapabilityId = string;

/**
 * The exact version of a specific provided interface.
 *
 * A requirement names the interface AND its version (`artifact.store@1`), so the
 * dependency edge is to a contract rather than to an implementation. That is what
 * lets a provider be replaced without the dependents being re-read.
 */
export interface CapabilityVersion {
  /** The provided capability identity, e.g. `artifact.store`. */
  id: string;
  /** Positive integer interface generation. `@1` and `@2` are different contracts. */
  major: number;
}

/** A single `id@major` reference, as written in a manifest. */
export type CapabilityRef = string;

/**
 * A declared dependency on another capability's contract.
 *
 * `required` edges are the boot-blocking ones: a cycle among them is a hard error,
 * because no boot order exists for it. `optional` edges are refinements — the
 * dependent is expected to run with a reduced feature set when they are absent.
 */
export interface CapabilityRequirement {
  ref: CapabilityRef;
  capability: CapabilityVersion;
  kind: "required" | "optional";
  /**
   * Why the dependency exists, in the manifest author's words. Required rather
   * than decorative: an unexplained edge is the thing that makes a graph
   * unmaintainable at a few hundred capabilities.
   */
  reason: string;
}

/** A durable state namespace this capability claims to own authoritatively. */
interface CapabilityStateClaim {
  namespace: string;
  /**
   * The capability that authoritatively writes this namespace. Must equal the
   * manifest's own id — a manifest may only claim its own state, so ownership
   * cannot be transferred by a third party editing someone else's file.
   */
  owner: CapabilityId;
}

/**
 * Health semantics of the capability.
 *
 * `critical: true` means "Boss cannot do its job without this". Anything else is
 * required to degrade locally: the engineering book forbids turning a missing
 * optional capability into a global boot failure.
 */
interface CapabilityHealth {
  critical: boolean;
}

/**
 * Declared permission surface.
 *
 * Phase 01 carries this field so the schema does not have to change shape later,
 * and grants nothing: there is no evaluator, no enforcement and no consumer of
 * these entries anywhere in Phase 01. Phase 03 builds the `default deny`
 * authorisation that gives them meaning.
 */
export interface CapabilityPermissionClaim {
  capability: string;
  resource?: string;
  action?: string;
}

/** One parsed and validated manifest file. */
export interface CapabilityManifest {
  id: CapabilityId;
  /** Manifest version (the file's own revision), semantic versioning. */
  version: string;
  /**
   * `kernel` is composition/machinery the platform itself is made of.
   * `feature` is a capability that could be removed and degrade Boss rather than
   * break it. The distinction is what `critical` is cross-checked against.
   */
  kind: "kernel" | "feature";
  /** Interfaces this capability provides, as `id@major`. */
  provides: CapabilityRef[];
  /** Interfaces this capability needs; a cycle is fatal. */
  requires: CapabilityRequirement[];
  /** Interfaces that improve this capability but whose absence is survivable. */
  optional: CapabilityRequirement[];
  /** Durable state namespaces this capability owns. */
  state: CapabilityStateClaim[];
  health: CapabilityHealth;
  /**
   * Repo-relative POSIX paths of the source files this capability is made of.
   *
   * This is the capability's implementation surface. The architecture ratchet uses
   * it to answer "may these two files import each other", which is why it lives in
   * the manifest rather than in a separate hand-kept list that could drift.
   */
  modules: string[];
  /**
   * The `electron/bootstrap/*.ts` factories this capability's boot step is built
   * from — `kernel` composition modules for the platform itself, the feature's own
   * boot module otherwise.
   *
   * Declared separately from `modules` so the ratchet can assert a bijection between
   * the composition root's factory list and the manifest set. A boot module that no
   * manifest names is an unregistered capability, and the engineering book forbids
   * one entering the boot graph.
   */
  bootModules: string[];
  /**
   * Repo-relative POSIX paths of the modules this capability publishes for others
   * to import. Importing an implementation module that is not on the provider's
   * `surface` is the coupling the engineering book forbids.
   */
  surface: string[];
  /** Present for schema stability; grants nothing in Phase 01. */
  permissions: CapabilityPermissionClaim[];
  /** Where this manifest was read from, repo-relative POSIX path. */
  source: string;
}

/** What a capability is, at the level the graph and the ratchet care about. */
export interface CapabilitySummary {
  id: CapabilityId;
  version: string;
  kind: "kernel" | "feature";
  critical: boolean;
  provides: CapabilityRef[];
  requires: CapabilityRef[];
  optional: CapabilityRef[];
  state: string[];
  moduleCount: number;
  bootModuleCount: number;
}

/** A structural problem in one manifest, precise enough to fix without guessing. */
export interface ManifestProblem {
  source: string;
  /** Dotted path to the offending field, e.g. `requires[1].ref`. */
  path: string;
  message: string;
}

/**
 * Parse `id@major`.
 *
 * Rejects anything that is not exactly one capability id and one positive integer
 * generation: `@0`, `@-1`, `@1.2`, a missing `@` and an empty id are all errors,
 * because silently accepting them is how two spellings of one interface end up in
 * the graph as two unrelated nodes.
 */
export function parseCapabilityRef(raw: string): CapabilityVersion | undefined {
  if (typeof raw !== "string") return undefined;
  const match = /^([a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)@([1-9][0-9]*)$/.exec(raw.trim());
  if (!match) return undefined;
  return { id: match[1], major: Number(match[2]) };
}

/** Render a parsed reference back to its canonical `id@major` spelling. */
export function formatCapabilityRef(ref: CapabilityVersion): CapabilityRef {
  return `${ref.id}@${ref.major}`;
}

/**
 * Validate a capability id.
 *
 * Lowercase segments joined by `.`, `_` or `-`. Kept strict on purpose: the id is
 * the join key between manifests, state ownership and the ratchet, so a typo must
 * be a parse error rather than a second capability that quietly owns nothing.
 */
export function isValidCapabilityId(id: string): boolean {
  return typeof id === "string" && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id);
}

/**
 * Validate a durable state namespace.
 *
 * Same alphabet as a capability id, PLUS `:`, because the durable state core names its own
 * bookkeeping namespace `state-core:migration` with a capability-scoped prefix.
 *
 * The colon was added after this parser and `scripts/architecture.cjs` turned out to
 * disagree about it: the CLI accepted the namespace and counted it, while this parser
 * rejected the entire manifest — so the same repository was valid to the diagnostic and
 * invalid to the tests. Widening this side is correct rather than narrowing the CLI,
 * because a capability-scoped durable namespace is a legitimate shape.
 *
 * Still strict on the rest: the namespace is the key the ownership registry deduplicates
 * on, so `research.run` and `research-run` must not be able to look like two stores.
 */
export function isValidStateNamespace(namespace: string): boolean {
  return typeof namespace === "string" && /^[a-z0-9][a-z0-9._:-]*$/.test(namespace);
}

/**
 * Validate a semantic version.
 *
 * Exactly `major.minor.patch` with an optional pre-release/build suffix. The
 * subset is deliberate: `1.0` and `v1.0.0` are rejected so a manifest cannot
 * declare a version that the semver comparator below would then have to guess at.
 */
export function isValidSemver(version: string): boolean {
  return typeof version === "string"
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/.test(version);
}

/** The four requirement kinds the engineering book names, in report vocabulary. */
type CapabilityEdgeKind = "required" | "optional";
