/**
 * 10K artifact/memory architecture (pure skeleton).
 *
 * Unified artifact records (run / engineering / research / decision / failure /
 * checkpoint / knowledge-source / provider-interaction) with sha256,
 * provenance and append-oriented semantics. A later failure never erases an
 * earlier successful artifact; failed runs are preserved.
 */

export type ArtifactType =
  | "run"
  | "engineering"
  | "research"
  | "decision-record"
  | "failure-record"
  | "checkpoint"
  | "knowledge-source"
  | "provider-interaction";

export type ArtifactStage = "RAW" | "NORMALIZED" | "VALIDATED" | "COMMITTED" | "REJECTED";
export type ArtifactStatus = "ACTIVE" | "FAILED" | "SUPERSEDED";

export interface ArtifactRecordVNext {
  artifactId: string;
  type: ArtifactType;
  runId: string;
  taskId?: string;
  nodeId: string;
  createdAt: string;
  sha256: string;
  version: number;
  source: string;
  provenance: string;
  stage: ArtifactStage;
  status: ArtifactStatus;
  checkpointRef?: string;
}
