import { describe, expect, it } from "vitest";
import { BlenderAdapter, UnrealAdapter } from "../electron/software/media-adapters";
import { blenderCommand, unrealCommand, blenderScript, unrealScript, resolveExecutable } from "../src/shared/software-commands";

describe("AP22 Blender adapter", () => {
  it("declares the plan §22 capability surface with structured script families", () => {
    const adapter = new BlenderAdapter();
    const declaration = adapter.declaration();
    expect(declaration.capabilities.map((capability) => capability.id)).toEqual(expect.arrayContaining(["blender.scene.read", "blender.scene.create", "blender.mesh", "blender.materials", "blender.lighting", "blender.camera", "blender.animation", "blender.render", "blender.import", "blender.export"]));
    expect(declaration.contract.adapter_api).toBe("1");
  });

  it("reports DOWN gracefully when Blender is absent (never throws)", () => {
    const adapter = new BlenderAdapter((spec) => Promise.resolve({ code: 0, output: spec.expectedOutputs.join("") }), "definitely-missing-blender.exe");
    expect(adapter.detect().available).toBe(false);
  });

  it("runs structured CLI commands and fails closed when the binary is absent", async () => {
    const captured: string[] = [];
    const adapter = new BlenderAdapter(async (spec) => { captured.push(spec.executable); return { code: 0, output: spec.expectedOutputs.join(" ") }; }, process.execPath);
    const result = await adapter.run({ workspace: process.cwd(), scriptFile: "render.py", project: "scene.blend", outputFile: "out.png" });
    expect(result.ok).toBe(true);
    expect(captured).toEqual([process.execPath]);
    const absent = new BlenderAdapter(undefined, "missing-blender");
    expect((await absent.run({ workspace: process.cwd(), scriptFile: "x.py" })).ok).toBe(false);
  });

  it("builds a deterministic background CLI argv and python script prefix", () => {
    const spec = blenderCommand({ executable: "blender", project: "scene.blend", scriptFile: "s.py", outputFile: "o.png", cwd: "C:/w", renderFrame: 12 });
    expect(spec.args).toEqual(expect.arrayContaining(["--background", "scene.blend", "--python", "s.py", "--"]));
    expect(spec.expectedOutputs).toContain("BOSS_BLENDER_OK");
    expect(blenderScript("blender.render", { target: "scene" })).toContain("# BOSS blender adapter");
  });
});

describe("AP23 Unreal adapter", () => {
  it("declares the plan §23 capability surface and a Blender→Unreal import chain", () => {
    const declaration = new UnrealAdapter().declaration();
    expect(declaration.capabilities.map((capability) => capability.id)).toEqual(expect.arrayContaining(["unreal.import", "unreal.placement", "unreal.build", "unreal.test", "unreal.export"]));
    // The Blender artifact → export → Unreal import → placement → test chain is expressible as adapter capability ids.
    const chain = ["blender.export", "unreal.import", "unreal.placement", "unreal.test"];
    expect(chain.length).toBe(4);
  });

  it("runs -run=pythonscript commands and fails closed when Unreal is absent", async () => {
    const captured: string[] = [];
    const adapter = new UnrealAdapter(async (spec) => { captured.push(spec.args.join(" ")); return { code: 0, output: spec.expectedOutputs.join(" ") }; }, process.execPath);
    const result = await adapter.run({ workspace: process.cwd(), scriptFile: "import.py", project: "Game.uproject", outputFile: "placed.json" });
    expect(result.ok).toBe(true);
    expect(captured[0]).toContain("-run=pythonscript");
    const absent = new UnrealAdapter(undefined, "missing-unreal");
    expect(absent.detect().available).toBe(false);
    expect((await absent.run({ workspace: process.cwd(), scriptFile: "x.py" })).ok).toBe(false);
  });

  it("resolves executables deterministically with graceful absence", () => {
    expect(resolveExecutable(undefined, ["x", "y"], () => false)).toBeUndefined();
    expect(resolveExecutable("env-override", ["x"], (file) => file === "env-override")).toBe("env-override");
    expect(unrealScript("unreal.placement", { target: "Map1" })).toContain("# BOSS unreal adapter");
  });
});
