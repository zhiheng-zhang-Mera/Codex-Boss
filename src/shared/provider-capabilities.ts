/**
 * Provider capability model (plan 9-7 §7). Capabilities are runtime metadata
 * about what a provider can actually ingest — never a UI concern. Boss reads
 * this registry to decide who handles a file, without asking the user.
 *
 * Pure + shareable. Deterministic defaults live here; a mutable per-provider
 * override registry may extend them at runtime (electron/adapters).
 */

import type { ProviderId } from "./contracts";
import type { InputObjectKind } from "./input-object";

export interface ProviderCapabilities {
  text: boolean;
  imageUpload: boolean;
  pdfUpload: boolean;
  documentUpload: boolean;
  spreadsheetUpload: boolean;
  archiveUpload: boolean;
  multipleFiles: boolean;
  vision: boolean;
  code: boolean;
  longContext: boolean;
  /** Upper bound for one upload in bytes; absent = unknown (fail closed on size checks). */
  maxUploadBytes?: number;
}

export interface ProviderCapabilityProfile {
  providerId: ProviderId;
  capabilities: ProviderCapabilities;
  /** Who/what verified the profile (e.g. "adapter:chatgpt-web/2026-09-v1", "operator"). */
  verifiedBy: string;
  updatedAt?: string;
}

/** Capability demanded by an input object's kind (plan §7 vocabulary). */
export function capabilityNeedsForKind(kind: InputObjectKind): Array<keyof ProviderCapabilities> {
  switch (kind) {
    case "IMAGE": return ["imageUpload", "vision"];
    case "PDF": return ["pdfUpload"];
    case "DOCUMENT": return ["documentUpload"];
    case "SPREADSHEET": return ["spreadsheetUpload"];
    case "ARCHIVE": return ["archiveUpload"];
    case "CODE": return ["code"];
    case "REPOSITORY": return ["code"];
    case "WEB": return ["longContext"];
    case "TEXT": return ["text"];
    default: return ["text"];
  }
}

export const PROVIDER_CAPABILITY_KEYS: Array<keyof ProviderCapabilities> = [
  "text", "imageUpload", "pdfUpload", "documentUpload", "spreadsheetUpload", "archiveUpload",
  "multipleFiles", "vision", "code", "longContext"
];

/** Fail-closed capability set: nothing is assumed before verification. */
export function noProviderCapabilities(): ProviderCapabilities {
  return { text: false, imageUpload: false, pdfUpload: false, documentUpload: false, spreadsheetUpload: false, archiveUpload: false, multipleFiles: false, vision: false, code: false, longContext: false };
}

export function canHandleObject(capabilities: ProviderCapabilities, kind: InputObjectKind): boolean {
  return capabilityNeedsForKind(kind).every((need) => capabilities[need] === true);
}

/** True when an upload of this byte size is admissible for the profile. */
export function withinUploadLimit(capabilities: ProviderCapabilities, bytes: number): boolean {
  return capabilities.maxUploadBytes === undefined || bytes <= capabilities.maxUploadBytes;
}

/**
 * Deterministic baseline profiles for the shipped providers. These are honest
 * *assumptions* only where the visible web products are known to accept a file
 * type; every profile must eventually be confirmed by a verified upload
 * (Phase D) or an operator edit before Boss stops offering a deterministic
 * fallback. Providers absent from this table default to no capabilities.
 */
const BASELINE: Record<string, ProviderCapabilities> = {
  chatgpt: { text: true, imageUpload: true, pdfUpload: true, documentUpload: true, spreadsheetUpload: true, archiveUpload: false, multipleFiles: true, vision: true, code: true, longContext: true },
  gemini: { text: true, imageUpload: true, pdfUpload: true, documentUpload: true, spreadsheetUpload: true, archiveUpload: false, multipleFiles: true, vision: true, code: true, longContext: true },
  claude: { text: true, imageUpload: true, pdfUpload: true, documentUpload: true, spreadsheetUpload: true, archiveUpload: false, multipleFiles: true, vision: true, code: true, longContext: true },
  deepseek: { text: true, imageUpload: true, pdfUpload: true, documentUpload: true, spreadsheetUpload: true, archiveUpload: false, multipleFiles: true, vision: true, code: true, longContext: true },
  qwen: { text: true, imageUpload: true, pdfUpload: true, documentUpload: true, spreadsheetUpload: false, archiveUpload: false, multipleFiles: true, vision: true, code: true, longContext: true },
  kimi: { text: true, imageUpload: true, pdfUpload: true, documentUpload: true, spreadsheetUpload: false, archiveUpload: false, multipleFiles: true, vision: true, code: true, longContext: true },
  grok: { text: true, imageUpload: true, pdfUpload: true, documentUpload: false, spreadsheetUpload: false, archiveUpload: false, multipleFiles: true, vision: true, code: true, longContext: true }
};

/** Baseline profile for a provider id (empty capability set when unknown). */
export function baselineCapabilitiesFor(providerId: ProviderId): ProviderCapabilities {
  return { ...noProviderCapabilities(), ...(BASELINE[providerId] ?? {}) };
}

/** Baseline profile record used to seed the registry. */
export function baselineProfileFor(providerId: ProviderId): ProviderCapabilityProfile {
  return { providerId, capabilities: baselineCapabilitiesFor(providerId), verifiedBy: "baseline" };
}

/** Merges an operator/verification profile over the baseline, keeping unknown keys false. */
export function mergeCapabilityProfiles(base: ProviderCapabilities, override: Partial<ProviderCapabilities>): ProviderCapabilities {
  const merged: Record<string, boolean | number | undefined> = { ...base, ...override };
  for (const key of PROVIDER_CAPABILITY_KEYS) {
    merged[key] = merged[key] === true;
  }
  const result = { ...merged } as unknown as ProviderCapabilities;
  if (override.maxUploadBytes !== undefined) {
    result.maxUploadBytes = Number.isInteger(override.maxUploadBytes) && override.maxUploadBytes > 0 ? override.maxUploadBytes : undefined;
  }
  return result;
}
