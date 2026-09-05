import type { TelemetryStore } from "../telemetry/telemetry-store";
import type { FailureCluster, RfcDraft } from "../../src/shared/self-diagnosis";
import { clusterFailures, buildRfc } from "../../src/shared/self-diagnosis";

/**
 * Self diagnosis (plan AP26 seed): clusters FAILED telemetry from the
 * Performance DB into failure clusters and drafts an RFC for the top cluster —
 * the input a future Self Modification pack can review before acting.
 */
export function diagnoseTelemetry(store: TelemetryStore): { clusters: FailureCluster[]; topRfc?: RfcDraft } {
  const clusters = clusterFailures(store.list());
  if (!clusters.length) return { clusters };
  return { clusters, topRfc: buildRfc(clusters[0]) };
}
