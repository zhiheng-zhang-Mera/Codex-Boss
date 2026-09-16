/**
 * Durable storage for coordination records and the paired experiments over them (Phase 05, Task D).
 *
 * One file, one source of truth: the records a real run produced, and the pairs that group them into
 * the A/B experiments Gate 8 judges. Keeping both in one artifact matters because a pairing is only
 * meaningful alongside the records it names — a pair file pointing at records that have since changed
 * would be an experiment nobody can re-check.
 *
 * Lives on the Electron side rather than in `src/shared` because it touches the filesystem, and
 * `src/shared` is compiled for the RENDERER as well, where no Node types exist. A store in shared
 * would break the renderer build, which is what the typecheck caught when this file started there.
 */

import fs from "node:fs";
import path from "node:path";
import type { CoordinationRecord } from "../../src/shared/coordination-economics";

/** The on-disk shape. */
interface CoordinationArtifact {
  $comment: string;
  schemaVersion: 1;
  generatedAt: string;
  /**
   * Records produced by real runs. Only these can support a promotion decision, and each says which
   * measures it observed.
   */
  records: CoordinationRecord[];
  /** The paired experiments, naming their records by task id. */
  pairs: CoordinationPair[];
}

/**
 * One A/B experiment.
 *
 * The pair is the unit of comparability: `cohort` is what both arms share, and the guard re-checks it
 * rather than trusting this file, because a pairing written by hand is exactly the thing that must not
 * be believed on its own.
 */
interface CoordinationPair {
  pairId: string;
  /** The candidate stage whose place in the default pipeline is being judged. */
  candidateStage: string;
  /** A one-line statement of what was varied, for a reader. */
  describes: string;
  /** The shared identity both arms must carry: runtime, benchmark task, input, planned variable. */
  cohort: {
    runtime: string;
    benchmarkTaskId: string;
    inputIdentity: string;
    plannedVariable: string;
  };
  /** Task ids in the arm WITHOUT the candidate stage. */
  baselineTaskIds: string[];
  /** Task ids in the arm WITH it. */
  candidateTaskIds: string[];
  /** Where the run came from, so the provenance of a real experiment is traceable. */
  provenance: {
    executedAt: string;
    /** `real-provider` for an actual run; anything else cannot satisfy Gate 8. */
    kind: string;
    /** The command or entry point that produced the records. */
    entryPoint: string;
    notes?: string;
  };
}

const EMPTY: CoordinationArtifact = {
  $comment: "Phase 05 Task D coordination records. Produced by real runs and derived from the durable task ledger; every record declares which measures it actually observed, and no unobserved figure is estimated. Written by scripts/agent-coordination-economics.cjs.",
  schemaVersion: 1,
  generatedAt: "",
  records: [],
  pairs: []
};

export interface CoordinationStore {
  /** The artifact as it stands, or an empty one when the file does not exist. */
  load(): CoordinationArtifact;
  /** Add or replace records by task id. Returns how many were written and how many replaced. */
  putRecords(records: readonly CoordinationRecord[]): { added: number; replaced: number };
  /** Add or replace a pair by pair id. */
  putPair(pair: CoordinationPair): { added: boolean };
  /** Records for a pair's arm, refusing when an id the pair names has no record. */
  recordsFor(pair: CoordinationPair, arm: "baseline" | "candidate"): { records: CoordinationRecord[]; missing: string[] };
  /** Persist the artifact. */
  save(at: string): void;
  /** Where the artifact lives, for a report to cite. */
  readonly file: string;
}

/**
 * Resolve the artifact location.
 *
 * A repo root resolves to the standard artifact path, so every entry point that has a checkout can
 * name the artifact without repeating the layout; a path that already ends in `.json` is taken as the
 * file itself, which is what the tests and the fixture validation pass.
 */
function artifactFileUnder(rootOrFile: string): string {
  return rootOrFile.endsWith(".json")
    ? rootOrFile
    : path.join(rootOrFile, "artifacts", "platform-foundation", "agent-coordination-economics.json");
}

export function openCoordinationStore(rootOrFile: string): CoordinationStore {
  const file = artifactFileUnder(rootOrFile);
  function load(): CoordinationArtifact {
    if (!fs.existsSync(file)) return { ...EMPTY, records: [], pairs: [] };
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CoordinationArtifact>;
    return {
      $comment: raw.$comment ?? EMPTY.$comment,
      schemaVersion: 1,
      generatedAt: raw.generatedAt ?? "",
      records: Array.isArray(raw.records) ? raw.records : [],
      pairs: Array.isArray(raw.pairs) ? raw.pairs : []
    };
  }

  let current = load();

  return {
    file,
    load: () => current,
    putRecords(records) {
      let added = 0;
      let replaced = 0;
      for (const record of records) {
        const index = current.records.findIndex((existing) => existing.taskId === record.taskId);
        if (index >= 0) {
          // Replacing rather than appending: one task has one record, so a re-run of the same task
          // updates the evidence instead of doubling the sample.
          current.records[index] = record;
          replaced++;
        } else {
          current.records.push(record);
          added++;
        }
      }
      return { added, replaced };
    },
    putPair(pair) {
      const index = current.pairs.findIndex((existing) => existing.pairId === pair.pairId);
      if (index >= 0) {
        current.pairs[index] = pair;
        return { added: false };
      }
      current.pairs.push(pair);
      return { added: true };
    },
    recordsFor(pair, arm) {
      const ids = arm === "baseline" ? pair.baselineTaskIds : pair.candidateTaskIds;
      const records: CoordinationRecord[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const found = current.records.find((record) => record.taskId === id);
        if (found) records.push(found);
        else missing.push(id);
      }
      return { records, missing };
    },
    save(at) {
      current.generatedAt = at;
      current.records.sort((left, right) => (left.taskId < right.taskId ? -1 : 1));
      current.pairs.sort((left, right) => (left.pairId < right.pairId ? -1 : 1));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    }
  };
}
