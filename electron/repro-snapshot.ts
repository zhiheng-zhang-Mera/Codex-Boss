import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

/**
 * Reproducibility snapshot (plan §11). Captures the minimal facts needed to
 * replay an important failure — workspace version, git commit, config hash,
 * dependency lock, provider/model, context fingerprint and input artifact
 * hashes — never a whole machine image.
 */

export interface ReproGitState {
  commit: string | null;
  branch: string | null;
  dirty: boolean;
}

export interface ReproSnapshotInput {
  workspace?: string;
  provider?: string;
  model?: string;
  harness?: string;
  contextFingerprint?: string;
  inputArtifactHashes?: string[];
  extraConfig?: Record<string, string>;
  now?: () => number;
}

export interface ReproductionSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  workspace?: { path?: string; gitCommit?: string; gitBranch?: string; dirty?: boolean };
  configHash?: string;
  dependencyLock?: { present: boolean; hash: string | null };
  provider?: string;
  model?: string;
  harness?: string;
  contextFingerprint?: string;
  inputArtifactHashes: string[];
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function fileSha256(file: string): string | null {
  try {
    return sha256Hex(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function git(root: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => execFile("git", args, { cwd: root, windowsHide: true, timeout: 10000 }, (error, stdout) => resolve(error ? null : stdout.trim())));
}

export async function collectGitState(root: string): Promise<ReproGitState> {
  const [commit, branch, porcelain] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(root, ["status", "--porcelain"])
  ]);
  return { commit, branch, dirty: porcelain !== null && porcelain.length > 0 };
}

/** Hash of the shipped user-config files the runtime consumes (runtime-policy + schema). */
export function configHash(repoRoot: string): string | undefined {
  const candidates = [path.join(repoRoot, ".codex-boss", "config", "runtime-policy.json"), path.join(repoRoot, ".codex-boss", "config", "runtime-policy.schema.json")];
  const present = candidates.filter((file) => fs.existsSync(file));
  if (!present.length) return undefined;
  return sha256Hex(present.sort().map((file) => `${path.relative(repoRoot, file)}:${fileSha256(file) ?? ""}`).join("\n"));
}

/** Lockfile presence + content hash (dependency lock, plan §11). */
export function dependencyLock(repoRoot: string): { present: boolean; hash: string | null } {
  for (const name of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
    const file = path.join(repoRoot, name);
    if (!fs.existsSync(file)) continue;
    return { present: true, hash: fileSha256(file) };
  }
  return { present: false, hash: null };
}

export async function buildReproductionSnapshot(input: ReproSnapshotInput): Promise<ReproductionSnapshot> {
  const now = input.now ?? Date.now;
  const snapshot: ReproductionSnapshot = {
    schemaVersion: 1,
    capturedAt: new Date(now()).toISOString(),
    inputArtifactHashes: input.inputArtifactHashes ?? []
  };
  if (input.workspace) {
    const git = await collectGitState(input.workspace);
    snapshot.workspace = {
      path: input.workspace,
      ...(git.commit ? { gitCommit: git.commit } : {}),
      ...(git.branch ? { gitBranch: git.branch } : {}),
      dirty: git.dirty
    };
  }
  if (input.provider) snapshot.provider = input.provider;
  if (input.model) snapshot.model = input.model;
  if (input.harness) snapshot.harness = input.harness;
  if (input.contextFingerprint) snapshot.contextFingerprint = input.contextFingerprint;
  const root = input.workspace;
  if (root) {
    const config = configHash(root);
    if (config) snapshot.configHash = config;
    snapshot.dependencyLock = dependencyLock(root);
    if (input.extraConfig) snapshot.configHash = sha256Hex([snapshot.configHash ?? "", ...Object.entries(input.extraConfig).map(([k, v]) => `${k}:${v}`)].join("\n"));
  }
  return snapshot;
}

export function validateReproductionSnapshot(value: unknown): ReproductionSnapshot {
  const snapshot = value as Partial<ReproductionSnapshot>;
  if (!snapshot || snapshot.schemaVersion !== 1 || typeof snapshot.capturedAt !== "string" || !Array.isArray(snapshot.inputArtifactHashes)) throw new Error("Invalid reproduction snapshot");
  return snapshot as ReproductionSnapshot;
}
