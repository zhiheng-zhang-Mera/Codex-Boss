/**
 * Engine Phase 3 evidence test — model identity observation.
 *
 * Acceptance: A13 (explicit model recorded), A14 (Web Auto recorded as Auto,
 * backend id never fabricated), A15 (unobservable backend stays undefined),
 * A16 (same conversation, different turns ⇒ different snapshots), A17 (identical
 * identity dedups to one snapshot), A18 (new model id ⇒ new snapshot, no
 * pollution of the old one), A49 (legacy adapter without model fields).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MODEL_IDENTITY_SOURCE_CONFIDENCE,
  MODEL_IDENTITY_SOURCE_ORDER,
  modelIdentityFingerprint,
  provenanceOf,
  type ModelExecutionIdentity
} from "../../src/shared/model-identity";
import { ModelObserver } from "../../electron/learning/providers/model-observer";
import { ModelSnapshotRegistry } from "../../electron/learning/providers/model-snapshot";
import { resolveModelIdentity } from "../../electron/learning/providers/version-resolver";

const at = "2026-09-10T00:00:00.000Z";

describe("Phase 3 — source trust order", () => {
  it("ranks structured metadata above UI, declarations and inference", () => {
    const order = MODEL_IDENTITY_SOURCE_ORDER;
    expect(order.indexOf("NETWORK_METADATA")).toBeLessThan(order.indexOf("UI_SELECTOR"));
    expect(order.indexOf("PAGE_METADATA")).toBeLessThan(order.indexOf("PROVIDER_DECLARED"));
    expect(order.indexOf("INFERRED")).toBeGreaterThan(order.indexOf("PROVIDER_DECLARED"));
    expect(MODEL_IDENTITY_SOURCE_CONFIDENCE.NETWORK_METADATA).toBeGreaterThan(MODEL_IDENTITY_SOURCE_CONFIDENCE.UI_SELECTOR);
    expect(MODEL_IDENTITY_SOURCE_CONFIDENCE.UI_SELECTOR).toBeGreaterThan(MODEL_IDENTITY_SOURCE_CONFIDENCE.PROVIDER_DECLARED);
  });

  it("a self-reported textual claim cannot outrank a structured observation", () => {
    const resolved = resolveModelIdentity({
      provider: "chatgpt",
      surface: "web",
      observedAt: at,
      candidates: [
        { source: "UI_SELECTOR", model: "gpt-x" },
        { source: "PROVIDER_DECLARED", model: "gpt-y", selfReported: true }
      ]
    });
    expect(resolved.identity.selectedModel).toBe("gpt-x");
    expect(resolved.identity.versionSource).toBe("UI_SELECTOR");
    expect(resolved.identity.confidence).toBeLessThanOrEqual(0.7);
  });
});

describe("Phase 3 — observer", () => {
  it("A13: records an explicitly selected model with provenance", () => {
    const observer = new ModelObserver();
    const result = observer.observe({ provider: "chatgpt", surface: "web", observedAt: at, uiSelectedModel: "gpt-5-pro", providerDeclaredModel: "GPT-5 Pro" });
    expect(result.identity.selectedModel).toBe("gpt-5-pro");
    expect(result.identity.declaredModel).toBe("GPT-5 Pro");
    expect(provenanceOf(result.identity)).toBe("OBSERVED");
    expect(result.identity.observedAt).toBe(at);
  });

  it("A14: Web Auto is recorded as Auto and no backend id is fabricated", () => {
    const observer = new ModelObserver();
    const result = observer.observe({ provider: "claude", surface: "web", observedAt: at, uiSelectedModel: "Auto" });
    expect(result.identity.selectedModel).toBe("Auto");
    expect(result.identity.mode).toBe("auto");
    expect(result.identity.observedModelId).toBeUndefined();
    expect(result.concrete).toBe(false);
  });

  it("A15: an unobservable backend stays undefined/UNKNOWN", () => {
    const observer = new ModelObserver();
    const result = observer.observe({ provider: "gemini", surface: "web", observedAt: at });
    expect(result.identity.observedModelId).toBeUndefined();
    expect(result.identity.versionSource).toBe("UNKNOWN");
    expect(result.identity.confidence).toBe(0);
    expect(provenanceOf(result.identity)).toBe("UNKNOWN");
  });

  it("A14/A15: structured metadata CAN observe a concrete backend even in Auto mode", () => {
    const observer = new ModelObserver();
    const result = observer.observe({ provider: "chatgpt", surface: "web", observedAt: at, uiSelectedModel: "Auto", networkModelId: "gpt-5-2026-08-01" });
    expect(result.identity.observedModelId).toBe("gpt-5-2026-08-01");
    expect(result.identity.versionSource).toBe("NETWORK_METADATA");
    expect(result.concrete).toBe(true);
    expect(result.evidence.some((line) => line.startsWith("observedModelId="))).toBe(true);
  });

  it("malformed metadata is ignored and reported, never thrown (A49 resilience)", () => {
    const observer = new ModelObserver();
    const result = observer.observe({ provider: "chatgpt", surface: "web", observedAt: at, networkModelId: { nested: true } as unknown, uiSelectedModel: 42 });
    expect(result.ignored.join(" ")).toContain("unusable");
    expect(result.identity.selectedModel).toBe("42"); // numeric selector text is usable
    expect(result.identity.versionSource).toBe("UI_SELECTOR");
  });

  it("A49: a legacy adapter with no model information still yields a usable identity", () => {
    const observer = new ModelObserver();
    const identity = observer.unobserved("local:native", "local", at);
    expect(identity.provider).toBe("local:native");
    expect(identity.versionSource).toBe("UNKNOWN");
    expect(identity.confidence).toBe(0);
  });
});

describe("Phase 3 — snapshot registry", () => {
  function identity(overrides: Partial<ModelExecutionIdentity> = {}): ModelExecutionIdentity {
    return { provider: "chatgpt", surface: "web", selectedModel: "gpt-5", observedModelId: "gpt-5-2026-08-01", mode: "selected", versionSource: "NETWORK_METADATA", confidence: 1, observedAt: at, ...overrides };
  }

  it("A17: identical identity dedups to one snapshot with an advancing lastObservedAt", () => {
    const registry = new ModelSnapshotRegistry(undefined, () => at);
    const first = registry.record(identity());
    const second = registry.record(identity({ observedAt: "2026-09-10T05:00:00.000Z" }));
    expect(second.id).toBe(first.id);
    expect(registry.count()).toBe(1);
    expect(registry.get(first.id)?.lastObservedAt).toBe("2026-09-10T05:00:00.000Z");
  });

  it("A18: a new observed model id creates a new snapshot without touching the old one", () => {
    const registry = new ModelSnapshotRegistry(undefined, () => at);
    const old = registry.record(identity());
    const next = registry.record(identity({ observedModelId: "gpt-6-2026-12-01", observedAt: "2026-09-11T00:00:00.000Z" }));
    expect(next.id).not.toBe(old.id);
    expect(registry.count()).toBe(2);
    expect(registry.get(old.id)?.identity.observedModelId).toBe("gpt-5-2026-08-01"); // old history intact
  });

  it("A16: one conversation may bind several snapshots across turns", () => {
    const registry = new ModelSnapshotRegistry(undefined, () => at);
    const turn1 = registry.record(identity({ selectedModel: "gpt-5", observedModelId: "gpt-5-2026-08-01" }));
    const turn2 = registry.record(identity({ selectedModel: "Auto", observedModelId: undefined, versionSource: "UNKNOWN", confidence: 0 }));
    const turn3 = registry.record(identity({ selectedModel: "gpt-5-mini", observedModelId: "gpt-5-mini-2026-08-01" }));
    const ids = new Set([turn1.id, turn2.id, turn3.id]);
    expect(ids.size).toBe(3); // identity belongs to the invocation, not the conversation
  });

  it("fingerprint ignores timestamps (dedup is identity-based)", () => {
    const a = modelIdentityFingerprint({ ...identity(), observedAt: at } as ModelExecutionIdentity);
    const b = modelIdentityFingerprint({ ...identity(), observedAt: "2030-01-01T00:00:00.000Z" } as ModelExecutionIdentity);
    expect(a).toBe(b);
  });

  it("durable restart restores snapshots and dedup state", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p3-"));
    const file = path.join(dir, "snapshots.json");
    try {
      const first = new ModelSnapshotRegistry(file, () => at);
      const snapshot = first.record(identity());
      const second = new ModelSnapshotRegistry(file, () => at);
      expect(second.get(snapshot.id)?.fingerprint).toBe(snapshot.fingerprint);
      expect(second.record(identity()).id).toBe(snapshot.id); // dedup survives restart
      expect(second.count()).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("corrupt snapshot file degrades learning without throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p3-bad-"));
    const file = path.join(dir, "snapshots.json");
    try {
      fs.writeFileSync(file, "{ broken", "utf8");
      const registry = new ModelSnapshotRegistry(file, () => at);
      expect(registry.count()).toBe(0);
      expect(registry.status().degradedReason).toContain("unreadable");
      const snapshot = registry.record(identity()); // still usable afterwards
      expect(snapshot.id).toBe("MS-001");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
