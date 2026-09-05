import type { TelemetryStore } from "../telemetry/telemetry-store";
import type { FailureCluster, RfcDraft } from "../../src/shared/self-diagnosis";
import { clusterFailures, buildRfc } from "../../src/shared/self-diagnosis";
import type { RfcCorrection } from "../../src/shared/correction";
import { applyCorrections } from "../../src/shared/correction";

/**
 * Self diagnosis (plan AP26): clusters FAILED telemetry from the Performance
 * DB into failure clusters and drafts an RFC for the top cluster — the input a
 * future Self Modification pack can review before acting.
 *
 * When human corrections (CorrectionStore) are supplied, the top RFC is
 * re-drafted with the latest human amendment per field applied on top of the
 * generated content, so diagnosis output reflects what a human already told
 * the system about the failure.
 */
export function diagnoseTelemetry(
  store: TelemetryStore,
  corrections: RfcCorrection[] = [],
): { clusters: FailureCluster[]; topRfc?: RfcDraft } {
  const clusters = clusterFailures(store.list());
  if (!clusters.length) return { clusters };
  const top = clusters[0];
  const clusterKey = `${top.runtimeId}|${top.reason}`;
  const amended = corrections.filter((correction) => correction.clusterKey === clusterKey);
  const rfc = amended.length ? applyCorrections(buildRfc(top), amended) : buildRfc(top);
  return { clusters, topRfc: rfc };
}
