import fs from "node:fs";
import path from "node:path";
import { writeJson } from "./durable-json";
import { appendToLedger, summarizeLedger, validateLedgerEntry, type DecisionLedgerEntry, type LedgerStats } from "../../src/shared/decision-ledger";

/**
 * Durable decision-ledger store (Owner-Result.md §38). Every automatic decision
 * under OWNER_RESULT is appended before it is acted on, so the owner can audit
 * later without ever pre-approving routine decisions. Atomic write, id-dedupe,
 * fail-closed restore (a corrupt ledger must never be silently dropped).
 */
export interface DecisionLedgerFile {
  schemaVersion: 1;
  entries: DecisionLedgerEntry[];
}

export class DecisionLedgerStore {
  private readonly entries = new Map<string, DecisionLedgerEntry>();

  constructor(private readonly filePath?: string) {
    this.restore();
  }

  /** Appends one decision entry and persists. Never mutates an existing id. */
  append(entry: DecisionLedgerEntry): DecisionLedgerEntry {
    const next = appendToLedger([...this.entries.values()], entry);
    this.entries.clear();
    for (const item of next) this.entries.set(item.id, item);
    this.persist();
    return structuredClone(entry);
  }

  /** Appends several entries in one atomic write. */
  appendAll(entries: readonly DecisionLedgerEntry[]): DecisionLedgerEntry[] {
    let current: DecisionLedgerEntry[] = [...this.entries.values()];
    for (const entry of entries) current = appendToLedger(current, entry);
    this.entries.clear();
    for (const item of current) this.entries.set(item.id, item);
    this.persist();
    return current.map((item) => structuredClone(item));
  }

  /** Entries for one task (or all), newest first. */
  list(taskId?: string): DecisionLedgerEntry[] {
    const items = [...this.entries.values()]
      .filter((entry) => !taskId || entry.taskId === taskId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items.map((item) => structuredClone(item));
  }

  stats(taskId?: string): LedgerStats {
    return summarizeLedger(this.list(taskId));
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<DecisionLedgerFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) throw new Error("Invalid decision-ledger store");
    for (const entry of parsed.entries) {
      validateLedgerEntry(entry);
      if (this.entries.has(entry.id)) throw new Error(`Duplicate decision-ledger entry: ${entry.id}`);
      this.entries.set(entry.id, entry);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: DecisionLedgerFile = { schemaVersion: 1, entries: [...this.entries.values()] };
    writeJson(this.filePath, file);
  }
}
