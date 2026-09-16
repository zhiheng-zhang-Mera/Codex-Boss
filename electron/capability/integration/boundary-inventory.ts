/**
 * High-privilege boundary inventory (platform foundation, Phase 03 Task B).
 *
 * The engineering book's rollback rule is specific about this: *"if a feature cannot adapt to the
 * broker yet, keep the legacy route and mark the debt explicitly, but do not pretend it
 * migrated."* This file is that marking.
 *
 * ## Why an inventory rather than silence
 *
 * "All high-privilege operations map to an explicit capability decision" is acceptance gate 2, and
 * it is the kind of claim that is easy to believe and hard to check. So every boundary this phase
 * found is listed with its route and a reason, and a test asserts three things about the list:
 * every entry names a module that exists, every `legacy` entry carries a reason, and nothing is
 * invented. A future change that maps one of these flips its entry here, in the same commit, which
 * is what makes the debt visible rather than forgotten.
 *
 * ## What "mapped" means here, precisely
 *
 * `mapped` means a capability decision is consulted on the path before the privileged action
 * happens. It does NOT mean the boundary was replaced: root authority still enforces its own
 * classification and the credential boundary still sanitizes environments. The capability layer is
 * an additional question asked before the action, not a substitute for the guard that already
 * exists — weakening either would be a security deviation, and the book says so.
 */

type BoundaryRoute = "mapped" | "legacy" | "out-of-scope";

interface BoundaryEntry {
  /** Repo-relative POSIX path of the module that holds the boundary. */
  module: string;
  /** What this boundary protects, in one line. */
  protects: string;
  route: BoundaryRoute;
  /** The capability that would authorize it, when one is defined. */
  capability?: string;
  /**
   * Why it is on the route it is on. Required for `legacy` and `out-of-scope`, because an
   * unexplained exemption is indistinguishable from an oversight.
   */
  reason: string;
}

/**
 * Every high-privilege boundary Phase 03 inventoried.
 *
 * Ordered by module path so a diff is readable. The two `mapped` entries are the ones this phase
 * actually wired; everything else is legacy or out of scope, with the reason stated.
 */
