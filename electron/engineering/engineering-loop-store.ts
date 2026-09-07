import { readJson, writeJson } from "../commander/durable-json";
import {
  validateEngineeringGoalContract, summarizeEngineeringLoop,
  type EngineeringGoalContract, type EngineeringGoalSnapshot, type EngineeringIterationRecord
} from "../../src/shared/engineering-loop";

/**
 * Durable store for the autonomous engineering loop (plan §26–§41). One frozen
 * goal contract + its iteration ledger. Fail-closed: corrupt rows are rejected,
 * the newest revision is the source of truth, and no iteration row is ever
 * auto-deleted (plan §13 discipline applies to Boss-internal engineering state).
 */
export interface EngineeringLoopFile {
  schemaVersion: 1;
  goal?: EngineeringGoalContract;
  iterations: EngineeringIterationRecord[];
  acceptedRisks: string[];
  cleanRounds: number;
  updatedAt: string;
}

export class EngineeringLoopStore {
  private fileValue: EngineeringLoopFile;

  constructor(private readonly filePath: string) {
    this.fileValue = this.read();
  }

  get goal(): EngineeringGoalContract | undefined {
    return this.fileValue.goal ? structuredClone(this.fileValue.goal) : undefined;
  }

  get cleanRounds(): number {
    return this.fileValue.cleanRounds;
  }

  /** Freezes the goal contract (idempotent: same objective/workspace keeps the original id). */
  freezeGoal(goal: EngineeringGoalContract): EngineeringGoalContract {
    if (!validateEngineeringGoalContract(goal)) throw new Error("Invalid engineering goal contract");
    if (this.fileValue.goal && this.fileValue.goal.id !== goal.id) throw new Error("An engineering goal is already frozen; start a new one to replace it");
    this.fileValue.goal = structuredClone(goal);
    this.persist();
    return structuredClone(this.fileValue.goal);
  }

  /** Appends the next iteration record (a new AUDIT round). */
  beginIteration(): EngineeringIterationRecord {
    if (!this.fileValue.goal) throw new Error("No frozen engineering goal");
    const iteration = Math.max(0, ...this.fileValue.iterations.map((item) => item.iteration)) + 1;
    const now = new Date().toISOString();
    const record: EngineeringIterationRecord = {
      schemaVersion: 1, goalId: this.fileValue.goal.id, iteration, stage: "AUDIT",
      findings: [], changedFiles: [], reviewFindings: [], remainingRisk: "",
      status: "RUNNING", startedAt: now, updatedAt: now
    };
    this.fileValue.iterations.push(record);
    this.persist();
    return structuredClone(record);
  }

  updateIteration(iteration: number, mutate: (record: EngineeringIterationRecord) => void): EngineeringIterationRecord {
    const record = this.fileValue.iterations.find((item) => item.iteration === iteration);
    if (!record) throw new Error(`Unknown engineering iteration ${iteration}`);
    mutate(record);
    record.updatedAt = new Date().toISOString();
    this.persist();
    return structuredClone(record);
  }

  iterations(): EngineeringIterationRecord[] {
    return structuredClone(this.fileValue.iterations);
  }

  acceptRisk(findingId: string): void {
    if (!this.fileValue.acceptedRisks.includes(findingId)) this.fileValue.acceptedRisks.push(findingId);
    this.persist();
  }

  acceptedRisks(): string[] {
    return [...this.fileValue.acceptedRisks];
  }

  /** Records the number of consecutive clean audit rounds. */
  setCleanRounds(cleanRounds: number): void {
    this.fileValue.cleanRounds = Math.max(0, cleanRounds);
    this.persist();
  }

  /** Deterministic UI-facing snapshot of the frozen goal + its ledger. */
  status(): EngineeringGoalSnapshot {
    return summarizeEngineeringLoop({
      goal: this.fileValue.goal,
      iterations: this.fileValue.iterations,
      acceptedRisks: this.fileValue.acceptedRisks,
      cleanRounds: this.fileValue.cleanRounds
    });
  }

  private read(): EngineeringLoopFile {
    try {
      const parsed = readJson<Partial<EngineeringLoopFile>>(this.filePath);
      if (!parsed) return { schemaVersion: 1, iterations: [], acceptedRisks: [], cleanRounds: 0, updatedAt: new Date().toISOString() };
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.iterations)) throw new Error("Invalid engineering loop file");
      if (parsed.goal !== undefined && !validateEngineeringGoalContract(parsed.goal)) throw new Error("Invalid engineering goal contract in file");
      return {
        schemaVersion: 1,
        ...(parsed.goal ? { goal: parsed.goal } : {}),
        iterations: parsed.iterations.filter((item) => item && typeof item.iteration === "number"),
        acceptedRisks: Array.isArray(parsed.acceptedRisks) ? parsed.acceptedRisks : [],
        cleanRounds: typeof parsed.cleanRounds === "number" && Number.isInteger(parsed.cleanRounds) && parsed.cleanRounds >= 0 ? parsed.cleanRounds : 0,
        updatedAt: parsed.updatedAt ?? new Date().toISOString()
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, iterations: [], acceptedRisks: [], cleanRounds: 0, updatedAt: new Date().toISOString() };
      throw error;
    }
  }

  private persist(): void {
    writeJson(this.filePath, { ...this.fileValue, updatedAt: new Date().toISOString() });
  }
}
