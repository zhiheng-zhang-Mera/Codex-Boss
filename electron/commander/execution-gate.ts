import { randomUUID } from "node:crypto";

export type ExecutionKind = "shell" | "filesystem" | "git" | "network";
export type ExecutionStatus = "PROPOSED" | "VALIDATED" | "APPROVAL_REQUIRED" | "APPROVED" | "EXECUTING" | "SUCCEEDED" | "FAILED";
export interface ExecutionProposal { id?: string; kind: ExecutionKind; description: string; payload: unknown; originArtifactId?: string; }
export interface ExecutionRecord extends ExecutionProposal { id: string; status: ExecutionStatus; error?: string; }

export class ExecutionGate {
  private readonly records = new Map<string, ExecutionRecord>();
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
    record.status = "EXECUTING";
    try { const result = await executor(structuredClone(record)); record.status = "SUCCEEDED"; return result; }
    catch (error) { record.status = "FAILED"; record.error = String(error); throw error; }
  }
  get(id: string): ExecutionRecord | undefined { const value = this.records.get(id); return value && structuredClone(value); }
  private require(id: string): ExecutionRecord { const value = this.records.get(id); if (!value) throw new Error(`Unknown execution proposal: ${id}`); return value; }
}
