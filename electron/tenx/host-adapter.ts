/**
 * 10Q: adapter boundary seam (forward).
 *
 * The shared protocols under src/shared/tenx are platform-neutral. Real host
 * work happens ONLY behind adapters that implement this seam. A future Android/
 * iOS/HarmonyOS node implements the same seam against its own host APIs — the
 * shared contract (schema, envelope, lease, knowledge, artifact records) never
 * changes.
 *
 * This module intentionally lives in electron/ (host side). Nothing in
 * src/shared/tenx may import it.
 */

import type { NodeCapabilityReport } from "../../src/shared/tenx/inspection";
import type { NodeIdentity, NodeRefreshFacts } from "../../src/shared/tenx/node";
import type { ProviderMatrix } from "../../src/shared/tenx/network";
import type { LoginHealthReport } from "../../src/shared/tenx/session";

/** Every host-specific capability adapter implements this seam. */
export interface TenxHostAdapter {
  readonly platform: "windows" | "linux" | "macos" | "android" | "ios" | "harmonyos";
  /** Produce a stable identity for this device (host-specific persistence). */
  identity(): Promise<NodeIdentity>;
  /** Produce observed refresh facts (hardware/network/proxy/provider). */
  refreshFacts(): Promise<NodeRefreshFacts>;
  /** Produce a full self-inspection report (10C probes bound to this host). */
  inspect(): Promise<NodeCapabilityReport>;
  /** Observe provider reachability for this host (10M). */
  providerMatrix(): Promise<ProviderMatrix>;
  /** Scan login status for a provider/account on this host (10O). */
  loginHealth(provider: string, account?: string): Promise<LoginHealthReport>;
}
