/**
 * Update-Plan/checkpoint-1.md §37/§38 — the host side.
 *
 * §38's checkpoint is a real git operation: this module reads the real HEAD, branch
 * and diff, hashes the diff it captured, writes the record durably and can restore
 * the working tree from the recorded commit. §37's assessment is fed with real
 * source inspection — a changed file's exported symbols before and after come from
 * `git show <head>:<path>` and the file on disk, not from a guess.
 *
 * The guards are the point: `guardGitHubWrite` refuses a remote write without a
 * current checkpoint, and `rollback` refuses to run when the repository has moved
 * away from what the checkpoint recorded unless the Owner approved discarding
 * commits.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contentHashOf } from "../../src/shared/workbook";
import { extractExportedSymbols } from "./world-model";
import {
  assessVersionImpact,
  isThemeEngineContract,
  type AssessInput,
  type ChangeObservation,
  type VersionAssessment,
  type VersionImpact
} from "../../src/shared/version-impact";
import {
  checkpointIdFor,
  guardGitHubWrite,
  isUsableCheckpoint,
  planRollback,
  type CheckpointRecord,
  type PushGuardVerdict,
  type RollbackPlan
} from "../../src/shared/git-checkpoint";

export const CHECKPOINT_DIRECTORY = path.join("artifacts", "acceptance", "checkpoints");
/** Diffs are captured, but a giant diff must not become a giant record. */
export const MAX_CAPTURED_DIFF_BYTES = 512 * 1024;

export interface GitCheckpointConfig {
  root: string;
  directory?: string;
  now?: () => Date;
}

export interface CreateCheckpointInput {
  task_id: string;
  candidate_id?: string;
  evidence?: readonly string[];
  /** §37: the impact assessment to carry with the checkpoint. */
  version_impact?: VersionImpact;
  /** Supplied when the caller already assessed; otherwise the host assesses. */
  assessment?: VersionAssessment;
  /** A worker's claimed impact, which §37 has the host check. */
  worker_claim?: VersionImpact;
  current_version?: string;
}

export interface RollbackOutcome {
  ok: boolean;
  plan: RollbackPlan;
  restored: string[];
  /** What the working tree looked like afterwards. */
  after: { head: string; branch: string; dirty: boolean; status: string[] };
  reason: string;
}

export interface GitCheckpointStore {
  /** §38: capture HEAD, branch, the diff, the task, the candidate and the evidence. */
  create(input: CreateCheckpointInput): CheckpointRecord;
  /** §37: assess the impact of the captured change. */
  assess(options?: { worker_claim?: VersionImpact; current_version?: string }): VersionAssessment;
  /** §38: refuse a GitHub write that no checkpoint covers. */
  guard(operation: Parameters<typeof guardGitHubWrite>[0]["operation"], taskId: string): PushGuardVerdict;
  /** §38: roll the working tree back to the checkpoint. */
  rollback(checkpoint: CheckpointRecord, options?: { owner_approved_discard?: boolean }): RollbackOutcome;
  /** Older change directories: the §12 theme packages under the workspace. */
  checkpoints(): CheckpointRecord[];
  save(): string;
}

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

