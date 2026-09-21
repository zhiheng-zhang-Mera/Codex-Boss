/**
 * Self Cognition — the anatomy, derived from facts the repository already holds.
 *
 * `buildSelfModel` takes a `SelfFacts` bundle and produces the four things the module exists to
 * describe: what Boss is made of, what it can do, what depends on what, and where data moves. The
 * facts are read by the host module (`electron/self-cognition/facts.ts`) because reading a
 * checkout is not something `src/shared` may do; everything here is a pure function of its input.
 *
 * Two derivations are worth naming because they are the ones a hand-written document gets wrong:
 *
 *   - **`dependents` is inverse `dependencies`.** No component declares what depends on it, so the
 *     two can never disagree.
 *   - **A capability's consumers come from the dependency graph**, not from a second list: a
 *     capability consumes what it `requires` or `optional`-depends on, and provides what its
 *     manifest's `provides` names. A missing `provides` entry makes the provider `UNKNOWN` rather
 *     than empty, because "nobody provides this" and "the manifest does not say" are different.
 */

import {
  absent,
  available,
  type AuthorityClass,
  type Availability,
  type BossCapabilityDescriptor,
  type BossComponentDescriptor,
  type BossDataFlow,
  type BossSelfModel,
  type OwnerReviewDecision,
  type SelfGraph
} from "./contracts";

export const SELF_MODEL_SCHEMA_VERSION = 1;

/** One capability manifest, structurally, as the host parsed it. */
export interface SelfCapabilityFact {
  id: string;
  kind: string;
  provides: string[];
  requires: Array<{ ref: string; reason?: string }>;
  optional: Array<{ ref: string; reason?: string }>;
  state: Array<{ namespace: string; owner: string }>;
  modules: string[];
  bootModules: string[];
  surface: string[];
  critical: boolean;
}

/** What the authority classifier answered for one repository path. */
export interface SelfAuthorityFact {
  path: string;
  surface: AuthorityClass;
  ownerReview: OwnerReviewDecision;
  /** One line explaining the verdict, so a report can quote the classifier rather than this module. */
  detail: string;
}

export interface SelfFacts {
  capturedAt: string;
  repositoryRoot: string;
  capabilities: SelfCapabilityFact[];
  /** The ownership map: capability id to the paths it owns, directories or files. */
  ownership: { capabilities: Record<string, string[]>; exempt: Record<string, string> };
  /** The composition root's own module wiring, read from its source. */
  bootWiring: Array<{ file: string; factory: string; wired: boolean }>;
  /** Package scripts, so the repository's runnable entry points are part of the anatomy. */
  scripts: Array<{ name: string; command: string }>;
  authority: SelfAuthorityFact[];
  architectureBaseline?: { metrics: Record<string, number>; updatedAt: string; reason: string };
  /** A file the host could not read, with the reason. Never silently dropped. */
  unreadable: Array<{ path: string; reason: string }>;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** The authority verdict for a component, from the facts collected over its own paths. */
function authorityOfPaths(paths: readonly string[], facts: SelfFacts): { authority: AuthorityClass; ownerReview: OwnerReviewDecision; paths: string[] } {
  const byPath = new Map(facts.authority.map((entry) => [entry.path, entry]));
  const known = paths.filter((path) => byPath.has(path));
  if (known.length === 0) {
    return { authority: "UNKNOWN", ownerReview: "UNKNOWN", paths: [] };
  }
  const surfaces = sorted(known.map((path) => byPath.get(path)?.surface ?? "UNKNOWN"));
  const decisions = sorted(known.map((path) => byPath.get(path)?.ownerReview ?? "UNKNOWN"));
  // The strictest verdict wins: a component with one Root Trust path is a Root Trust component,
  // however many product paths it also owns.
  const authority: AuthorityClass = surfaces.includes("ROOT_TRUST_SURFACE")
    ? "ROOT_TRUST_SURFACE"
    : surfaces.includes("EVOLUTION_ENGINE")
      ? "EVOLUTION_ENGINE"
      : surfaces.includes("UNKNOWN")
        ? "UNKNOWN"
        : surfaces.includes("VERIFICATION_SURFACE")
          ? "VERIFICATION_SURFACE"
          : "PRODUCT_SURFACE";
  const ownerReview: OwnerReviewDecision = decisions.includes("DENY") ? "DENY" : decisions.includes("REQUIRE_OWNER") ? "REQUIRE_OWNER" : decisions.includes("ALLOW") ? "ALLOW" : "UNKNOWN";
  return { authority, ownerReview, paths: sorted(known) };
}

/** Every path a capability's ownership entry covers, expanded from directories to files. */
function ownedPaths(capabilityId: string, facts: SelfFacts, allPaths: readonly string[]): string[] {
  const entries = facts.ownership.capabilities[capabilityId] ?? [];
  const matched = allPaths.filter((path) => entries.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry || path.startsWith(`${entry}/`))));
  // A bare directory entry covers everything under it; a file entry covers itself.
  return sorted(matched);
}

