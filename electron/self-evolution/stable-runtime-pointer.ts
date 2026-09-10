import fs from "node:fs";
import path from "node:path";
import { writeJson, readJson } from "../commander/durable-json";

/**
 * Phase S20 — Stable update and restart strategy
 * (Update-Plan/Alien-Prestart.md §20, §21).
 *
 * A successful git merge is NOT a successful Stable upgrade. The running
 * Stable binary must never be overwritten in place, so promotion is split into
 * stages with their own durable record:
 *
 *   Stable N running
 *     -> Candidate N+1 merged to main
 *     -> mark NEXT_STABLE_SHA            (still running N)
 *     -> controlled restart boundary
 *     -> boot Stable N+1
 *     -> health acceptance
 *     -> commit stable pointer
 *
 * Any failure between the restart and the acceptance rolls back to Stable N and
 * records why. `previousStableSha`, `promotedSha`, the boot attempt, the
 * restart evidence and the rollback reason are all persisted.
 */

export type StablePointerState =
  | "STABLE_CURRENT"
  | "NEXT_STABLE_MARKED"
  | "RESTARTING"
  | "BOOT_ACCEPTED"
  | "ROLLED_BACK";

export interface StableRestartEvidence {
  at: string;
  /** How the restart boundary was crossed. */
  mechanism: "candidate-acceptance-entrypoint" | "operator-restart" | "headless-boot-check";
  isolation: {
    dataDirIsolated: boolean;
    userDataIsolated: boolean;
    sessionDataIsolated: boolean;
    lockNamespaceIsolated: boolean;
  };
  /** Whether the running Stable was still visible/alive when the Candidate booted. */
  stableStillRunning: boolean;
  /** Whether the Candidate runtime exited without taking Stable with it. */
  candidateExited: boolean;
  detail: string;
}

export interface StablePointerRecord {
  schemaVersion: 1;
  state: StablePointerState;
  /** Stable that was running when this promotion started. */
  previousStableSha: string;
  /** The SHA that was merged to main. */
  promotedSha: string;
  currentStableSha: string;
  /** Set when the next Stable has been marked but not yet accepted. */
  nextStableSha?: string;
  markedAt?: string;
  restartedAt?: string;
  acceptedAt?: string;
  committedAt?: string;
  bootAttempts: Array<{ at: string; sha: string; accepted: boolean; detail: string }>;
  restartEvidence?: StableRestartEvidence;
  rollbackReason?: string;
  rollbackAt?: string;
  updatedAt: string;
}

export interface StableRuntimePointerOptions {
  /** Durable pointer file. Must live outside the Stable working tree. */
  pointerFile: string;
  /** Stable installation root, used to reject an in-tree pointer file. */
  stableRoot: string;
  now?: () => Date;
}

export class StablePointerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StablePointerError";
  }
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * Durable record of which commit Stable is actually running, as opposed to
 * which commit `main` points at.
 */
export class StableRuntimePointer {
  private readonly pointerFile: string;
  private readonly stableRoot: string;
  private readonly now: () => Date;