export const BOUNDARY_INVENTORY: readonly BoundaryEntry[] = [
  {
    module: "electron/commander/execution-gate.ts",
    protects: "executing a shell, filesystem, git or network proposal",
    route: "mapped",
    capability: "process.exec | project.files | github.write | network.fetch",
    reason: "the gate asks the capability authorizer after approval and before the executor runs, so an unauthorized execution is refused with the decision that refused it. Wiring is opt-in through `ExecutionGateOptions.authorizer`, which keeps a caller that has not adopted it on today's behaviour."
  },
  {
    module: "electron/capability/integration/execution-authorization.ts",
    protects: "the mapping from an execution kind to the capability, resource and constraints it requires",
    route: "mapped",
    capability: "(the mapping itself)",
    reason: "the table is the reviewable statement of what each execution kind can reach; a test asserts it is total over the gate's kinds, so a new kind cannot arrive without a mapping."
  },
  {
    module: "electron/root-authority/root-authority.ts",
    protects: "the owner's protected surface: self-elevation, owner identity, direct main pushes, owner credential access, repository administration, stale-SHA promotion, arbitrary shell, workspace escape",
    route: "legacy",
    capability: "root.authority",
    reason: "DELIBERATE. These refusals are a HUMAN boundary the book requires to be preserved, and routing them through a capability grant would let a grant become an owner approval — a weakening, not a migration. The capability layer records a decision alongside; it does not replace the owner gate."
  },
  {
    module: "electron/root-authority/protected-surface-guard.ts",
    protects: "reads and writes to protected files by classification",
    route: "legacy",
    capability: "root.protected-surface",
    reason: "DELIBERATE, for the same reason as root-authority: this is the owner gate's own mechanism, and Phase 03 must not soften it. Recorded here so the exemption is visible rather than assumed."
  },
  {
    module: "electron/credential-boundary/credential-boundary.ts",
    protects: "the ambient owner credential and the environment a child process receives",
    route: "legacy",
    capability: "credential.use",
    reason: "the boundary already refuses an ambient owner credential by comparing bytes, which is stronger than a grant check; replacing it with a capability decision would be a regression. The capability layer's opaque references are the forward path, and this module is what they must eventually replace — not bypass."
  },
  {
    module: "electron/security/secret-vault-store.ts",
    protects: "credential material at rest",
    route: "legacy",
    capability: "credential.use",
    reason: "ciphertext at rest with injected platform crypto. Phase 03 adds opaque references for USE; it does not re-implement storage, and the book forbids rewriting the credential path in this phase."
  },
  {
    module: "electron/security/permission-manifest.ts",
    protects: "the workspace and task permission manifests",
    route: "legacy",
    capability: "permission-manifest.read",
    reason: "the existing manifest vocabulary (`filesystem`/`repo`/`network`/`secret`/`side-effect`) still governs workspace and task scoping, and `src/shared/permission.ts` is unmodified by this phase. Migrating it would mean rewriting the runtime's scope model, which the book puts outside this phase."
  },
  {
    module: "electron/promotion-gate/promotion-controller.ts",
    protects: "pushing a candidate branch and opening a pull request",
    route: "legacy",
    capability: "github.write",
    reason: "the exact-SHA gate and the promotion controller own this path, and `github.write` is declared in the capability contract for it. The call site is not wired yet: it is reached through the self-evolution coordinator, which is the highest-risk path in the repository and must not be re-plumbed at the end of a phase."
  },
  {
    module: "electron/self-evolution/self-evolution-coordinator.ts",
    protects: "the autonomous mutation path: candidate promotion, evidence persistence, rollback",
    route: "legacy",
    capability: "github.write | project.files",
    reason: "the book's absolute constraint is that self-evolution must not be able to modify its own authorization facts and have them take effect immediately. Wiring this path needs its own design — an authorization decision that a mutating candidate cannot influence — and doing it as a side effect of a general integration would risk exactly the failure the constraint names."
  },
  {
    module: "electron/self-evolution/self-evolution-host.ts",
    protects: "git commits and evidence writes performed on behalf of a candidate",
    route: "legacy",
    capability: "github.write | project.files",
    reason: "same path and same constraint as the coordinator above."
  },
  {
    module: "electron/self-evolution/sandbox/windows-appcontainer-backend.ts",
    protects: "the containment boundary a candidate runs inside",
    route: "out-of-scope",
    reason: "this IS a process boundary, and the engineering book's own word for it is that the sandbox owns it: it may not delegate the child's creation. The capability layer decides whether a candidate may run; this decides what it may reach once it does. Two different questions."
  },
  {
    module: "electron/root-recovery/rollback-controller.ts",
    protects: "discarding commits and rolling back a candidate",
    route: "legacy",
    capability: "git.rollback",
    reason: "reached only through root-authorized recovery, so it inherits the owner gate above. No capability is declared for rollback yet, and inventing one in this phase would put a grant in front of the owner's discard path."
  }
];

/** The entries on the legacy route, which is what a migration report must count. */
export function legacyBoundaries(entries: readonly BoundaryEntry[] = BOUNDARY_INVENTORY): BoundaryEntry[] {
  return entries.filter((entry) => entry.route === "legacy");
}

/** The entries a capability decision already precedes. */
export function mappedBoundaries(entries: readonly BoundaryEntry[] = BOUNDARY_INVENTORY): BoundaryEntry[] {
  return entries.filter((entry) => entry.route === "mapped");
}

/** A one-line summary for a report header. */
export function describeBoundaryInventory(entries: readonly BoundaryEntry[] = BOUNDARY_INVENTORY): string {
  const mapped = mappedBoundaries(entries).length;
  const legacy = legacyBoundaries(entries).length;
  const outOfScope = entries.length - mapped - legacy;
  return `${entries.length} high-privilege boundaries inventoried: ${mapped} mapped to a capability decision, ${legacy} on the legacy route with a stated reason, ${outOfScope} out of scope`;
}
