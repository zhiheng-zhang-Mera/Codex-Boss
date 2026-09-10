import path from "node:path";
import {
  ROOT_OPERATION_FLOOR,
  foldRootDecisions,
  strictestRootDecision,
  type RootClassification,
  type RootDecision,
  type RootDecisionReason,
  type RootDecisionRecord,
  type RootOperation,
  type RootRequestMode
} from "../../src/shared/root-authority/contracts";
import { decideRootOperation, type RootPolicy } from "../../src/shared/root-authority/root-policy";
import { isProtectedPath } from "../../src/shared/root-authority/protected-surface";
import { loadRootPolicy, isClaimedRootOwner, type LoadedRootPolicy, type RootPolicySource } from "./root-policy-loader";
import { ProtectedSurfaceGuard, type SurfaceAssessment, type SurfaceChange } from "./protected-surface-guard";
import { RootAuditLedger, RootAuditError } from "./root-audit-ledger";

/**
 * Root Authority (Update-Plan/Isolation-Finalization.md §5, §7, §16).
 *
 * The single host-side entry point that answers "may this autonomous action
 * happen?" and durably records the answer. It is an OUTER constraint on the
 * existing engineering chain, not a replacement for it:
 *
 *     Finding -> candidate scope -> RootAuthority.classify() -> ProposalRunner
 *             -> host verification -> independent review -> convergence
 *             -> PromotionController
 *
 * Composition is one-directional and total:
 *
 *     final = strictest( floor(operation), policy(operation), path(targets) )
 *
 * `mode` is passed in only so the ledger can attribute the request. It has no
 * effect on the outcome — a mode cannot buy an ALLOW (§4).
 *
 * Every decision — ALLOW included — is appended to the durable Root Audit
 * Ledger before it is returned. If the ledger cannot be written, `classify`
 * throws: an unrecorded permission is not a permission (FI-03).
 */

/** Operations whose target paths must be assessed against the surface. */
const PATH_ASSESSED_OPERATIONS: ReadonlySet<RootOperation> = new Set<RootOperation>([
  "candidate.workspace.write",
  "evidence.write",
  "protected.surface.mutate",
  "root.policy.mutate",
  "root.authority.mutate",
  "ci.gate.mutate",
  "credential.boundary.mutate",
  "promotion.gate.mutate",
  "stable.candidate.boundary.mutate",
  "emergency.control.mutate",
  "root.invariant.test.mutate",
  "owner.identity.mutate",
  "stable.worktree.write",
  "stable.runtime.write",
  "gate.self.rewrite"
]);

export class RootDeniedError extends Error {
  constructor(readonly classification: RootClassification) {
    super(`Root Authority denied ${classification.operation}: ${classification.reasons.map((reason) => reason.code).join(", ") || "no reason recorded"}`);
    this.name = "RootDeniedError";
  }
}

export class RootSurfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RootSurfaceError";
  }
}

export interface RootClassifyInput {
  operation: RootOperation;
  /** Attribution only; never affects the decision. */
  mode?: RootRequestMode;
  /** Destination / target paths for path-assessed operations. */
  targets?: readonly string[];
  /** Rename or delete sources, assessed in addition to `targets`. */
  sources?: readonly string[];
  /** Overrides the authority-level actor for this one decision. */
  actor?: string;
  /** Free-form detail appended to the ledger reason. Never secret material. */
  detail?: string;
}

export interface RootAuthorityOptions {
  /** Candidate / engineering workspace root. */
  root: string;
  /**
   * Durable ledger file. MUST live outside the candidate workspace — a Candidate
   * that can rewrite its own audit trail has no audit trail.
   */
  ledgerFile: string;
  /** Defaults to `<root>/.codex-boss/root/root-policy.json`. */
  policyFile?: string;
  /** Identity attributed to decisions when a call does not override it. */
  actor?: string;
  runId?: string;
  candidateSha?: string | null;
  caseInsensitive?: boolean;
  /** Test seam: use a fixture CODEOWNERS instead of the workspace one. */
  codeownersFile?: string;
  /** Test seam: pre-loaded policy, skipping the disk read. */
  loadedPolicy?: LoadedRootPolicy;
}

