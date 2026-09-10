import type { RootOperation } from "../../src/shared/root-authority/contracts";
import type { RootAuthority } from "../root-authority/root-authority";
import type { EvolutionRunContext } from "./mutation-context";

/**
 * Phase S19 —typed host operations (Update-Plan/Alien-Prestart.md §19).
 *
 * A Candidate never operates the computer. Self-Evolution is a *strict subset*
 * of the ordinary Work capability set, so anything that genuinely needs the
 * host —committing the Candidate, reading the real `git diff`, running host
 * verification, pushing a branch, opening a pull request, merging —is modelled
 * as a closed, typed request that the host decides to execute.
 *
 * Two properties matter and are asserted in the acceptance evidence:
 *
 *   * the request vocabulary is finite and enumerated, so there is no
 *     "run this arbitrary thing on the host" escape hatch;
 *   * every operation is classified by `RootAuthority` before it runs, so the
 *     durable ledger records the grant as well as the refusals.
 */

export type HostOperation =
  /** Commit the Candidate worktree; only the host may write Candidate history. */
  | { kind: "git.commitCandidate"; message: string }
  /** The authoritative change set for promotion: `git diff --name-status base...head`. */
  | { kind: "git.nameStatus"; baseSha: string; headSha: string }
  /** Read the Candidate HEAD. */
  | { kind: "git.candidateHead" }
  /** Push the Candidate branch with the dedicated Boss identity. */
  | { kind: "promote.pushBranch"; branch: string; sha: string }
  /** Open the pull request. */
  | { kind: "promote.openPullRequest"; head: string; title: string; body: string }
  /** Read the pull request head SHA. */
  | { kind: "promote.readPullRequest"; prNumber: number }
  /** Read the required `validate` check run for an exact SHA. */
  | { kind: "promote.readCheck"; sha: string }
  /** Merge the pull request at an exact SHA. */
  | { kind: "promote.merge"; prNumber: number; sha: string; title: string }
  /** Read the base branch SHA after a merge. */
  | { kind: "promote.readBranchSha"; branch: string }
  /** Persist evidence outside both trees. */
  | { kind: "evidence.persist"; name: string; payload: unknown }
  /** Record the promoted SHA as the next Stable, without restarting yet. */
  | { kind: "stable.markNext"; previousStableSha: string; promotedSha: string }
  /** Record a boot acceptance result for the next Stable. */
  | { kind: "stable.recordBoot"; sha: string; accepted: boolean; detail: string }
  /** Commit the stable pointer after a successful boot. */
  | { kind: "stable.commitPointer"; sha: string }
  /** Roll back to the previous Stable after a failed boot. */
  | { kind: "stable.rollback"; reason: string; previousStableSha: string };

/** The Root operation each host action is classified as. */
const OPERATION_FOR_KIND: Readonly<Record<HostOperation["kind"], RootOperation>> = {
  "git.commitCandidate": "candidate.workspace.write",
  "git.nameStatus": "candidate.git.inspect",
  "git.candidateHead": "candidate.git.inspect",
  "promote.pushBranch": "promotion.execute",
  "promote.openPullRequest": "promotion.execute",
  "promote.readPullRequest": "promotion.evaluate",
  "promote.readCheck": "promotion.evaluate",
  "promote.merge": "promotion.execute",
  "promote.readBranchSha": "promotion.evaluate",
  "evidence.persist": "evidence.write",
  "stable.markNext": "evidence.write",
  "stable.recordBoot": "evidence.write",
  "stable.commitPointer": "evidence.write",
  "stable.rollback": "candidate.rollback"
};

export function operationForHostAction(kind: HostOperation["kind"]): RootOperation {
  return OPERATION_FOR_KIND[kind];
}

/** Every kind, so an audit can prove the vocabulary is finite. */
export const HOST_OPERATION_KINDS: readonly HostOperation["kind"][] = Object.keys(OPERATION_FOR_KIND) as HostOperation["kind"][];

