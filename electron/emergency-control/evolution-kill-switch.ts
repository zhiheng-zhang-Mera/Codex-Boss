import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeJson, readJson } from "../commander/durable-json";

/**
 * Evolution kill switch / external fuse
 * (Update-Plan/Isolation-Finalization.md §13, §14 RT-20/RT-21, §23 RD-014/RD-015).
 *
 * The Owner needs an independent stop that the autonomous path cannot clear,
 * cannot delete, cannot restart around and cannot escape by starting a new run.
 * Two independent Owner-controlled inputs are read:
 *
 *   1. a durable control record (`evolution-control.json`), and
 *   2. an external sentinel/fuse file whose mere presence means "frozen".
 *
 * Read discipline, stated explicitly because "fail-closed" is meaningless
 * without it:
 *
 *   - record absent + sentinel absent  -> ENABLED. Freezing requires a positive
 *     Owner marker; absence is not evidence of a freeze.
 *   - record or sentinel says frozen    -> FROZEN_BY_OWNER.
 *   - record present but UNREADABLE/corrupt -> FROZEN_BY_OWNER. An unreadable
 *     Owner freeze must never be read as Owner consent.
 *   - sentinel present but UNREADABLE       -> FROZEN_BY_OWNER. Same reason.
 *
 * The state is re-read from disk on every check — there is no cache, so
 * restarting the process cannot restore a pre-freeze view (§13: "通过重启绕过
 * freeze" is forbidden). The freeze path must live outside every Candidate
 * workspace; the constructor enforces that, and clearing it requires an
 * Owner-controlled channel that the autonomous path cannot construct.
 */

export type EvolutionControlState = "ENABLED" | "FROZEN_BY_OWNER";

export interface EvolutionControlRecord {
  schemaVersion: 1;
  state: EvolutionControlState;
  /** ISO timestamp of the freeze. */
  frozenAt?: string;
  /** Root Owner login that froze evolution. */
  frozenBy?: string;
  reason?: string;
  /** Run id active when the freeze was raised, for evidence. */
  runId?: string;
  unfrozenAt?: string;
}

export const EVOLUTION_CONTROL_SCHEMA_VERSION = 1;

/**
 * The only thing that may clear a freeze. Constructed through
 * `createOwnerControlChannel` and registered in a module-private WeakSet, so an
 * object literal that merely *looks* like an Owner channel is rejected at
 * runtime — not just at compile time.
 */
export class OwnerControlChannel {
  constructor(readonly owner: string) {}
}

const AUTHORIZED_CHANNELS = new WeakSet<object>();

export function createOwnerControlChannel(owner: string): OwnerControlChannel {
  const channel = new OwnerControlChannel(owner);
  AUTHORIZED_CHANNELS.add(channel);
  return channel;
}

export function isAuthorizedOwnerChannel(value: unknown): boolean {
  return typeof value === "object" && value !== null && AUTHORIZED_CHANNELS.has(value as object);
}

export class EvolutionFrozenError extends Error {
  constructor(readonly reason: string) {
    super(`autonomous evolution is FROZEN_BY_OWNER: ${reason}`);
    this.name = "EvolutionFrozenError";
  }
}

export interface EvolutionKillSwitchOptions {
  /** Durable control record. Must be outside every candidate workspace. */
  controlFile: string;
  /** Optional external sentinel; presence means frozen. Same location rule. */
  sentinelFile?: string;
  /** Candidate workspace roots this fuse must not live inside. */
  candidateRoots?: readonly string[];
}

