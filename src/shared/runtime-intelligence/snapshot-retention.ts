/**
 * Runtime Intelligence Plane — node snapshot deduplication and retention.
 *
 * Phase I's growth control, as pure policy. A long-running node sampler produces a snapshot
 * every interval, and on a quiet machine almost all of them are identical — which is exactly
 * the "repeated node snapshot" the plan says must not accumulate without bound.
 *
 * Two mechanisms, and neither deletes anything:
 *
 *   1. **Digest collapse.** A snapshot's *substance* is every measured fact except
 *      `capturedAt`, so two snapshots taken a minute apart on an unchanged machine have the
 *      same digest. CONSECUTIVE entries with the same digest collapse into the first one,
 *      which counts its duplicates. The count is kept, so the collapse loses no information:
 *      "unchanged for 47 samples" is a fact, and 47 identical objects are not 47 facts.
 *      Only consecutive entries collapse — an A, B, A sequence keeps both A entries, because
 *      the change back is a real event.
 *
 *   2. **Retention with an archive.** Beyond `maxPerNode` distinct entries the oldest are moved
 *      to an archive list, not dropped, and the plan reports both. `deletesNothing` is a
 *      literal `true`, so a caller cannot mistake this plan for a deletion.
 *
 * The digest is deliberately taken over the substance rather than the serialized object: a
 * `capturedAt` difference must not look like a capability change, or every sample would be
 * unique and the whole mechanism would be decorative.
 */

import { sha256Hex } from "../hash";
import type { NodeCapabilitySnapshot } from "./contracts";
import { nodeMetricFacts } from "./node-profile";
import { describeMeasurement } from "./measurement";

/** How many distinct entries per node are kept before older ones are archived. */
export const DEFAULT_MAX_SNAPSHOTS_PER_NODE = 200;

/**
 * The canonical text of what a snapshot actually measured.
 *
 * `capturedAt` and the node identity are excluded on purpose: the first is when we looked, the
 * second is who we looked at, and neither is a measurement that can change.
 */
export function snapshotSubstance(snapshot: NodeCapabilitySnapshot): string {
  const metrics = nodeMetricFacts(snapshot)
    .map((entry) => `${entry.key}=${describeMeasurement(entry.fact)}`)
    .join("\n");
  return [`node=${snapshot.nodeId}`, `identity=${snapshot.identity.os}/${snapshot.identity.arch}/${snapshot.identity.runtimeVersion}`, `trust=${snapshot.trust.trustClass}`, `restrictions=${[...snapshot.trust.executionRestrictions].sort().join(",")}`, metrics].join("\n");
}

/** The digest two snapshots share exactly when they measured the same thing. */
export function snapshotDigest(snapshot: NodeCapabilitySnapshot): string {
  return sha256Hex(snapshotSubstance(snapshot));
}

export interface SnapshotSeriesEntry {
  snapshot: NodeCapabilitySnapshot;
  digest: string;
  firstCapturedAt: string;
  lastCapturedAt: string;
  /** How many stored samples this entry represents, including itself. Always at least 1. */
  sampleCount: number;
}

export interface SnapshotCompactionReport {
  nodeId: string;
  /** Snapshots handed in. */
  input: number;
  /** Distinct entries kept. */
  kept: number;
  /** Entries archived because they exceeded the retention limit. */
  archived: number;
  /** Samples collapsed into a representative because nothing had changed. */
  collapsedDuplicates: number;
  entries: SnapshotSeriesEntry[];
  /** The overflow, preserved rather than dropped. */
  archivedEntries: SnapshotSeriesEntry[];
  notes: string[];
}

export interface SnapshotRetentionPlan {
  reports: SnapshotCompactionReport[];
  totalInput: number;
  totalKept: number;
  totalArchived: number;
  totalCollapsed: number;
  /** Literal: this plan moves and collapses, and removes nothing. */
  deletesNothing: true;
}

