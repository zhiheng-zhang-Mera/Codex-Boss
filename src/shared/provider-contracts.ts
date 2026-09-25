/**
 * The provider contract: the types that describe a provider, its account, its API settings and one run of it.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 *   These declarations used to live in `src/shared/contracts.ts` alongside six other unrelated purposes, and that
 *   file is owned by the `status` capability. The consequence was measured, not assumed: the edge inventory
 *   (`scripts/phase2-edge-inventory.cjs`, under the ownership map) reported **13 `providers -> status` edges**,
 *   ten of them because files owned by the `providers` KERNEL imported PROVIDER TYPES from a file owned by a
 *   FEATURE. A kernel reaching into a feature for the description of its own subject is an inversion in the
 *   measurement and an untruth in the map.
 *
 *   `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` answers this directly: a bundle containing independent
 *   purposes must be split, and the unit of migration is the MINIMUM STABLE SEMANTIC CLOSURE rather than a file
 *   count. The provider closure is that unit here -- every type below is about a provider or one run of one, and
 *   they are moved together because they key on each other (`ProviderRun`, `ProviderAccountState`,
 *   `ApiProviderSetting` and `UpdateApiSettingInput` are all keyed by `ProviderId`).
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   It does not import from `contracts.ts`. That is the property that makes the move clean: this module depends
 *   only on `./execution`, so the dependency runs one way (`contracts.ts` -> here) and the two shared modules
 *   cannot form a cycle -- which would have RAISED the mutual-pair count the P2-C ratchet guards.
 *
 *   It does not re-export the other six concerns, and it does not absorb them. The remaining purposes in
 *   `contracts.ts` (task / council / claim-evidence / conversation / remote / app-snapshot) are a separate
 *   migration with its own measured blast radius.
 */

import type { ReviewResult, WorkerResponse } from "./execution";

export type ProviderId = string;
export type RunTransport = "web" | "api";
export type ApiProtocol = "openai-compatible" | "anthropic" | "gemini";
export type AdapterOutcome = "SUCCESS" | "RETRYABLE_FAILURE" | "AUTH_REQUIRED" | "RATE_LIMITED" | "PAGE_CHANGED" | "FORMAT_INVALID" | "USER_ACTION_REQUIRED" | "UNSUPPORTED";
export type ProviderRunPhase = "queued" | "opening" | "prepared" | "sending" | "waiting" | "completed" | "failed" | "blocked";
export type ProviderAccountMode = "UNKNOWN" | "GUEST_READY" | "AUTH_REQUIRED" | "READY";

export interface Provider {
  id: ProviderId;
  name: string;
  url: string;
  accent: string;
  windowOpen: boolean;
  isCustom: boolean;
}

export interface ProviderRun {
  response?: WorkerResponse;
  review?: ReviewResult;
  attempts?: number;
  responseBaseline?: string;
  sessionUrl?: string;
  id: string;
  taskId: string;
  providerId: ProviderId;
  transport: RunTransport;
  round: number;
  phase: ProviderRunPhase;
  outcome: AdapterOutcome | null;
  message: string;
  inputPrompt: string;
  adapterVersion: string;
  artifactId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderAccountState {
  providerId: ProviderId;
  partition: string;
  mode: ProviderAccountMode;
  persistent: true;
  message: string;
  updatedAt: string;
}

export interface ApiProviderSetting {
  providerId: ProviderId;
  enabled: boolean;
  protocol: ApiProtocol;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  /** Last 4 chars of the stored key for masked display (sk-••••42A9). Never the full key. */
  keyTail?: string;
  updatedAt: string;
}

export interface UpdateApiSettingInput {
  providerId: ProviderId;
  enabled: boolean;
  protocol: ApiProtocol;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface CustomProviderInput {
  name: string;
  url: string;
}
