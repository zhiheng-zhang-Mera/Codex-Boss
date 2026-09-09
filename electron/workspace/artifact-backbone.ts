import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeJson } from "../commander/durable-json";

/**
 * R43 Phase F (R-604): artifact backbone — manifest with hash/version/
 * provenance/decision-log/failed-runs/checkpoint relation per research/eng run.
 * Writes under a run archive directory and never deletes prior stage artifacts
 * on a partial failure (each stage record is appended).
 */
export interface ArtifactRecord {
  stage: string;
  file: string;
  sha256: string;
  version: number;
  provenance: string;
}

export interface RunManifest {
  schemaVersion: 1;
  runId: string;
  records: ArtifactRecord[];
  decisionLog: string;
  failedRuns: string[];
  checkpointRef?: string;
  updatedAt: string;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function existingRunManifest(root: string, runId: string): RunManifest | undefined {
  const file = path.join(root, "manifest.json");
  if (!fs.existsSync(file)) return undefined;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<RunManifest>;
  return parsed.schemaVersion === 1 && parsed.runId === runId ? (parsed as RunManifest) : undefined;
}

export function recordStageArtifact(root: string, runId: string, stage: string, fileName: string, content: string, provenance: string): RunManifest {
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, fileName);
  fs.writeFileSync(target, content, "utf8");
  const previous = existingRunManifest(root, runId);
  const record: ArtifactRecord = { stage, file: fileName, sha256: sha256(content), version: (previous?.records.length ?? 0) + 1, provenance };
  const manifest: RunManifest = {
    schemaVersion: 1,
    runId,
    records: [...(previous?.records ?? []), record], // append-only: partial failure never wipes earlier stages
    decisionLog: path.join(root, "decision-log.json"),
    failedRuns: previous?.failedRuns ?? [],
    checkpointRef: previous?.checkpointRef,
    updatedAt: new Date().toISOString()
  };
  writeJson(path.join(root, "manifest.json"), manifest);
  return manifest;
}

export function markRunFailed(root: string, runId: string, reason: string): RunManifest {
  const manifest = existingRunManifest(root, runId) ?? { schemaVersion: 1, runId, records: [], decisionLog: path.join(root, "decision-log.json"), failedRuns: [], updatedAt: new Date().toISOString() };
  const next: RunManifest = { ...manifest, failedRuns: [...new Set([...manifest.failedRuns, reason])], updatedAt: new Date().toISOString() };
  writeJson(path.join(root, "manifest.json"), next);
  return next;
}
