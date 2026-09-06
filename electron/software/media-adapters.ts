import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { blenderCommand, unrealCommand, resolveExecutable, type AdapterCommandSpec } from "../../src/shared/software-commands";
import type { SoftwareAdapterDeclaration, SoftwareHealth } from "../../src/shared/software-adapter";

/**
 * Blender adapter (plan AP22) + Unreal adapter (plan AP23).
 *
 * Both adapters follow the AP21 declaration surface and the control hierarchy:
 *  - Blender: native CLI/bpy background → addon bridge → semantic GUI fallback;
 *  - Unreal: Python Editor Scripting / Remote Control → CLI/build → GUI fallback.
 * Commands are ALWAYS structured (`execFile(executable, args)` from
 * software-commands) — never a shell string produced by a model. Detection is
 * graceful: when the executable is absent the adapter reports DOWN with a
 * clear message instead of throwing into the caller (mirrors CodexCliRuntime).
 */

export type SoftwareRunner = (spec: AdapterCommandSpec) => Promise<{ code: number; output: string }>;

export function defaultRunner(spec: AdapterCommandSpec): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => execFile(spec.executable, spec.args, { cwd: spec.cwd, windowsHide: true, timeout: spec.timeoutMs, maxBuffer: 2000000 }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, output: `${String(stdout)}\n${String(stderr)}`.trim() })));
}

function blenderCandidates(): string[] {
  const local = process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "Programs", "Blender Foundation", "Blender", "blender.exe")] : [];
  const programs = process.env.ProgramFiles ? [path.join(process.env.ProgramFiles, "Blender Foundation", "Blender", "blender.exe")] : [];
  return [...local, ...programs, "blender"];
}

function unrealCandidates(): string[] {
  const programs = process.env.ProgramFiles ? [path.join(process.env.ProgramFiles, "Epic Games", "Editor.bat")] : [];
  return [...programs, "UnrealEditor-Cmd.exe", "UnrealEditor.exe"];
}

export class BlenderAdapter {
  readonly id = "blender";
  readonly kind = "blender";
  readonly version = "1";
  readonly contract = { adapter_api: "1", capability_contract: "1" } as const;
  readonly capabilities = [
    { id: "blender.scene.read", family: "script" as const, readsOnly: true },
    { id: "blender.scene.create", family: "script" as const, readsOnly: false },
    { id: "blender.mesh", family: "script" as const, readsOnly: false },
    { id: "blender.materials", family: "script" as const, readsOnly: false },
    { id: "blender.lighting", family: "script" as const, readsOnly: false },
    { id: "blender.camera", family: "script" as const, readsOnly: false },
    { id: "blender.animation", family: "script" as const, readsOnly: false },
    { id: "blender.render", family: "cli" as const, readsOnly: false },
    { id: "blender.import", family: "script" as const, readsOnly: false },
    { id: "blender.export", family: "cli" as const, readsOnly: false }
  ] as const;
  private executable: string | undefined;
  constructor(private readonly runner: SoftwareRunner = defaultRunner, configured?: string) { this.executable = resolveExecutable(configured, blenderCandidates(), (file) => fs.existsSync(file)); }

  declaration(): SoftwareAdapterDeclaration { return { id: this.id, kind: this.kind, version: this.version, capabilities: this.capabilities, contract: this.contract }; }

  detect(): SoftwareHealth {
    if (!this.executable) return { id: this.id, available: false, message: "Blender executable not found", checkedAt: new Date().toISOString() };
    return { id: this.id, available: true, message: `Blender at ${this.executable}`, checkedAt: new Date().toISOString() };
  }

  /** Runs a structured blender command in a workspace (project + python file). */
  async run(input: { workspace: string; scriptFile: string; project?: string; outputFile?: string; renderFrame?: number; timeoutMs?: number }): Promise<{ ok: boolean; output: string }> {
    if (!this.executable) return { ok: false, output: "Blender executable not found" };
    const spec = blenderCommand({ executable: this.executable, project: input.project, scriptFile: input.scriptFile, outputFile: input.outputFile, renderFrame: input.renderFrame, cwd: fs.realpathSync(input.workspace), timeoutMs: input.timeoutMs });
    const result = await this.runner(spec);
    const ok = result.code === 0 && spec.expectedOutputs.every((marker) => result.output.includes(marker));
    return { ok, output: result.output.slice(0, 20000) };
  }
}

export class UnrealAdapter {
  readonly id = "unreal";
  readonly kind = "unreal";
  readonly version = "1";
  readonly contract = { adapter_api: "1", capability_contract: "1" } as const;
  readonly capabilities = [
    { id: "unreal.scene.read", family: "script" as const, readsOnly: true },
    { id: "unreal.scene.create", family: "script" as const, readsOnly: false },
    { id: "unreal.import", family: "cli" as const, readsOnly: false },
    { id: "unreal.placement", family: "script" as const, readsOnly: false },
    { id: "unreal.build", family: "cli" as const, readsOnly: false },
    { id: "unreal.test", family: "cli" as const, readsOnly: false },
    { id: "unreal.export", family: "cli" as const, readsOnly: false }
  ] as const;
  private executable: string | undefined;
  constructor(private readonly runner: SoftwareRunner = defaultRunner, configured?: string) { this.executable = resolveExecutable(configured, unrealCandidates(), (file) => fs.existsSync(file)); }

  declaration(): SoftwareAdapterDeclaration { return { id: this.id, kind: this.kind, version: this.version, capabilities: this.capabilities, contract: this.contract }; }

  detect(): SoftwareHealth {
    if (!this.executable) return { id: this.id, available: false, message: "Unreal executable not found", checkedAt: new Date().toISOString() };
    return { id: this.id, available: true, message: `Unreal at ${this.executable}`, checkedAt: new Date().toISOString() };
  }

  /** Runs a structured Unreal command (project + python script via -run=pythonscript). */
  async run(input: { workspace: string; scriptFile: string; project?: string; outputFile?: string; timeoutMs?: number }): Promise<{ ok: boolean; output: string }> {
    if (!this.executable) return { ok: false, output: "Unreal executable not found" };
    const spec = unrealCommand({ executable: this.executable, project: input.project, scriptFile: input.scriptFile, outputFile: input.outputFile, cwd: fs.realpathSync(input.workspace), timeoutMs: input.timeoutMs });
    const result = await this.runner(spec);
    const ok = result.code === 0 && spec.expectedOutputs.every((marker) => result.output.includes(marker));
    return { ok, output: result.output.slice(0, 20000) };
  }
}
