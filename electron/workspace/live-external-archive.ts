import type { ExternalSessionRecord } from "../../src/shared/external-session";
import type { ArchiveAttempt, ExternalArchiveAttempt } from "./external-archive-automation";

/**
 * Live external-archive attempt seam (Overcomplete §11.3/§11.4). Production
 * wiring for `automatePendingExternalArchives`: before touching a page the
 * attempt checks the provider window + account state (fail closed: a closed or
 * auth-blocked session is deferred, never fabricated as archived), then either
 * delegates to the injected per-provider `performArchive` (adapter seam) or —
 * when no archive affordance adapter is declared — records UNSUPPORTED and
 * keeps the row ARCHIVE_PENDING for a later pass or manual archive.
 *
 * Archive success is ONLY ever reported as `archived: true` by the adapter
 * that verified the page state; every other outcome stays pending.
 */

export type AccountMode = "READY" | "GUEST_READY" | "AUTH_REQUIRED" | "RATE_LIMITED" | "UNKNOWN" | "DOWN";

export interface LiveArchiveEnvironment {
  windowOpen: (providerId: string) => boolean;
  accountMode: (providerId: string) => AccountMode;
  /**
   * Real per-provider archive + verify action (adapter registry seam). Absent
   * for providers whose visible-page affordance is not implemented; the record
   * honestly remains ARCHIVE_PENDING.
   */
  performArchive?: (record: ExternalSessionRecord) => Promise<ExternalArchiveAttempt>;
}

export function createLiveExternalArchiveAttempt(environment: LiveArchiveEnvironment): ArchiveAttempt {
  return async (record) => {
    if (!environment.windowOpen(record.providerId)) {
      return { archived: false, note: "provider window is closed; conversation archive cannot be verified — stays ARCHIVE_PENDING" };
    }
    const account = environment.accountMode(record.providerId);
    if (account === "AUTH_REQUIRED" || account === "DOWN" || account === "UNKNOWN") {
      return { archived: false, note: `provider account state ${account}; archive deferred (never fake-archived)` };
    }
    if (account === "RATE_LIMITED") {
      return { archived: false, note: "provider rate limited; archive deferred" };
    }
    if (environment.performArchive) {
      return environment.performArchive(record);
    }
    return { archived: false, note: "UNSUPPORTED: no archive affordance adapter for this provider; row stays ARCHIVE_PENDING (manual archive keeps it visible)" };
  };
}
