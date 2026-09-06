/**
 * Provider capability registry (plan 9-7 §7). Durable per-provider override
 * store over the shared deterministic baseline. Capabilities are runtime
 * metadata owned by Boss — the UI never asks the user to pick capabilities.
 */
import fs from "node:fs";
import path from "node:path";
import type { ProviderId } from "../../src/shared/contracts";
import {
  baselineProfileFor,
  mergeCapabilityProfiles,
  noProviderCapabilities,
  type ProviderCapabilities,
  type ProviderCapabilityProfile
} from "../../src/shared/provider-capabilities";
import { readJson, writeJson } from "../commander/durable-json";

interface CapabilityRegistryFile {
  schemaVersion: 1;
  profiles: Record<string, ProviderCapabilities>;
  verifiedBy: Record<string, string>;
}

export class ProviderCapabilityRegistry {
  private readonly filePath: string;
  private profiles = new Map<ProviderId, ProviderCapabilityProfile>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.restore();
  }

  private restore(): void {
    try {
      const saved = readJson<CapabilityRegistryFile>(this.filePath);
      if (!saved || saved.schemaVersion !== 1) return;
      for (const providerId of Object.keys(saved.profiles)) {
        this.profiles.set(providerId, {
          providerId,
          capabilities: { ...noProviderCapabilities(), ...saved.profiles[providerId] },
          verifiedBy: saved.verifiedBy[providerId] ?? "restored",
          updatedAt: new Date().toISOString()
        });
      }
    } catch {
      this.profiles.clear();
    }
  }

  /** Current capability set for a provider: baseline ∪ overrides. */
  capabilitiesFor(providerId: ProviderId): ProviderCapabilities {
    const baseline = baselineProfileFor(providerId).capabilities;
    const override = this.profiles.get(providerId)?.capabilities;
    return override ? mergeCapabilityProfiles(baseline, override) : baseline;
  }

  profileFor(providerId: ProviderId): ProviderCapabilityProfile {
    const baseline = baselineProfileFor(providerId);
    const override = this.profiles.get(providerId);
    if (!override) return baseline;
    return { providerId, capabilities: this.capabilitiesFor(providerId), verifiedBy: override.verifiedBy, updatedAt: override.updatedAt };
  }

  /** Applies an operator/verification override for one provider and persists. */
  setOverride(providerId: ProviderId, override: Partial<ProviderCapabilities>, verifiedBy: string): ProviderCapabilityProfile {
    const merged = mergeCapabilityProfiles(this.capabilitiesFor(providerId), override);
    this.profiles.set(providerId, { providerId, capabilities: merged, verifiedBy, updatedAt: new Date().toISOString() });
    this.persist();
    return this.profileFor(providerId);
  }

  /** Drops overrides and returns the provider to its deterministic baseline. */
  reset(providerId: ProviderId): ProviderCapabilityProfile {
    this.profiles.delete(providerId);
    this.persist();
    return this.profileFor(providerId);
  }

  private persist(): void {
    const file: CapabilityRegistryFile = { schemaVersion: 1, profiles: {}, verifiedBy: {} };
    for (const [providerId, profile] of this.profiles) {
      file.profiles[providerId] = profile.capabilities;
      file.verifiedBy[providerId] = profile.verifiedBy;
    }
    writeJson(this.filePath, file);
  }
}
