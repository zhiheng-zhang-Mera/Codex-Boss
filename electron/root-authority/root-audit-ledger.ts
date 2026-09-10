import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { RootDecisionRecord } from "../../src/shared/root-authority/contracts";

/**
 * Root Audit Ledger (Update-Plan/Isolation-Finalization.md §5, §7.3, §15 FI-03).
 *
 * One durable, append-only JSONL record for every Root-sensitive decision —
 * ALLOW, REQUIRE_OWNER and DENY alike. The ledger is the reason a decision can
 * be audited later; therefore:
 *
 *   - it is append-only by construction (O_APPEND + fsync, never a rewrite);
 *   - each entry carries a sequence number and a hash chain (`prevHash`), so a
 *     rewritten or truncated history is detectable;
 *   - "delete the old records and keep running" is refused: a shrunken file, a
 *     vanished file or a broken chain raises `RootAuditError` and the caller is
 *     expected to stop the Root-sensitive operation (FI-03: never silently drop
 *     audit, never promote).
 *
 * The ledger must live OUTSIDE the Candidate workspace; `RootAuthority` enforces
 * that. A Candidate that can rewrite its own audit trail has no audit trail.
 */

export interface RootLedgerEntry extends RootDecisionRecord {
  /** Monotonic 1-based position in the ledger. */
  seq: number;
  /** Hash of the previous entry, or the empty-string sentinel for seq 1. */
  prevHash: string;
  /** Hash over this entry's payload including `prevHash`. */
  hash: string;
}

export const LEDGER_GENESIS_HASH = "";

export class RootAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RootAuditError";
  }
}

interface LedgerShape {
  exists: boolean;
  size: number;
  count: number;
  maxSeq: number;
  lastHash: string;
}

/**
 * Digest of one entry's payload with `hash` blanked. Building the hashed
 * representation *inside* the function (rather than at each call site) is what
 * keeps the writer and the reader byte-identical: both hash an object whose keys
 * are the payload's keys in insertion order followed by `hash: ""`.
 */
function hashEntry(payload: Omit<RootLedgerEntry, "hash">): string {
  return createHash("sha256").update(JSON.stringify({ ...payload, hash: "" })).digest("hex");
}

export class RootAuditLedger {
  private readonly file: string;
  /** Last observed shape, so truncation/deletion between appends is noticed. */
  private observed: LedgerShape | undefined;

  constructor(file: string) {
    if (typeof file !== "string" || !file.trim()) throw new RootAuditError("root audit ledger requires a file path");
    this.file = path.resolve(file);
  }

  get path(): string {
    return this.file;
  }

  /** Reads the ledger and verifies the chain. Throws on a broken chain. */
  entries(): RootLedgerEntry[] {
    if (!fs.existsSync(this.file)) return [];
    const raw = fs.readFileSync(this.file, "utf8");
    const entries: RootLedgerEntry[] = [];
    let previous = LEDGER_GENESIS_HASH;
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let entry: RootLedgerEntry;
      try {
        entry = JSON.parse(line) as RootLedgerEntry;
      } catch (error) {
        throw new RootAuditError(`root audit ledger line ${index + 1} is not valid JSON: ${String(error)}`);
      }
      if (entry.seq !== entries.length + 1) throw new RootAuditError(`root audit ledger sequence gap at line ${index + 1}: expected ${entries.length + 1}, found ${entry.seq}`);
      if (entry.prevHash !== previous) throw new RootAuditError(`root audit ledger chain broken at seq ${entry.seq}`);
      // Recompute over the same payload the writer hashed: the entry with its
      // `hash` field blanked. A tampered field changes the digest.
      const { hash: recorded, ...payload } = entry;
      const expected = hashEntry(payload);
      if (expected !== recorded) throw new RootAuditError(`root audit ledger entry ${entry.seq} was modified (hash mismatch)`);
      previous = entry.hash;
      entries.push(entry);
    }
    return entries;
  }

  count(): number {
    return this.entries().length;
  }

  private shape(): LedgerShape {
    if (!fs.existsSync(this.file)) return { exists: false, size: 0, count: 0, maxSeq: 0, lastHash: LEDGER_GENESIS_HASH };
    const size = fs.statSync(this.file).size;
    const entries = this.entries();
    const last = entries[entries.length - 1];
    return { exists: true, size, count: entries.length, maxSeq: last?.seq ?? 0, lastHash: last?.hash ?? LEDGER_GENESIS_HASH };
  }

  /**
   * Refuses to continue when history was removed. Called before every append so
   * a deletion between two decisions cannot go unnoticed.
   */
  private assertHistoryIntact(previous: LedgerShape | undefined, current: LedgerShape): void {
    if (!previous) return;
    if (previous.exists && !current.exists) {
      throw new RootAuditError("root audit ledger was deleted; refusing to continue Root-sensitive operation");
    }
    if (current.count < previous.count) {
      throw new RootAuditError(`root audit ledger lost ${previous.count - current.count} record(s); refusing to continue Root-sensitive operation`);
    }
    if (current.lastHash !== previous.lastHash && current.count <= previous.count) {
      throw new RootAuditError("root audit ledger history was rewritten; refusing to continue Root-sensitive operation");
    }
  }

  /**
   * Appends one decision. Throws `RootAuditError` on any failure — an unrecorded
   * ALLOW is as unacceptable as an unrecorded DENY, and a caller that cannot
   * write must abort rather than proceed unlogged.
   */
  append(record: RootDecisionRecord): RootLedgerEntry {
    const current = this.shape();
    this.assertHistoryIntact(this.observed, current);
    const entry: RootLedgerEntry = {
      ...record,
      seq: current.maxSeq + 1,
      prevHash: current.lastHash,
      hash: ""
    };
    entry.hash = hashEntry(entry);
    const line = JSON.stringify(entry) + "\n";
    let fd: number;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fd = fs.openSync(this.file, "a");
    } catch (error) {
      throw new RootAuditError(`root audit ledger is not writable at ${this.file}: ${String(error)}`);
    }
    try {
      fs.writeFileSync(fd, line, "utf8");
      fs.fsyncSync(fd);
    } catch (error) {
      throw new RootAuditError(`root audit ledger write failed: ${String(error)}`);
    } finally {
      fs.closeSync(fd);
    }
    this.observed = this.shape();
    return entry;
  }
}
