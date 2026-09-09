import { describe, expect, it } from "vitest";
import type { SoftwareAction, SoftwareAdapterDeclaration } from "../src/shared/software-adapter";
import { adapterSupports, capabilityFor, planSoftwareActions, validateSoftwareAction } from "../src/shared/software-adapter";
import { SoftwareSessionRegistry } from "../electron/software/software-runtime";
import { EMPTY_MANIFEST } from "../src/shared/permission";

const blender: SoftwareAdapterDeclaration = {
  id: "blender", kind: "blender", version: "1", contract: { adapter_api: "1", capability_contract: "1" },
  capabilities: [
    { id: "blender.scene.read", family: "script", readsOnly: true },
    { id: "blender.mesh", family: "script", readsOnly: false },
    { id: "blender.render", family: "cli", readsOnly: false }
  ]
};

const sideEffectAllowed = { ...EMPTY_MANIFEST, "side-effect": { allow: ["blender:blender.open", "blender:blender.mesh", "blender:blender.render", "blender:blender.verify"], deny: [] } };

function fakeExecutor(script: Record<string, { status: "SUCCESS" | "FAILED" }>) {
  return {
    async run(action: SoftwareAction) { const result = script[action.capability] ?? { status: "SUCCESS" as const }; return { at: new Date(0).toISOString(), evidence: action.capability, status: result.status }; }
  };
}

describe("software adapter contracts (AP21 pure)", () => {
  it("looks capabilities up fail-closed and validates actions", () => {
    expect(adapterSupports(blender, "blender.render")).toBe(true);
    expect(adapterSupports(blender, "blender.unknown")).toBe(false);
    expect(capabilityFor(blender, "blender.scene.read")?.readsOnly).toBe(true);
    expect(() => validateSoftwareAction({ kind: "explode" as never, capability: "x", params: {} })).toThrow();
    expect(() => validateSoftwareAction({ kind: "command", capability: "", params: {} })).toThrow();
    expect(() => validateSoftwareAction({ kind: "command", capability: "ok", params: { a: 1 } })).not.toThrow();
  });

  it("plans deterministic bounded actions and rejects unknown capabilities", () => {
    const plan = planSoftwareActions(blender, ["blender.render", "blender.scene.read"]);
    expect(plan.actions[0].kind).toBe("open");
    expect(plan.actions.at(-1)?.kind).toBe("verify");
    // Reads are ordered before mutations.
    expect(plan.actions[1].capability).toBe("blender.scene.read");
    expect(plan.actions[2].capability).toBe("blender.render");
    expect(() => planSoftwareActions(blender, ["nope"])).toThrow(/cannot/);
  });
});

describe("generic software runtime (AP21 electron)", () => {
  it("runs a permission-gated plan under an exclusive lease and verifies", async () => {
    const registry = new SoftwareSessionRegistry(blender, fakeExecutor({ "blender.mesh": { status: "SUCCESS" } }));
    const plan = registry.plan(["blender.mesh"]);
    const result = await registry.run({ actions: plan.actions, permission: sideEffectAllowed, lease: { ownerTask: "t1", target: "blender-main" } });
    expect(result.observations).toHaveLength(3);
    expect(result.verification.passed).toBe(true);
    expect(registry.listExchanges()).toEqual([]);
  });

  it("denies mutations the workspace manifest does not allow", async () => {
    const registry = new SoftwareSessionRegistry(blender, fakeExecutor({}));
    const plan = registry.plan(["blender.mesh"]);
    await expect(registry.run({ actions: plan.actions, permission: EMPTY_MANIFEST })).rejects.toThrow(/Permission gate denied/);
  });

  it("records health + artifact exchanges and isolates adapter failure", async () => {
    const registry = new SoftwareSessionRegistry(blender, fakeExecutor({ "blender.render": { status: "FAILED" } }));
    registry.setHealth({ id: "blender", available: true, message: "probed", checkedAt: new Date(0).toISOString() });
    expect(registry.health().available).toBe(true);
    const plan = registry.plan(["blender.scene.read", "blender.render"]);
    const result = await registry.run({ actions: plan.actions, permission: sideEffectAllowed, lease: { ownerTask: "t1", target: "blender-main" } });
    expect(result.verification.passed).toBe(false);
    registry.recordExchange({ artifactId: "a1", adapterId: "blender", direction: "export", format: "gltf", targetId: "render-1" });
    expect(registry.listExchanges()).toHaveLength(1);
  });
});