export class RootAuthority {
  readonly root: string;
  readonly ledger: RootAuditLedger;
  readonly guard: ProtectedSurfaceGuard;
  private readonly loaded: LoadedRootPolicy;
  private readonly actor: string;
  private readonly runId: string;
  private readonly candidateSha: string | null;

  constructor(options: RootAuthorityOptions) {
    this.root = path.resolve(options.root);
    this.ledger = new RootAuditLedger(options.ledgerFile);
    const relative = path.relative(this.root, this.ledger.path);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      throw new RootSurfaceError(`root audit ledger must live outside the candidate workspace (got ${this.ledger.path} inside ${this.root})`);
    }
    this.guard = new ProtectedSurfaceGuard({ root: this.root, caseInsensitive: options.caseInsensitive, codeownersFile: options.codeownersFile });
    this.loaded = options.loadedPolicy ?? loadRootPolicy(this.root, options.policyFile);
    this.actor = options.actor ?? "autonomous-worker";
    this.runId = options.runId ?? "unbound-run";
    this.candidateSha = options.candidateSha ?? null;
  }

  get policy(): RootPolicy {
    return this.loaded.policy;
  }

  get policySource(): RootPolicySource {
    return this.loaded.source;
  }

  get policyDegraded(): boolean {
    return this.loaded.degraded;
  }

  get policyError(): string | undefined {
    return this.loaded.error;
  }

  get rootOwner(): string {
    return this.loaded.policy.rootOwner;
  }

  /** §7.2 protection check for a bare path list (promotion-time change set). */
  assessChangeSet(changedFiles: readonly string[]): SurfaceAssessment {
    return this.guard.assessChangeSet(changedFiles, this.loaded.policy.additionalProtectedPaths ?? []);
  }

  /** §7.2 protection check with rename/delete semantics. */
  assessChanges(changes: readonly SurfaceChange[]): SurfaceAssessment {
    return this.guard.assessChanges(changes);
  }

  /**
   * Classifies one operation and records the decision. Throws when the ledger
   * cannot be written (FI-03) or when the operation is DENY.
   */
  classify(input: RootClassifyInput): RootClassification {
    const operationDecision = decideRootOperation(this.loaded.policy, input.operation);
    const reasons: RootDecisionReason[] = [
      { code: `floor:${input.operation}`, detail: `operation floor is ${operationFloorLabel(input.operation)}` },
      { code: `policy:${this.loaded.source}`, detail: this.loaded.degraded ? `policy degraded: ${this.loaded.error}` : `policy from ${this.loaded.file}` }
    ];

    let pathAssessment: SurfaceAssessment | undefined;
    const pathAssessed = PATH_ASSESSED_OPERATIONS.has(input.operation) && ((input.targets?.length ?? 0) > 0 || (input.sources?.length ?? 0) > 0);
    if (pathAssessed) {
      const changes: SurfaceChange[] = [
        ...(input.targets ?? []).map((target) => ({ path: target, kind: "write" as const })),
        ...(input.sources ?? []).map((source) => ({ path: source, kind: "delete" as const }))
      ];
      pathAssessment = this.guard.assessChanges(changes);
      reasons.push(...pathAssessment.reasons);
    }

    const decision = foldRootDecisions([operationDecision, pathAssessment?.decision ?? "ALLOW"]);
    if (input.detail) reasons.push({ code: "detail", detail: input.detail });

    const classification: RootClassification = {
      operation: input.operation,
      decision,
      reasons,
      protectedPaths: pathAssessment?.protected.map((hit) => hit.path) ?? []
    };

    this.record({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      actor: input.actor ?? this.actor,
      operation: input.operation,
      target: targetLabel(input.targets, input.sources),
      decision,
      reason: reasons.map((reason) => `${reason.code}: ${reason.detail}`).join(" | "),
      candidateSha: this.candidateSha
    });

    return classification;
  }

  /** `classify`, but a DENY becomes a thrown error instead of a return value. */
  enforce(input: RootClassifyInput): RootClassification {
    const classification = this.classify(input);
    if (classification.decision === "DENY") throw new RootDeniedError(classification);
    return classification;
  }

  /** Appends a record; a failed write propagates so the caller must stop (FI-03). */
  record(entry: RootDecisionRecord): void {
    this.ledger.append(entry);
  }

  /** Non-throwing read of the durable decision history. */
  history(): RootDecisionRecord[] {
    return this.ledger.entries();
  }

  // -- Named guards for the §4 DENY list. Each is a thin, self-documenting
  //    wrapper around `classify` so call sites read as intent, not as strings.

  /** RT-07: the autonomous path trying to grant itself Owner-equivalent bypass. */
  refuseSelfElevation(detail: string): RootClassification {
    return this.classify({ operation: "self.elevation", detail, actor: this.actor });
  }

  /** RT-08: the autonomous path trying to redefine who the Root Owner is. */
  refuseOwnerIdentityChange(detail: string, policyFile?: string): RootClassification {
    return this.classify({ operation: "owner.identity.mutate", detail, targets: policyFile ? [policyFile] : undefined, actor: this.actor });
  }

  /** §4 DENY: pushing straight to the protected base branch. */
  refuseDirectMainPush(detail: string): RootClassification {
    return this.classify({ operation: "main.direct.push", detail, actor: this.actor });
  }

  /** §9: using or scanning Owner credentials. */
  refuseOwnerCredentialAccess(detail: string): RootClassification {
    return this.classify({ operation: "owner.credential.use", detail, actor: this.actor });
  }

  /** §9.4: repository administration / ruleset mutation. */
  refuseRepositoryAdministration(detail: string): RootClassification {
    return this.classify({ operation: "repository.administration", detail, actor: this.actor });
  }

  /**
   * §4: a stale PASS may not promote a newer SHA. Recorded as its own operation
   * so the ledger distinguishes it from a generic gate failure.
   */
  refuseStaleShaPromotion(detail: string): RootClassification {
    return this.classify({ operation: "stale.sha.promotion", detail, actor: this.actor });
  }

  /**
   * §9.2 / §10: the execution profile has no shell channel. Any request for one
   * is recorded and denied rather than executed.
   */
  refuseArbitraryShell(detail: string): RootClassification {
    return this.classify({ operation: "shell.arbitrary", detail, actor: this.actor });
  }

  /**
   * §7.2: a path that resolves outside the Candidate root. Kept separate from
   * "protected" because containment failure is DENY, not REQUIRE_OWNER.
   */
  refuseWorkspaceEscape(detail: string, targets?: readonly string[]): RootClassification {
    return this.classify({ operation: "workspace.escape", detail, targets, actor: this.actor });
  }

  /** §4: granting the Root Owner claim to an actor that the policy does not name. */
  acceptOwnerClaim(claimedLogin: unknown, detail: string): boolean {
    const accepted = isClaimedRootOwner(this.loaded.policy, claimedLogin);
    const decision: RootDecision = accepted ? "REQUIRE_OWNER" : "DENY";
    this.record({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      actor: this.actor,
      operation: "owner.identity.claim",
      target: typeof claimedLogin === "string" ? claimedLogin : String(claimedLogin),
      decision,
      reason: accepted
        ? `claim matches the Root Owner named by policy; Owner approval still required (${detail})`
        : `claim does not match the Root Owner named by policy (${detail})`,
      candidateSha: this.candidateSha
    });
    return accepted;
  }
}

function operationFloorLabel(operation: RootOperation): string {
  // Read straight from the floor table so the ledger reason can never disagree
  // with the decision that was actually taken.
  return ROOT_OPERATION_FLOOR[operation];
}

function targetLabel(targets: readonly string[] | undefined, sources: readonly string[] | undefined): string {
  const parts = [...(targets ?? []), ...(sources ?? []).map((source) => `from:${source}`)];
  if (!parts.length) return "-";
  return parts.slice(0, 10).join(", ");
}

/**
 * Reports whether every Root-sensitive operation in `operations` is at least
 * REQUIRE_OWNER, i.e. whether the autonomous path is genuinely constrained.
 * Used by the acceptance evidence rather than by production control flow.
 */
export function autonomousCeiling(policy: RootPolicy, operations: readonly RootOperation[]): RootDecision {
  return foldRootDecisions(operations.map((operation) => decideRootOperation(policy, operation)));
}

/** True when a path would be treated as a Root Surface by the compiled manifest. */
export function protectedPathFor(path: string): boolean {
  return isProtectedPath(path);
}

export { strictestRootDecision, RootAuditError };
