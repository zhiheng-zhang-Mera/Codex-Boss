import {
  isValidCapabilityId,
  isValidStateNamespace,
  type CapabilityId,
  type CapabilityManifest
} from "./capability-contract";

/**
 * State ownership registry (platform foundation, Phase 01 Task C).
 *
 * The rule the engineering book states is narrow and absolute: **every durable
 * state namespace has exactly one authoritative owner**. Many readers are fine;
 * two writers are not, because two writers over one file is how a read-modify-write
 * pair silently loses the other's update.
 *
 * This registry is a CONSTRAINT AND DOCUMENTATION SOURCE ONLY. It does not move a
 * single write path, and it must not: Phase 01's absolute constraints reserve
 * persistence migration for Phase 02. What it does is make the current ownership
 * explicit and machine-checkable, so a later phase can migrate a store knowing who
 * owns it, and a new module cannot quietly start writing someone else's namespace.
 *
 * The declarations come from the manifests (`state: [{namespace, owner}]`), and the
 * manifest parser already refuses a claim whose `owner` is not the manifest's own
 * id. That makes "owner" unforgeable across files: a capability cannot be declared
 * the owner of a namespace by editing a different capability's manifest.
 */

/** Where a namespace's ownership is declared, for a reviewable diagnostic. */
interface StateOwnerDeclaration {
  namespace: string;
  owner: CapabilityId;
  /** The manifest file that declared it, repo-relative POSIX path. */
  source: string;
}

/** One namespace and its single authoritative owner. */
interface StateNamespaceRecord {
  namespace: string;
  /** The capability allowed to authoritatively write this namespace. */
  owner: CapabilityId;
  /** `owner`'s kind, so a reader can see whether a kernel module owns it. */
  ownerKind: "kernel" | "feature";
  /** Every manifest that declared this namespace. Length 1 for a healthy registry. */
  declaredBy: StateOwnerDeclaration[];
}

/** A namespace claimed by more than one capability — the failure this registry exists to catch. */
interface StateOwnershipConflict {
  namespace: string;
  owners: CapabilityId[];
  declarations: StateOwnerDeclaration[];
  message: string;
}

export interface StateOwnershipRegistry {
  namespaces: StateNamespaceRecord[];
  conflicts: StateOwnershipConflict[];
  /** Namespace -> owner, for O(1) lookup by a caller or a diagnostic. */
  ownerOf: Record<string, CapabilityId>;
  /** Capability -> the namespaces it owns, sorted. */
  ownedBy: Record<CapabilityId, string[]>;
  /**
   * Declarations the registry refused to record (malformed namespace, or an owner
   * that is not the declaring manifest). Normally empty — the parser rejects these
   * first — and non-empty only if a caller supplied hand-built manifests.
   */
  declarationProblems: string[];
}

/**
 * Build the registry from a manifest set.
 *
 * A namespace claimed twice is a CONFLICT rather than a last-writer-wins, and the
 * conflicting namespace is excluded from `ownerOf`: answering "who owns this?"
 * with a coin flip is worse than answering "nobody, it is contested", because the
 * former reads as a healthy registry.
 */
export function buildStateOwnershipRegistry(manifests: readonly CapabilityManifest[]): StateOwnershipRegistry {
  const byNamespace = new Map<string, StateOwnerDeclaration[]>();
  const kindOf = new Map<CapabilityId, "kernel" | "feature">();
  const problems: string[] = [];

  for (const manifest of [...manifests].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))) {
    kindOf.set(manifest.id, manifest.kind);
    for (const claim of manifest.state) {
      // Defended here as well as in the parser: a registry built from a
      // hand-constructed manifest array must not be able to record a malformed key.
      if (!isValidStateNamespace(claim.namespace)) {
        problems.push(`${manifest.source}: ${JSON.stringify(claim.namespace)} is not a valid state namespace`);
        continue;
      }
      if (!isValidCapabilityId(claim.owner) || claim.owner !== manifest.id) {
        problems.push(`${manifest.source}: state ${claim.namespace} claims owner ${claim.owner}, which is not the declaring capability ${manifest.id}`);
        continue;
      }
      const list = byNamespace.get(claim.namespace) ?? [];
      list.push({ namespace: claim.namespace, owner: claim.owner, source: manifest.source });
      byNamespace.set(claim.namespace, list);
    }
  }

  const namespaces: StateNamespaceRecord[] = [];
  const conflicts: StateOwnershipConflict[] = [];
  const ownerOf: Record<string, CapabilityId> = {};
  const ownedBy = new Map<CapabilityId, string[]>();

  for (const namespace of [...byNamespace.keys()].sort()) {
    const declarations = (byNamespace.get(namespace) ?? []).slice().sort((left, right) => (left.owner < right.owner ? -1 : left.owner > right.owner ? 1 : 0));
    const owners = [...new Set(declarations.map((entry) => entry.owner))].sort();
    if (owners.length > 1) {
      conflicts.push({
        namespace,
        owners,
        declarations,
        message: `durable state namespace "${namespace}" has ${owners.length} authoritative owners (${owners.join(", ")}); exactly one is allowed`
      });
      continue;
    }
    const owner = owners[0];
    ownerOf[namespace] = owner;
    const list = ownedBy.get(owner) ?? [];
    list.push(namespace);
    ownedBy.set(owner, list);
    namespaces.push({ namespace, owner, ownerKind: kindOf.get(owner) ?? "feature", declaredBy: declarations });
  }

  return {
    namespaces,
    conflicts,
    ownerOf,
    ownedBy: Object.fromEntries([...ownedBy.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1)).map(([owner, list]) => [owner, list.sort()])),
    declarationProblems: problems
  };
}

/**
 * The owner of a namespace, or `undefined` when it is unowned or contested.
 *
 * Callers must treat `undefined` as "do not write": an unowned namespace is a gap
 * in the inventory, and a contested one has no single writer by definition.
 */
export function authoritativeOwnerOf(registry: StateOwnershipRegistry, namespace: string): CapabilityId | undefined {
  return registry.ownerOf[namespace];
}

/** Namespaces declared by nothing, given a list of namespaces observed at runtime. */
export function unregisteredNamespaces(registry: StateOwnershipRegistry, observed: readonly string[]): string[] {
  return [...new Set(observed)].filter((namespace) => !registry.ownerOf[namespace]).sort();
}