export interface EvolutionControlStatus {
  state: EvolutionControlState;
  /** Why the state was reached, as machine-readable codes. */
  signals: string[];
  record: EvolutionControlRecord;
  sentinelPresent: boolean;
  controlFile: string;
  sentinelFile?: string;
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class EvolutionKillSwitch {
  private readonly controlFile: string;
  private readonly sentinelFile: string | undefined;
  private readonly candidateRoots: readonly string[];

  constructor(options: EvolutionKillSwitchOptions) {
    this.controlFile = path.resolve(options.controlFile);
    this.sentinelFile = options.sentinelFile ? path.resolve(options.sentinelFile) : undefined;
    this.candidateRoots = (options.candidateRoots ?? []).map((root) => path.resolve(root));
    for (const root of this.candidateRoots) {
      if (isInside(root, this.controlFile)) throw new EvolutionFrozenError(`kill switch must live outside the candidate workspace (${this.controlFile} is inside ${root})`);
      if (this.sentinelFile && isInside(root, this.sentinelFile)) throw new EvolutionFrozenError(`evolution sentinel must live outside the candidate workspace (${this.sentinelFile} is inside ${root})`);
    }
  }

  get controlFilePath(): string {
    return this.controlFile;
  }

  get sentinelFilePath(): string | undefined {
    return this.sentinelFile;
  }

  /**
   * Reads the current state from disk. Never cached: a restart therefore cannot
   * present a stale ENABLED view (§13, RT-20/RT-21).
   */
  status(): EvolutionControlStatus {
    const signals: string[] = [];
    let record: EvolutionControlRecord = { schemaVersion: EVOLUTION_CONTROL_SCHEMA_VERSION, state: "ENABLED" };

    if (fs.existsSync(this.controlFile)) {
      try {
        const parsed = readJson<EvolutionControlRecord>(this.controlFile);
        if (!parsed || parsed.schemaVersion !== EVOLUTION_CONTROL_SCHEMA_VERSION || (parsed.state !== "ENABLED" && parsed.state !== "FROZEN_BY_OWNER")) {
          signals.push("control-record-invalid");
          record = { schemaVersion: EVOLUTION_CONTROL_SCHEMA_VERSION, state: "FROZEN_BY_OWNER", reason: "control record is invalid; refusing to read that as Owner consent" };
        } else {
          record = parsed;
          if (parsed.state === "FROZEN_BY_OWNER") signals.push("control-record-frozen");
        }
      } catch (error) {
        signals.push("control-record-unreadable");
        record = { schemaVersion: EVOLUTION_CONTROL_SCHEMA_VERSION, state: "FROZEN_BY_OWNER", reason: `control record unreadable: ${String(error)}` };
      }
    } else {
      signals.push("control-record-absent");
    }

    let sentinelPresent = false;
    if (this.sentinelFile && fs.existsSync(this.sentinelFile)) {
      sentinelPresent = true;
      signals.push("sentinel-present");
      // Presence IS the freeze. An external fuse the Owner can create with a
      // single file must not depend on the file's contents being parseable.
      record = { ...record, state: "FROZEN_BY_OWNER", reason: record.reason ?? "external evolution sentinel is present" };
      try {
        fs.accessSync(this.sentinelFile, fs.constants.R_OK);
      } catch {
        signals.push("sentinel-unreadable");
        record = { ...record, state: "FROZEN_BY_OWNER", reason: "sentinel exists but is unreadable; failing closed" };
      }
    }

    if (record.state === "FROZEN_BY_OWNER" && !signals.includes("control-record-frozen")) signals.push("fail-closed");
    const state: EvolutionControlState = record.state === "FROZEN_BY_OWNER" ? "FROZEN_BY_OWNER" : "ENABLED";
    return { state, signals, record: { ...record, state }, sentinelPresent, controlFile: this.controlFile, sentinelFile: this.sentinelFile };
  }

  isFrozen(): boolean {
    return this.status().state === "FROZEN_BY_OWNER";
  }

  /** Throws `EvolutionFrozenError` when evolution is frozen. */
  assertEvolutionEnabled(action: string): void {
    const status = this.status();
    if (status.state === "FROZEN_BY_OWNER") {
      throw new EvolutionFrozenError(`${action} refused: ${status.signals.join(", ")}${status.record.reason ? ` (${status.record.reason})` : ""}`);
    }
  }

  /**
   * Raises the freeze. Any actor may *raise* it — the Owner obviously, but also
   * an operator script or the harness. Only clearing it is Owner-gated, which is
   * the asymmetry that makes the stop safe.
   */
  freeze(input: { frozenBy: string; reason: string; runId?: string }): EvolutionControlStatus {
    writeJson(this.controlFile, {
      schemaVersion: EVOLUTION_CONTROL_SCHEMA_VERSION,
      state: "FROZEN_BY_OWNER",
      frozenAt: new Date().toISOString(),
      frozenBy: input.frozenBy,
      reason: input.reason,
      runId: input.runId
    } satisfies EvolutionControlRecord);
    return this.status();
  }

  /**
   * Clears the freeze. Requires a real Owner control channel: the channel must
   * be registered and its `owner` must equal the Root Owner named by policy
   * (RT-... / RD-015 "Emergency stop cannot self-clear").
   */
  clearFreeze(channel: OwnerControlChannel, rootOwner: string, reason: string): EvolutionControlStatus {
    if (!isAuthorizedOwnerChannel(channel)) throw new EvolutionFrozenError("clearing the evolution freeze requires an Owner control channel");
    if (channel.owner !== rootOwner) throw new EvolutionFrozenError(`owner control channel is ${channel.owner}, not the Root Owner ${rootOwner}`);
    if (this.sentinelFile && fs.existsSync(this.sentinelFile)) {
      throw new EvolutionFrozenError("an external sentinel is present; remove it before clearing the freeze");
    }
    const previous = this.status().record;
    writeJson(this.controlFile, {
      schemaVersion: EVOLUTION_CONTROL_SCHEMA_VERSION,
      state: "ENABLED",
      frozenAt: previous.frozenAt,
      unfrozenAt: new Date().toISOString(),
      reason
    } satisfies EvolutionControlRecord);
    return this.status();
  }

  /**
   * Attempt by an unauthorized actor to clear the freeze. Recorded rather than
   * silently ignored so the attempt itself is audible in evidence.
   */
  attemptUnauthorizedClear(actor: string, reason: string): { allowed: false; actor: string; reason: string; state: EvolutionControlState } {
    return { allowed: false, actor, reason, state: this.status().state };
  }

  /** Creates the external sentinel (an Owner action). */
  raiseSentinel(reason: string, channel: OwnerControlChannel, rootOwner: string): void {
    if (!isAuthorizedOwnerChannel(channel) || channel.owner !== rootOwner) throw new EvolutionFrozenError("raising the evolution sentinel requires an Owner control channel");
    if (!this.sentinelFile) throw new EvolutionFrozenError("no sentinel path is configured");
    fs.mkdirSync(path.dirname(this.sentinelFile), { recursive: true });
    fs.writeFileSync(this.sentinelFile, JSON.stringify({ reason, raisedAt: new Date().toISOString(), nonce: randomUUID() }, null, 2), "utf8");
  }

  removeSentinel(channel: OwnerControlChannel, rootOwner: string): void {
    if (!isAuthorizedOwnerChannel(channel) || channel.owner !== rootOwner) throw new EvolutionFrozenError("removing the evolution sentinel requires an Owner control channel");
    if (this.sentinelFile) fs.rmSync(this.sentinelFile, { force: true });
  }
}