export function createGitCheckpointStore(config: GitCheckpointConfig): GitCheckpointStore {
  const root = fs.realpathSync(config.root);
  const now = config.now ?? (() => new Date());
  const directory = config.directory ?? path.join(root, CHECKPOINT_DIRECTORY);

  const head = (): string => git(root, ["rev-parse", "HEAD"]).out.trim();
  const branch = (): string => git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
  const statusLines = (): string[] => git(root, ["status", "--porcelain"]).out.split(/\r?\n/).filter(Boolean);
  const diffText = (): string => git(root, ["diff", "HEAD"]).out;
  const diffHashOf = (diff: string): string => contentHashOf(diff);

  /**
   * §37: the host inspects the change itself. For every changed path it records the
   * kind, whether the file is part of the consumed surface, whether it declares a
   * schema, whether it is user-facing, and its exported symbols before and after.
   */
  const observe = (): ChangeObservation[] => {
    const lines = statusLines();
    const observations: ChangeObservation[] = [];
    for (const line of lines) {
      const kindCode = line.slice(0, 2).trim();
      const rawPath = line.slice(3).trim();
      const renamed = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()! : rawPath;
      const file = renamed.replace(/^"|"$/g, "").replace(/\\/g, "/");
      if (file.startsWith("artifacts/")) continue;
      const kind: ChangeObservation["kind"] = kindCode.startsWith("D") ? "DELETED" : kindCode.startsWith("R") ? "RENAMED" : kindCode.startsWith("A") || kindCode === "??" ? "ADDED" : "MODIFIED";
      const absolute = path.join(root, file);
      const before = kind === "ADDED" ? "" : git(root, ["show", `HEAD:${file}`]).out;
      const after = kind === "DELETED" || !fs.existsSync(absolute) ? "" : fs.readFileSync(absolute, "utf8");
      const observation: ChangeObservation = {
        path: file,
        kind,
        exports_before: extractExportedSymbols(before),
        exports_after: extractExportedSymbols(after),
        public_surface: /^src\/(shared|renderer)\//.test(file) || /\/(index|api)\.(ts|tsx)$/.test(file),
        schema: /schema|types\.ts$|knowledge-object/.test(file),
        user_facing: /^src\/renderer\//.test(file) || /\.(css|tsx)$/.test(file),
        test_or_docs: /(^|\/)(tests?|docs)\//.test(file) || /\.(md|test|spec)\.[a-z]+$/i.test(file),
        theme_package: /(^|\/)themes\//.test(file),
        theme_engine_contract: isThemeEngineContract(file)
      };
      observations.push(observation);
    }
    return observations;
  };

  const assess = (options: { worker_claim?: VersionImpact; current_version?: string } = {}): VersionAssessment =>
    assessVersionImpact({
      changes: observe(),
      ...(options.worker_claim ? { worker_claim: options.worker_claim } : {}),
      ...(options.current_version ? { current_version: options.current_version } : {})
    } satisfies AssessInput);

  const load = (): CheckpointRecord[] => {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")) as unknown;
          return isUsableCheckpoint(parsed) ? [parsed] : [];
        } catch {
          // An unreadable checkpoint is treated as absent, never as valid.
          return [];
        }
      })
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  };

  let records: CheckpointRecord[] = load();
  const persist = (record: CheckpointRecord): string => {
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `${record.id}.json`);
    fs.writeFileSync(target, JSON.stringify(record, null, 2), "utf8");
    return target;
  };

  return {
    assess,
    checkpoints: () => records,
    create(input) {
      const diff = diffText();
      const captured = diff.length > MAX_CAPTURED_DIFF_BYTES ? diff.slice(0, MAX_CAPTURED_DIFF_BYTES) : diff;
      const at = now().toISOString();
      const headValue = head();
      const branchValue = branch();
      const changed = observe().map((observation) => observation.path);
      // §37: the host always assesses; a caller-supplied assessment is respected
      // only because it came from this same host path.
      const assessment = input.assessment ?? assess({
        ...(input.worker_claim ? { worker_claim: input.worker_claim } : {}),
        ...(input.current_version ? { current_version: input.current_version } : {})
      });
      const record: CheckpointRecord = {
        schemaVersion: 1,
        version: "git-checkpoint-1",
        id: checkpointIdFor({ task_id: input.task_id, head: headValue, branch: branchValue, created_at: at }),
        head: headValue,
        branch: branchValue,
        diff_hash: diffHashOf(captured),
        diff_bytes: Buffer.byteLength(diff, "utf8"),
        task_id: input.task_id,
        ...(input.candidate_id ? { candidate_id: input.candidate_id } : {}),
        evidence: [...(input.evidence ?? [])],
        changed_files: changed,
        ...(input.version_impact ?? assessment?.impact ? { version_impact: input.version_impact ?? assessment!.impact } : {}),
        created_at: at,
        dirty: changed.length > 0
      };
      records = [record, ...records.filter((existing) => existing.id !== record.id)];
      persist(record);
      return record;
    },
    guard(operation, taskId) {
      const current = { head: head(), branch: branch(), diff_hash: diffHashOf(diffText().slice(0, MAX_CAPTURED_DIFF_BYTES)) };
      return guardGitHubWrite({ checkpoints: records, task_id: taskId, current, operation });
    },
    rollback(checkpoint, options = {}) {
      const plan = planRollback({
        checkpoint,
        current: { head: head(), branch: branch(), diff_hash: diffHashOf(diffText().slice(0, MAX_CAPTURED_DIFF_BYTES)), dirty: statusLines().length > 0 },
        ...(options.owner_approved_discard ? { owner_approved_discard: true } : {})
      });
      const restored: string[] = [];
      if (plan.ok) {
        if (plan.path_restore_sufficient) {
          for (const file of checkpoint.changed_files) {
            // A file that did not exist at the checkpoint's HEAD cannot be
            // restored — undoing its addition means removing it.
            const inHead = git(root, ["cat-file", "-e", `${checkpoint.head}:${file}`]).ok;
            if (inHead) {
              const result = git(root, ["checkout", checkpoint.head, "--", file]);
              if (result.ok) restored.push(file);
            } else {
              const target = path.join(root, file);
              if (fs.existsSync(target)) {
                fs.rmSync(target, { force: true });
                restored.push(file);
              }
            }
          }
        } else {
          // The Owner approved discarding the commits made after the checkpoint.
          git(root, ["checkout", checkpoint.branch]);
          const result = git(root, ["reset", "--hard", checkpoint.head]);
          if (result.ok) restored.push(...checkpoint.changed_files);
        }
      }
      return {
        ok: plan.ok && restored.length > 0,
        plan,
        restored,
        after: { head: head(), branch: branch(), dirty: statusLines().length > 0, status: statusLines() },
        reason: plan.ok ? `restored ${restored.length} path(s) from ${checkpoint.head.slice(0, 12)}` : plan.reasons.join("; ")
      };
    },
    save() {
      for (const record of records) persist(record);
      return directory;
    }
  };
}
