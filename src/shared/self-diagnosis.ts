/** Self diagnosis + RFC (plan AP26). Pure failure clustering over telemetry. */

export interface TelemetryLike {
  taskId: string;
  runtimeId: string;
  outcome: string;
  reason?: string;
  at: string;
}

export interface FailureCluster {
  runtimeId: string;
  reason: string;
  count: number;
  lastAt: string;
  sampleTaskIds: string[];
}

export interface RfcDraft {
  problem: string;
  evidence: FailureCluster;
  hypothesis: string;
  candidateFix: string;
  expectedBenefit: string;
  risk: string;
  benchmark: string;
  rollback: string;
  compatibilityImpact: string;
}

const REASON_GROUPS: Array<[RegExp, string]> = [
  [/timeout|timed out/i, "timeout"],
  [/network|econn|offline/i, "network"],
  [/quota|budget|usage limit|额度|用量/i, "quota"],
  [/rate.?limit|429|too many/i, "rate-limit"],
  [/auth|login|session expired/i, "auth/session"],
  [/crash|killed|down/i, "crash/unavailable"],
  [/unparseable|invalid|malformed/i, "invalid output"]
];

export function normalizeReason(message: string | undefined): string {
  if (!message) return "unknown";
  const match = REASON_GROUPS.find(([pattern]) => pattern.test(message));
  return match ? match[1] : "unknown";
}

/** Clusters FAILED telemetry records by runtime + normalized reason. */
export function clusterFailures(records: TelemetryLike[]): FailureCluster[] {
  const clusters = new Map<string, FailureCluster>();
  for (const record of records) {
    if (record.outcome !== "FAILED") continue;
    const reason = normalizeReason(record.reason);
    const key = `${record.runtimeId}|${reason}`;
    const cluster = clusters.get(key) ?? { runtimeId: record.runtimeId, reason, count: 0, lastAt: record.at, sampleTaskIds: [] };
    cluster.count += 1;
    if (record.at > cluster.lastAt) cluster.lastAt = record.at;
    if (!cluster.sampleTaskIds.includes(record.taskId) && cluster.sampleTaskIds.length < 5) cluster.sampleTaskIds.push(record.taskId);
    clusters.set(key, cluster);
  }
  return [...clusters.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

/** Builds an RFC draft from the top cluster (plan §26 structure). */
export function buildRfc(cluster: FailureCluster, codeArea = "runtime adapter"): RfcDraft {
  return {
    problem: `${cluster.runtimeId} failed ${cluster.count}x with "${cluster.reason}"`,
    evidence: cluster,
    hypothesis: `repeated ${cluster.reason} on ${cluster.runtimeId} indicates ${codeArea} instability`,
    candidateFix: "add targeted retry/backoff or gate the failing path; re-verify with the reproduction snapshot",
    expectedBenefit: `reduce ${cluster.runtimeId} failures`,
    risk: "low-to-medium; affects only the failing runtime path",
    benchmark: `targeted golden: ${cluster.runtimeId} ${cluster.reason} recovery`,
    rollback: "revert the fix commit; keep prior adapter health gating",
    compatibilityImpact: "runtime adapter only; no contract change"
  };
}