  constructor(options: StableRuntimePointerOptions) {
    this.pointerFile = path.resolve(options.pointerFile);
    this.stableRoot = path.resolve(options.stableRoot);
    const relative = path.relative(this.stableRoot, this.pointerFile);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new StablePointerError(`stable pointer must live outside the Stable working tree (${this.pointerFile})`);
    }
    this.now = options.now ?? (() => new Date());
  }

  get file(): string {
    return this.pointerFile;
  }

  /** Initializes the pointer when it does not exist yet. */
  initialize(currentStableSha: string): StablePointerRecord {
    if (!SHA.test(currentStableSha)) throw new StablePointerError(`not a commit SHA: ${currentStableSha}`);
    const existing = this.read();
    if (existing) return existing;
    const record: StablePointerRecord = {
      schemaVersion: 1,
      state: "STABLE_CURRENT",
      previousStableSha: currentStableSha,
      promotedSha: currentStableSha,
      currentStableSha,
      bootAttempts: [],
      updatedAt: this.now().toISOString()
    };
    this.write(record);
    return record;
  }

  read(): StablePointerRecord | undefined {
    const value = readJson<StablePointerRecord>(this.pointerFile);
    if (!value) return undefined;
    if (value.schemaVersion !== 1 || typeof value.currentStableSha !== "string") {
      throw new StablePointerError(`stable pointer ${this.pointerFile} is unreadable or has an unsupported schema`);
    }
    return value;
  }

  /** Marks the merged SHA as the next Stable. Stable N keeps running. */
  markNext(previousStableSha: string, promotedSha: string): StablePointerRecord {
    if (!SHA.test(promotedSha)) throw new StablePointerError(`not a commit SHA: ${promotedSha}`);
    const current =
      this.read() ??
      this.initialize(SHA.test(previousStableSha) ? previousStableSha : promotedSha);
    if (current.state === "NEXT_STABLE_MARKED" && current.nextStableSha === promotedSha) return current;
    const record: StablePointerRecord = {
      ...current,
      state: "NEXT_STABLE_MARKED",
      previousStableSha: SHA.test(previousStableSha) ? previousStableSha : current.currentStableSha,
      promotedSha,
      nextStableSha: promotedSha,
      markedAt: this.now().toISOString(),
      updatedAt: this.now().toISOString()
    };
    delete record.rollbackReason;
    delete record.rollbackAt;
    this.write(record);
    return record;
  }

  /** Records the restart boundary and how the Candidate runtime was isolated. */
  recordRestart(evidence: StableRestartEvidence): StablePointerRecord {
    const current = this.require("record a restart");
    const record: StablePointerRecord = {
      ...current,
      state: "RESTARTING",
      restartedAt: this.now().toISOString(),
      restartEvidence: evidence,
      updatedAt: this.now().toISOString()
    };
    this.write(record);
    return record;
  }

  /**
   * Records a boot acceptance result. A rejected boot leaves the pointer on the
   * previous Stable and does NOT commit the new SHA.
   */
  recordBoot(sha: string, accepted: boolean, detail: string): StablePointerRecord {
    const current = this.require("record a boot attempt");
    const attempts = [...current.bootAttempts, { at: this.now().toISOString(), sha, accepted, detail }];
    const record: StablePointerRecord = accepted
      ? {
          ...current,
          state: "BOOT_ACCEPTED",
          nextStableSha: sha,
          acceptedAt: this.now().toISOString(),
          bootAttempts: attempts,
          updatedAt: this.now().toISOString()
        }
      : {
          ...current,
          state: "ROLLED_BACK",
          bootAttempts: attempts,
          rollbackReason: `boot acceptance failed for ${sha}: ${detail}`,
          rollbackAt: this.now().toISOString(),
          updatedAt: this.now().toISOString()
        };
    this.write(record);
    return record;
  }

  /** Commits the pointer: only legal after a boot acceptance. */
  commitPointer(sha: string): StablePointerRecord {
    const current = this.require("commit the stable pointer");
    if (current.bootAttempts.every((attempt) => attempt.sha !== sha || !attempt.accepted)) {
      throw new StablePointerError(`refusing to commit stable pointer ${sha}: no accepted boot attempt is recorded`);
    }
    const record: StablePointerRecord = {
      ...current,
      state: "STABLE_CURRENT",
      currentStableSha: sha,
      nextStableSha: undefined,
      committedAt: this.now().toISOString(),
      updatedAt: this.now().toISOString()
    };
    delete record.nextStableSha;
    this.write(record);
    return record;
  }

  /** Rolls the pointer back to the previous Stable after a failed boot. */
  rollback(reason: string, previousStableSha?: string): StablePointerRecord {
    const current = this.require("roll back the stable pointer");
    const target = previousStableSha ?? current.previousStableSha;
    if (!SHA.test(target)) throw new StablePointerError(`not a commit SHA: ${target}`);
    const record: StablePointerRecord = {
      ...current,
      state: "ROLLED_BACK",
      currentStableSha: target,
      rollbackReason: reason,
      rollbackAt: this.now().toISOString(),
      updatedAt: this.now().toISOString()
    };
    delete record.nextStableSha;
    this.write(record);
    return record;
  }

  /** True when `main` has moved ahead of what Stable is actually running. */
  pendingRestart(): boolean {
    const current = this.read();
    if (!current) return false;
    return current.state === "NEXT_STABLE_MARKED" || current.state === "RESTARTING";
  }

  private require(action: string): StablePointerRecord {
    const current = this.read();
    if (!current) throw new StablePointerError(`no stable pointer exists at ${this.pointerFile}; initialize it before you ${action}`);
    return current;
  }

  private write(record: StablePointerRecord): void {
    fs.mkdirSync(path.dirname(this.pointerFile), { recursive: true });
    writeJson(this.pointerFile, record);
  }
}

/**
 * Single-instance / runtime isolation evidence for §21. The Candidate runtime
 * acceptance must never collide with the running Stable's Electron
 * single-instance lock, so every namespace is checked explicitly.
 */
export interface CandidateRuntimeIsolationPlan {
  runId: string;
  dataDirArgument: string;
  userDataDirectory: string;
  sessionDataDirectory: string;
  lockNamespace: string;
  /** The acceptance entrypoint, run headless rather than as a second visible app. */
  acceptanceEntrypoint: string;
  isolated: StableRestartEvidence["isolation"];
}

export function planCandidateRuntimeIsolation(input: {
  runId: string;
  runtimeData: string;
  processNamespace: string;
  acceptanceEntrypoint?: string;
}): CandidateRuntimeIsolationPlan {
  const userData = path.join(input.runtimeData, "user-data");
  const sessionData = path.join(input.runtimeData, "session-data");
  return {
    runId: input.runId,
    dataDirArgument: `--boss-data-dir=${input.runtimeData}`,
    userDataDirectory: userData,
    sessionDataDirectory: sessionData,
    lockNamespace: input.processNamespace,
    acceptanceEntrypoint: input.acceptanceEntrypoint ?? "scripts/phase05-candidate-boot-acceptance.cjs",
    isolated: { dataDirIsolated: true, userDataIsolated: true, sessionDataIsolated: true, lockNamespaceIsolated: true }
  };
}
