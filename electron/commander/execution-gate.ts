import { randomUUID } from "node:crypto";

type ExecutionKind = "shell" | "filesystem" | "git" | "network";
type ExecutionStatus = "PROPOSED" | "VALIDATED" | "APPROVAL_REQUIRED" | "APPROVED" | "EXECUTING" | "SUCCEEDED" | "FAILED";
export interface ExecutionProposal { id?: string; kind: ExecutionKind; description: string; payload: unknown; originArtifactId?: string; }
export interface ExecutionRecord extends ExecutionProposal { id: string; status: ExecutionStatus; error?: string; }

/**
 * The capability question, asked immediately before an execution runs.
 *
 * Structurally typed rather than imported from the capability layer, so this module keeps the
 * independence it has always had: the gate does not depend on the broker, and a caller that has not
 * wired one keeps today's behaviour exactly. That is what lets the migration be gradual — the book
 * requires a legacy route to be *marked*, not rewritten in one step.
 */
export interface ExecutionAuthorizationContext {
  kind: ExecutionKind;
  description: string;
  payload: unknown;
  originArtifactId?: string;
}

export interface ExecutionAuthorizationOutcome {
  allowed: boolean;
  /** Why, in the authorizer's own vocabulary. Required so a refusal is never bare. */
  message: string;
  /** The rule that decided it, for an audit trail. */
  evidence?: string;
}

/**
 * Refuses an execution the capability layer did not allow.
 *
 * Distinct from the gate's own status errors so a caller can tell "the approval flow refused this"
 * from "authorization refused this" — two different problems with two different remedies.
 */
export class ExecutionDeniedError extends Error {
  constructor(readonly context: ExecutionAuthorizationContext, readonly detail: string, readonly evidence?: string) {
    super(`Capability authorization denied the ${context.kind} execution: ${detail}${evidence ? ` [${evidence}]` : ""}`);
    this.name = "ExecutionDeniedError";
  }
}

/**
 * Options for the gate.
 *
 * Module-private: nothing imports the type by name, and a caller passing an options object gets it
 * checked structurally. Exported surface with no consumer is the dead weight the export-surface
 * guard exists to catch.
 */
interface ExecutionGateOptions {
  /**
   * The capability authorizer, when one is wired.
   *
   * Absent by default, and that is deliberate: not every call site can be mapped yet, and an
   * unmapped site must keep working rather than start failing. Which sites are mapped and which
   * are still on the legacy route is recorded in `boundary-inventory.ts` rather than left implicit.
   */
  authorizer?: (context: ExecutionAuthorizationContext) => ExecutionAuthorizationOutcome;
}

/** One authorization that ran, for the gate's own audit trail. */
interface ExecutionAuthorizationRecord {
  at: string;
  proposalId: string;
  kind: ExecutionKind;
  allowed: boolean;
  message: string;
  evidence?: string;
}

export class ExecutionGate {
  private readonly records = new Map<string, ExecutionRecord>();
  private readonly authorizations: ExecutionAuthorizationRecord[] = [];
  private readonly authorizer?: (context: ExecutionAuthorizationContext) => ExecutionAuthorizationOutcome;

  constructor(options: ExecutionGateOptions = {}) {
    this.authorizer = options.authorizer;
  }

  /** True when a capability authorizer is wired, so a caller can report which route it is on. */
  authorizationEnabled(): boolean {
    return typeof this.authorizer === "function";
  }

  /** Every authorization this gate has performed, oldest first. */
  authorizationHistory(): ExecutionAuthorizationRecord[] {
    return [...this.authorizations];
  }

  propose(input: ExecutionProposal): ExecutionRecord {
    const record: ExecutionRecord = { ...structuredClone(input), id: input.id ?? randomUUID(), status: "PROPOSED" };
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  validate(id: string): ExecutionRecord {
    const record = this.require(id);
    if (!record.description.trim() || record.payload === undefined) throw new Error("Invalid execution proposal");
    record.status = record.originArtifactId ? "APPROVAL_REQUIRED" : "VALIDATED";
    return structuredClone(record);
  }

  approve(id: string): ExecutionRecord { const record = this.require(id); if (!["VALIDATED", "APPROVAL_REQUIRED"].includes(record.status)) throw new Error(`Cannot approve ${record.status}`); record.status = "APPROVED"; return structuredClone(record); }

  async execute<T>(id: string, executor: (proposal: ExecutionRecord) => Promise<T>): Promise<T> {
    const record = this.require(id);
    if (record.status !== "APPROVED") throw new Error("Execution is not approved");

    /**
     * The capability decision, asked AFTER approval and BEFORE the executor runs.
     *
     * Approval answers "has a human or a policy accepted this proposal?" and authorization answers
     * "is this subject permitted to touch this resource?". Both have to be yes, so the check sits
     * between them rather than replacing either — a gate that skipped its approval flow because a
     * capability was granted would be a weakening, which the book forbids.
     */
    if (this.authorizer) {
      const context: ExecutionAuthorizationContext = {
        kind: record.kind,
        description: record.description,
        payload: record.payload,
        ...(record.originArtifactId === undefined ? {} : { originArtifactId: record.originArtifactId })
      };
      let outcome: ExecutionAuthorizationOutcome;
      try {
        outcome = this.authorizer(context);
      } catch (error) {
        // An authorizer that throws is a refusal, not a pass: failing open on an authorization
        // error is the one behaviour a security boundary must never have.
        const detail = `the authorizer threw: ${error instanceof Error ? error.message : String(error)}`;
        this.authorizations.push({ at: new Date().toISOString(), proposalId: record.id, kind: record.kind, allowed: false, message: detail });
        throw new ExecutionDeniedError(context, detail);
      }
      this.authorizations.push({
        at: new Date().toISOString(),
        proposalId: record.id,
        kind: record.kind,
        allowed: outcome.allowed,
        message: outcome.message,
        ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence })
      });
      if (!outcome.allowed) throw new ExecutionDeniedError(context, outcome.message, outcome.evidence);
    }

    record.status = "EXECUTING";
    try { const result = await executor(structuredClone(record)); record.status = "SUCCEEDED"; return result; }
    catch (error) { record.status = "FAILED"; record.error = String(error); throw error; }
  }

  get(id: string): ExecutionRecord | undefined { const value = this.records.get(id); return value && structuredClone(value); }
  private require(id: string): ExecutionRecord { const value = this.records.get(id); if (!value) throw new Error(`Unknown execution proposal: ${id}`); return value; }
}