/** The capability whose ownership entry covers a path, when exactly one does. */
function ownerCapabilityOf(path: string, facts: SelfFacts): string | undefined {
  for (const [capabilityId, entries] of Object.entries(facts.ownership.capabilities)) {
    if (entries.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry || path.startsWith(`${entry}/`)))) return capabilityId;
  }
  return undefined;
}

/**
 * Builds the self model.
 *
 * Deterministic: the same facts produce the same model, sorted by id at every level, so two runs
 * can be compared byte for byte and a change in the model is a change in the repository.
 */
export function buildSelfModel(facts: SelfFacts): BossSelfModel {
  const notes: string[] = [];
  const allPaths = sorted([...facts.authority.map((entry) => entry.path), ...Object.values(facts.ownership.capabilities).flat()]);
  const baseline: Availability<{ metrics: Record<string, number>; updatedAt: string; reason: string }> = facts.architectureBaseline === undefined
    ? absent("NOT_MEASURED", "the repository holds no architecture baseline, so no density metric is available to describe", "config/architecture-baseline.json")
    : available(facts.architectureBaseline, "config/architecture-baseline.json");

  const providersOf = new Map<string, string[]>();
  for (const capability of facts.capabilities) {
    for (const provided of capability.provides) {
      providersOf.set(provided, sorted([...(providersOf.get(provided) ?? []), capability.id]));
    }
  }

  const capabilityDescriptors: BossCapabilityDescriptor[] = facts.capabilities.map((capability) => {
    const providedRefs = new Set(capability.provides);
    const providerComponents: Availability<string[]> = capability.provides.length === 0
      ? absent("UNKNOWN", "the manifest declares no provided contract, so nothing names this capability as a provider", `config/capabilities/${capability.id}.yaml`)
      : available(sorted([...capability.provides.flatMap((provided) => providersOf.get(provided) ?? [])]), `config/capabilities/${capability.id}.yaml provides`);
    const required = capability.requires.map((entry) => entry.ref);
    const optional = capability.optional.map((entry) => entry.ref);
    // Who consumes this capability: the capabilities whose own requirements name one of its
    // provided contracts. Derived from the same requirement lists, so the two directions cannot
    // disagree about the same edge.
    const consumerComponents: Availability<string[]> = available(
      sorted(
        facts.capabilities
          .filter((other) => other.id !== capability.id && [...other.requires, ...other.optional].some((ref) => providedRefs.has(ref.ref)))
          .map((other) => other.id)
      ),
      `config/capabilities/*.yaml requires naming ${capability.provides.join(", ") || "no contract"}`
    );
    const paths = ownedPaths(capability.id, facts, allPaths);
    const verdict = authorityOfPaths(paths, facts);
    return {
      capabilityId: capability.id,
      providedContracts: sorted(capability.provides),
      providerComponents,
      consumerComponents,
      requirements: sorted([...required, ...optional]),
      // A capability is available when every required dependency resolves to a provider, and its
      // answer is UNKNOWN rather than false when a required ref has no provider to find.
      available: (() => {
        const unresolved = required.filter((ref) => (providersOf.get(ref) ?? []).length === 0);
        if (capability.id === "") return absent<boolean>("NOT_MEASURED", "the manifest has no id, so its availability cannot be attributed", "config/capabilities");
        if (unresolved.length > 0) return absent<boolean>("UNKNOWN", `no manifest provides ${unresolved.join(", ")}, so availability cannot be established from the facts held`, `config/capabilities/${capability.id}.yaml requires`);
        return available(true, `every required contract of ${capability.id} has a provider`);
      })(),
      authority: verdict.authority,
      critical: capability.critical,
      ownedNamespaces: sorted(capability.state.map((claim) => claim.namespace))
    };
  });

  // Components: one per capability, one per boot module, one per owned module directory, one per
  // package script the repository declares.
  const components: BossComponentDescriptor[] = [];
  const dependenciesOf = new Map<string, string[]>();
  for (const capability of facts.capabilities) {
    // A declared requirement is a CONTRACT, and the dependency graph is over components: the refs
    // are resolved to whoever provides them. `inputs` keeps the refs, so a requirement with no
    // provider is still visible as an input rather than silently dropped from both lists.
    const refs = sorted([...capability.requires.map((entry) => entry.ref), ...capability.optional.map((entry) => entry.ref)]);
    dependenciesOf.set(capability.id, sorted(refs.flatMap((ref) => providersOf.get(ref) ?? [])));
  }
  const dependentsOf = new Map<string, string[]>();
  for (const [capabilityId, providerIds] of dependenciesOf) {
    // The inverse of the RESOLVED dependency list, so `dependencies` and `dependents` are one
    // relation read in two directions rather than two lists that can drift apart.
    for (const provider of providerIds) {
      dependentsOf.set(provider, sorted([...(dependentsOf.get(provider) ?? []), capabilityId]));
    }
  }

  for (const capability of facts.capabilities) {
    const paths = ownedPaths(capability.id, facts, allPaths);
    const verdict = authorityOfPaths(paths, facts);
    components.push({
      id: capability.id,
      name: capability.id,
      kind: "CAPABILITY",
      responsibility: capability.provides.length > 0 ? `provides ${capability.provides.join(", ")}` : "declares no provided contract",
      sourcePaths: paths,
      runtimeRegistration: capability.bootModules.length === 0
        ? absent("NOT_MEASURED", "the capability declares no boot module, so nothing wires it at startup", `config/capabilities/${capability.id}.yaml bootModules`)
        : available(capability.bootModules.join(", "), `config/capabilities/${capability.id}.yaml bootModules`),
      inputs: sorted([...capability.requires.map((entry) => entry.ref), ...capability.optional.map((entry) => entry.ref)]),
      outputs: sorted(capability.provides),
      dependencies: dependenciesOf.get(capability.id) ?? [],
      dependents: dependentsOf.get(capability.id) ?? [],
      ownedState: sorted(capability.state.map((claim) => claim.namespace)),
      capabilitiesProvided: sorted(capability.provides),
      healthSignals: capability.critical ? [`${capability.id}.critical`] : [],
      knownFailureModes: [],
      recoveryInterfaces: [],
      authority: verdict.authority,
      ownerReview: verdict.ownerReview,
      authorityPaths: verdict.paths
    });
  }

  for (const wiring of facts.bootWiring) {
    const owner = ownerCapabilityOf(wiring.file, facts);
    const verdict = authorityOfPaths([wiring.file], facts);
    components.push({
      id: `boot:${wiring.file}`,
      name: wiring.file.split("/").slice(-1)[0],
      kind: "BOOT_MODULE",
      responsibility: owner === undefined ? "declared as a boot module" : `declared as a boot module of ${owner}`,
      sourcePaths: [wiring.file],
      // Declared by a manifest and referenced by the composition root are two facts, and the
      // registration reports both: a declared module the root does not reference is NOT_MEASURED,
      // not wired.
      runtimeRegistration: wiring.wired
        ? available(`${wiring.file}${wiring.factory === "" ? "" : ` -> ${wiring.factory}`}`, "electron/main.ts references this module")
        : absent("NOT_MEASURED", `${wiring.file} is declared as a boot module but the composition root's source does not reference it, so this model cannot show it wired`, "electron/main.ts"),
      inputs: [],
      outputs: [],
      dependencies: owner === undefined ? [] : [owner],
      // Nothing declares a dependency on a composition-root factory, so it has no dependents: a
      // name that is not a component would only be a dead end in the dependency graph.
      dependents: [],
      ownedState: [],
      capabilitiesProvided: [],
      healthSignals: [],
      knownFailureModes: [],
      recoveryInterfaces: [],
      authority: verdict.authority,
      ownerReview: verdict.ownerReview,
      authorityPaths: verdict.paths
    });
  }

  // Every source file the ownership map covers is a component, whether the map names the file or
  // names the directory above it. Listing only the explicitly-named files would make the model
  // silently incomplete for most of the tree.
  for (const entry of sorted(facts.authority.map((fact) => fact.path).filter((file) => /\.tsx?$/.test(file)))) {
    const owner = ownerCapabilityOf(entry, facts);
    if (owner === undefined) continue;
    const verdict = authorityOfPaths([entry], facts);
    components.push({
      id: `module:${entry}`,
      name: entry,
      kind: "MODULE",
      responsibility: `owned by ${owner}`,
      sourcePaths: [entry],
      runtimeRegistration: absent("NOT_MEASURED", "a module file is imported by its consumers rather than registered at startup", "config/capability-modules.json"),
      inputs: [],
      outputs: [],
      // Ownership is not a declared dependency: the map says who owns the file, and a dependency
      // edge here would put every module file into the blast radius of its own capability.
      dependencies: [],
      dependents: [],
      ownedState: [],
      capabilitiesProvided: [],
      healthSignals: [],
      knownFailureModes: [],
      recoveryInterfaces: [],
      authority: verdict.authority,
      ownerReview: verdict.ownerReview,
      authorityPaths: verdict.paths
    });
  }

  for (const script of facts.scripts) {
    components.push({
      id: `script:${script.name}`,
      name: script.name,
      kind: "SCRIPT",
      responsibility: script.command,
      sourcePaths: [],
      runtimeRegistration: available(script.command, "package.json scripts"),
      inputs: [],
      outputs: [],
      dependencies: [],
      dependents: [],
      ownedState: [],
      capabilitiesProvided: [],
      healthSignals: [],
      knownFailureModes: [],
      recoveryInterfaces: [],
      authority: "UNKNOWN",
      ownerReview: "UNKNOWN",
      authorityPaths: []
    });
  }

  for (const entry of facts.unreadable) {
    notes.push(`${entry.path} could not be read: ${entry.reason}`);
    components.push({
      id: `unreadable:${entry.path}`,
      name: entry.path,
      kind: "CONFIGURATION",
      responsibility: "a fact this model could not read",
      sourcePaths: [entry.path],
      runtimeRegistration: absent("UNKNOWN", entry.reason, entry.path),
      inputs: [],
      outputs: [],
      dependencies: [],
      dependents: [],
      ownedState: [],
      capabilitiesProvided: [],
      healthSignals: [],
      knownFailureModes: [],
      recoveryInterfaces: [],
      authority: "UNKNOWN",
      ownerReview: "UNKNOWN",
      authorityPaths: []
    });
  }

  const dataFlows: BossDataFlow[] = capabilityDescriptors
    .flatMap((capability) => capability.ownedNamespaces.map((namespace) => ({
      id: `flow:${namespace}`,
      namespace,
      owner: capability.capabilityId,
      readers: sorted(dependentsOf.get(capability.capabilityId) ?? []),
      source: `config/capabilities/${capability.capabilityId}.yaml state`
    })))
    .sort((left, right) => (left.namespace < right.namespace ? -1 : left.namespace > right.namespace ? 1 : 0));

  if (components.length > 0 && facts.capabilities.length === 0) {
    notes.push("no capability manifest was read, so every component in this model came from ownership or wiring alone");
  }
  if (facts.unreadable.length === 0) notes.push("every fact source this model reads was read successfully");

  return {
    schemaVersion: SELF_MODEL_SCHEMA_VERSION,
    kind: "BOSS_SELF_MODEL",
    capturedAt: facts.capturedAt,
    repositoryRoot: facts.repositoryRoot,
    components: components.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    capabilities: capabilityDescriptors.sort((left, right) => (left.capabilityId < right.capabilityId ? -1 : 1)),
    dataFlows,
    unreadable: [...facts.unreadable].sort((left, right) => (left.path < right.path ? -1 : 1)),
    architectureBaseline: baseline,
    authority: { canDescribeSelf: true, canDiagnose: false, canMutateSelf: false },
    notes
  };
}