export interface HostOperationRecord {
  at: string;
  runId: string;
  kind: HostOperation["kind"];
  operation: RootOperation;
  decision: "ALLOW" | "REQUIRE_OWNER" | "DENY";
  detail: string;
}

/** Anything that reaches outside the Candidate must be provided by the host. */
export interface HostOperationHandlers {
  commitCandidate(input: { workspace: string; message: string }): Promise<string>;
  nameStatus(input: { workspace: string; baseSha: string; headSha: string }): Promise<ChangeEntry[]>;
  candidateHead(input: { workspace: string }): Promise<string>;
  pushBranch(input: { workspace: string; branch: string; sha: string }): Promise<HostOperationOutcome<{ branch: string; sha: string }>>;
  openPullRequest(input: { head: string; title: string; body: string }): Promise<HostOperationOutcome<{ number: number; headSha: string }>>;
  readPullRequest(input: { prNumber: number }): Promise<HostOperationOutcome<{ number: number; headSha: string; state: string }>>;
  readCheck(input: { sha: string }): Promise<HostOperationOutcome<{ name: string; conclusion: string | null; status: string | null }>>;
  mergePullRequest(input: { prNumber: number; sha: string; title: string }): Promise<HostOperationOutcome<{ merged: boolean; sha: string }>>;
  readBranchSha(input: { branch: string }): Promise<HostOperationOutcome<{ sha: string }>>;
  persistEvidence(input: { name: string; payload: unknown }): Promise<string>;
  markNextStable(input: { previousStableSha: string; promotedSha: string }): Promise<void>;
  recordBoot(input: { sha: string; accepted: boolean; detail: string }): Promise<void>;
  commitStablePointer(input: { sha: string }): Promise<void>;
  rollbackStable(input: { reason: string; previousStableSha: string }): Promise<{ ok: boolean; detail: string }>;
}

export type HostOperationOutcome<T> =
  | { status: "OK"; value: T }
  | { status: "BLOCKED_EXTERNAL"; reason: string; requiredExternalAction: string }
  | { status: "FAILED"; reason: string };

/** One entry of `git diff --name-status`. */
export interface ChangeEntry {
  status: "A" | "M" | "D" | "R" | "C" | "T" | "U" | "X" | "B";
  path: string;
  /** Present for renames and copies. */
  from?: string;
  /** Score for renames/copies, when git reports one. */
  score?: number;
}

/**
 * The only channel through which a Self-Evolution run can cause a host side
 * effect. Constructed by the coordinator with a real `EvolutionRunContext`, so
 * an unbound channel cannot be created by accident.
 */
export class EvolutionHostOperations {
  private readonly records: HostOperationRecord[] = [];

  constructor(
    private readonly context: EvolutionRunContext,
    private readonly authority: RootAuthority,
    private readonly handlers: HostOperationHandlers
  ) {}

  history(): HostOperationRecord[] {
    return [...this.records];
  }

  /** Classifies the request and records it; a DENY throws before any handler runs. */
  private authorize(operation: HostOperation, detail: string): void {
    const classification = this.authority.classify({
      operation: operationForHostAction(operation.kind),
      targets: operation.kind === "evidence.persist" ? [this.context.evidenceDirectory] : undefined,
      actor: `evolution-host:${this.context.runId}`,
      detail
    });
    this.records.push({
      at: new Date().toISOString(),
      runId: this.context.runId,
      kind: operation.kind,
      operation: classification.operation,
      decision: classification.decision,
      detail
    });
    if (classification.decision === "DENY") {
      throw new Error(`Root Authority denied host operation ${operation.kind}: ${classification.reasons.map((reason) => reason.code).join(", ")}`);
    }
  }