/**
 * Collapses and retains one node's series.
 *
 * `capturedAt` ordering is string comparison on ISO timestamps, which sorts chronologically.
 * A malformed timestamp does not throw: the entry keeps its position and the report says the
 * ordering could not be trusted for that node.
 */
export function compactSnapshotSeries(
  snapshots: readonly NodeCapabilitySnapshot[],
  options: { nodeId?: string; maxPerNode?: number } = {}
): SnapshotCompactionReport {
  const maxPerNode = options.maxPerNode ?? DEFAULT_MAX_SNAPSHOTS_PER_NODE;
  const nodeId = options.nodeId ?? snapshots[0]?.nodeId ?? "(none)";
  const notes: string[] = [];
  const malformed = snapshots.filter((snapshot) => !Number.isFinite(Date.parse(snapshot.capturedAt))).length;
  if (malformed > 0) notes.push(`${malformed} snapshot(s) had an unparseable capturedAt, so their order is the input order`);

  const ordered = [...snapshots].sort((left, right) => (left.capturedAt === right.capturedAt ? 0 : left.capturedAt < right.capturedAt ? -1 : 1));
  const collapsed: SnapshotSeriesEntry[] = [];
  for (const snapshot of ordered) {
    const digest = snapshotDigest(snapshot);
    const previous = collapsed.at(-1);
    if (previous !== undefined && previous.digest === digest) {
      previous.lastCapturedAt = snapshot.capturedAt;
      previous.sampleCount += 1;
      continue;
    }
    collapsed.push({ snapshot, digest, firstCapturedAt: snapshot.capturedAt, lastCapturedAt: snapshot.capturedAt, sampleCount: 1 });
  }

  const keepFrom = Math.max(0, collapsed.length - maxPerNode);
  const archivedEntries = collapsed.slice(0, keepFrom);
  const entries = collapsed.slice(keepFrom);
  if (archivedEntries.length > 0) {
    notes.push(`${archivedEntries.length} distinct entry(ies) beyond the ${maxPerNode}-entry retention limit were archived, not deleted`);
  }
  const collapsedDuplicates = ordered.length - collapsed.length;
  if (collapsedDuplicates > 0) notes.push(`${collapsedDuplicates} unchanged sample(s) were collapsed into a representative that counts them`);

  return {
    nodeId,
    input: ordered.length,
    kept: entries.length,
    archived: archivedEntries.length,
    collapsedDuplicates,
    entries,
    archivedEntries,
    notes
  };
}

/**
 * Plans retention across every node in a series.
 *
 * Groups by `nodeId`, so one noisy node cannot evict another node's history. The result is a
 * plan: the caller decides whether to write the archive, and nothing here writes anything.
 */
export function planSnapshotRetention(snapshots: readonly NodeCapabilitySnapshot[], options: { maxPerNode?: number } = {}): SnapshotRetentionPlan {
  const byNode = new Map<string, NodeCapabilitySnapshot[]>();
  for (const snapshot of snapshots) byNode.set(snapshot.nodeId, [...(byNode.get(snapshot.nodeId) ?? []), snapshot]);
  const reports = [...byNode.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([nodeId, series]) => compactSnapshotSeries(series, { nodeId, ...(options.maxPerNode === undefined ? {} : { maxPerNode: options.maxPerNode }) }));

  return {
    reports,
    totalInput: reports.reduce((total, report) => total + report.input, 0),
    totalKept: reports.reduce((total, report) => total + report.kept, 0),
    totalArchived: reports.reduce((total, report) => total + report.archived, 0),
    totalCollapsed: reports.reduce((total, report) => total + report.collapsedDuplicates, 0),
    deletesNothing: true
  };
}

/** The substance of one snapshot as a short, comparable line, for a status report. */
export function describeSnapshotSubstance(snapshot: NodeCapabilitySnapshot): string {
  return snapshotSubstance(snapshot).split("\n").slice(0, 3).join("; ");
}