/* --------------------------------------------------------------- graphs */

/** Which components exist and what their kind is. */
export function componentGraph(model: BossSelfModel): SelfGraph {
  return {
    nodes: model.components.map((component) => component.id),
    edges: model.components.map((component) => ({ from: component.id, to: component.kind, kind: "IS_A", source: "component descriptor" }))
  };
}

/** Capabilities and the contracts that connect them, drawn from the requirement lists. */
export function capabilityGraph(model: BossSelfModel): SelfGraph {
  const edges: SelfGraph["edges"] = [];
  const providerOfRef = new Map<string, string[]>();
  for (const capability of model.capabilities) {
    for (const provided of capability.providedContracts) {
      providerOfRef.set(provided, sorted([...(providerOfRef.get(provided) ?? []), capability.capabilityId]));
    }
  }
  for (const capability of model.capabilities) {
    for (const requirement of capability.requirements) {
      edges.push({ from: capability.capabilityId, to: requirement, kind: "REQUIRES", source: "capability manifest" });
      // The provider edge is the same requirement read from the other side, and it is read off the
      // model's own `outputs`, so it cannot disagree with the REQUIRES edge above it.
      for (const provider of providerOfRef.get(requirement) ?? []) {
        if (provider === capability.capabilityId) continue;
        edges.push({ from: provider, to: capability.capabilityId, kind: "PROVIDES", source: "capability manifest provides, read from the consumer" });
      }
    }
  }
  return { nodes: sorted([...model.capabilities.map((capability) => capability.capabilityId), ...edges.map((edge) => edge.to)]), edges };
}

/** The dependency graph, one edge per resolved dependency, with the dependents derivable from it. */
export function dependencyGraph(model: BossSelfModel): SelfGraph {
  const edges: SelfGraph["edges"] = [];
  for (const component of model.components) {
    for (const dependency of component.dependencies) {
      edges.push({ from: component.id, to: dependency, kind: "DEPENDS_ON", source: "capability manifest requires/optional, resolved through provides" });
    }
  }
  return { nodes: model.components.map((component) => component.id), edges };
}

/** Where data lives and who names it as a dependency: the anatomy's physiology. */
export function dataFlowGraph(model: BossSelfModel): SelfGraph {
  const edges: SelfGraph["edges"] = model.dataFlows.flatMap((flow) => [
    { from: flow.owner, to: flow.namespace, kind: "OWNS_STATE", source: flow.source },
    ...flow.readers.map((reader) => ({ from: reader, to: flow.namespace, kind: "READS_STATE", source: flow.source }))
  ]);
  return { nodes: sorted([...model.dataFlows.map((flow) => flow.namespace), ...edges.map((edge) => edge.from)]), edges };
}
