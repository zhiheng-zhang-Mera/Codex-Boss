import fs from "node:fs";
import path from "node:path";
import type { RfcCorrection } from "../../src/shared/correction";
import { isCorrectableField } from "../../src/shared/correction";

export interface CorrectionFile {
  schemaVersion: 1;
  corrections: RfcCorrection[];
}

/**
 * Durable human-correction log (plan §26 input). Fail-closed on corruption or
 * malformed entries; atomic tmp+rename writes. Corrections are append-only so
 * later diagnosis can replay the latest human amendment per RFC field.
 */
export class CorrectionStore {
  private corrections: RfcCorrection[];

  constructor(private readonly filePath: string) {
    this.corrections = this.read();
  }

  add(correction: RfcCorrection): RfcCorrection {
    this.validate(correction);
    this.corrections = [...this.corrections, correction];
    this.persist();
    return correction;
  }

  list(): RfcCorrection[] {
    return [...this.corrections];
  }

  /** Latest correction per field for the given cluster key. */
  latestFor(clusterKey: string): RfcCorrection[] {
    const byField = new Map<string, RfcCorrection>();
    for (const correction of this.corrections) {
      if (correction.clusterKey !== clusterKey) continue;
      const existing = byField.get(correction.field);
      if (!existing || correction.correctedAt >= existing.correctedAt) byField.set(correction.field, correction);
    }
    return [...byField.values()];
  }

  private validate(correction: RfcCorrection): void {
    if (!correction.id?.trim() || !correction.clusterKey?.trim()) throw new Error("Invalid correction: id and clusterKey required");
    if (!isCorrectableField(correction.field)) throw new Error(`Invalid correction field: ${String(correction.field)}`);
    if (!correction.correctedValue?.trim()) throw new Error("Invalid correction: correctedValue required");
    if (Number.isNaN(Date.parse(correction.correctedAt))) throw new Error("Invalid correction: correctedAt must be ISO");
  }

  private read(): RfcCorrection[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<CorrectionFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.corrections)) throw new Error("Invalid correction store");
      return parsed.corrections.filter((correction) => {
        try { this.validate(correction); return true; } catch { return false; }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error; // corrupt file fails closed
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, corrections: this.corrections }, null, 2), "utf8");
    try { fs.renameSync(temporary, this.filePath); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EXDEV", "EEXIST", "EPERM"].includes(code ?? "")) throw error;
      fs.copyFileSync(temporary, this.filePath);
      fs.unlinkSync(temporary);
    }
  }
}
