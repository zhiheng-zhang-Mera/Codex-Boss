import fs from "node:fs";
import path from "node:path";
import { validId } from "./durable-json";

/**
 * Data lifecycle / storage budget (plan §17). The append-only ledger was the
 * audit's first unbounded-growth risk: every `save()` writes a new generation
 * checkpoint and nothing ever deletes. This adds bounded retention for
 * checkpoint generations and a policy type that later L0–L4 tiering builds on.
 */

export interface RetentionPolicy {
  /** How many newest generations to keep per task. Older generations are pruned. */
  keepGenerations: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { keepGenerations: 50 };

export interface PruneReport {
  taskId: string;
  before: number;
  after: number;
  removed: number;
}

/**
 * Removes the oldest generation checkpoints of one task so only the newest
 * `keep` remain. Fail-closed: never deletes when the newest file cannot be
 * identified or the policy is invalid.
 */
export function pruneTaskCheckpoints(root: string, taskId: string, policy: RetentionPolicy = DEFAULT_RETENTION): PruneReport {
  if (!Number.isInteger(policy.keepGenerations) || policy.keepGenerations < 5) throw new Error("Retention must keep at least 5 generations");
  const directory = path.join(root, validId(taskId), "checkpoints");
  if (!fs.existsSync(directory)) return { taskId, before: 0, after: 0, removed: 0 };
  const generations = fs.readdirSync(directory).filter((name) => /^\d{8}\.json$/.test(name)).sort();
  if (generations.length <= policy.keepGenerations) return { taskId, before: generations.length, after: generations.length, removed: 0 };
  // Only prune when a clean newest generation is present so a partially
  // written state is never the only thing left.
  const newest = generations[generations.length - 1];
  if (!fs.existsSync(path.join(directory, newest))) throw new Error(`Missing newest checkpoint: ${newest}`);
  const removable = generations.slice(0, generations.length - policy.keepGenerations);
  for (const generation of removable) fs.rmSync(path.join(directory, generation), { force: true });
  return { taskId, before: generations.length, after: generations.length - removable.length, removed: removable.length };
}