  async execute<T = unknown>(operation: HostOperation): Promise<T> {
    switch (operation.kind) {
      case "git.commitCandidate":
        this.authorize(operation, `commit Candidate ${this.context.candidateWorkspace}`);
        return (await this.handlers.commitCandidate({ workspace: this.context.candidateWorkspace, message: operation.message })) as T;
      case "git.nameStatus":
        this.authorize(operation, `read change set ${operation.baseSha.slice(0, 12)}...${operation.headSha.slice(0, 12)}`);
        return (await this.handlers.nameStatus({ workspace: this.context.candidateWorkspace, baseSha: operation.baseSha, headSha: operation.headSha })) as T;
      case "git.candidateHead":
        this.authorize(operation, "read Candidate HEAD");
        return (await this.handlers.candidateHead({ workspace: this.context.candidateWorkspace })) as T;
      case "promote.pushBranch":
        this.authorize(operation, `push Candidate branch ${operation.branch}`);
        return (await this.handlers.pushBranch({ workspace: this.context.candidateWorkspace, branch: operation.branch, sha: operation.sha })) as T;
      case "promote.openPullRequest":
        this.authorize(operation, `open pull request from ${operation.head}`);
        return (await this.handlers.openPullRequest({ head: operation.head, title: operation.title, body: operation.body })) as T;
      case "promote.readPullRequest":
        this.authorize(operation, `read pull request #${operation.prNumber}`);
        return (await this.handlers.readPullRequest({ prNumber: operation.prNumber })) as T;
      case "promote.readCheck":
        this.authorize(operation, `read required check for ${operation.sha.slice(0, 12)}`);
        return (await this.handlers.readCheck({ sha: operation.sha })) as T;
      case "promote.merge":
        this.authorize(operation, `merge pull request #${operation.prNumber} at exact SHA ${operation.sha.slice(0, 12)}`);
        return (await this.handlers.mergePullRequest({ prNumber: operation.prNumber, sha: operation.sha, title: operation.title })) as T;
      case "promote.readBranchSha":
        this.authorize(operation, `read branch ${operation.branch}`);
        return (await this.handlers.readBranchSha({ branch: operation.branch })) as T;
      case "evidence.persist":
        this.authorize(operation, `persist evidence ${operation.name}`);
        return (await this.handlers.persistEvidence({ name: operation.name, payload: operation.payload })) as T;
      case "stable.markNext":
        this.authorize(operation, `mark ${operation.promotedSha.slice(0, 12)} as next Stable`);
        await this.handlers.markNextStable({ previousStableSha: operation.previousStableSha, promotedSha: operation.promotedSha });
        return undefined as T;
      case "stable.recordBoot":
        this.authorize(operation, `record boot acceptance for ${operation.sha.slice(0, 12)}`);
        await this.handlers.recordBoot({ sha: operation.sha, accepted: operation.accepted, detail: operation.detail });
        return undefined as T;
      case "stable.commitPointer":
        this.authorize(operation, `commit stable pointer ${operation.sha.slice(0, 12)}`);
        await this.handlers.commitStablePointer({ sha: operation.sha });
        return undefined as T;
      case "stable.rollback":
        this.authorize(operation, `roll back Stable to ${operation.previousStableSha.slice(0, 12)}`);
        return (await this.handlers.rollbackStable({ reason: operation.reason, previousStableSha: operation.previousStableSha })) as T;
      default: {
        const exhaustive: never = operation;
        throw new Error(`unknown host operation: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
}

/**
 * Interprets `git diff --name-status <base>...<head>` output, including
 * case-only renames and type changes, into the change set the protected-surface
 * guard consumes.
 */
export function parseNameStatus(output: string): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const statusField = parts[0].trim();
    const status = (statusField[0] ?? "M").toUpperCase() as ChangeEntry["status"];
    if (status === "R" || status === "C") {
      const score = statusField.length > 1 ? Number.parseInt(statusField.slice(1), 10) : undefined;
      const from = parts[1];
      const to = parts[2];
      if (to) entries.push({ status, path: to, from, ...(Number.isFinite(score) ? { score } : {}) });
      continue;
    }
    const path = parts[1];
    if (path) entries.push({ status, path });
  }
  return entries;
}
