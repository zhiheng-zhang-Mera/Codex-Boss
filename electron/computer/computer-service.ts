import { resolveVSCodeCli } from "./backends/vscode-cli";
import { VisionBackend, type VisionSurface, type VisionProposal } from "./backends/vision";
import fs from "node:fs";
import path from "node:path";
import { SemanticRuntime, type SemanticBackend } from "./semantic-runtime";
import { WindowsUiaBackend, type ApplicationSpec } from "./backends/windows-uia";
import { StructuredApplicationsBackend, type StructuredOptions } from "./backends/structured-apps";
import { DomPageBackend, type DomPageSurface } from "./backends/dom-page";
import type { PermissionManifest } from "../../src/shared/permission";
export function findVSCodeExecutable(): string | undefined {
  const candidates = [
    process.env.CODEX_BOSS_VSCODE_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe") : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe") : undefined,
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).flatMap((entry) => {
      const directory = entry.replace(/^"|"$/g, "");
      return [path.join(directory, "Code.exe"), ...(fs.existsSync(path.join(directory, "code.cmd")) ? [path.resolve(directory, "..", "Code.exe")] : [])];
    })
  ];
  return candidates.find((file): file is string => Boolean(file && fs.existsSync(file) && resolveVSCodeCli(file)));
}
export interface ComputerOptions extends StructuredOptions {
  visionSurface?: VisionSurface;
  authorizeVision?: (proposal: VisionProposal) => Promise<boolean>;
  /** Resolves the workspace permission manifest for desktop side-effect gating (plan §17/§18). */
  permissionForWorkspace?: (workspace: string) => PermissionManifest | undefined;
  /** Visible page surface for the §8.2 DOM mutation/read tier (provider WebContentsView). */
  domPageSurface?: DomPageSurface;
}
export function createComputerRuntime(workspace: string, stateFile: string, options: ComputerOptions = {}): SemanticRuntime {
  const windows = process.env.WINDIR ?? "C:\\Windows";
  const vscode = options.vscodeExecutable ?? findVSCodeExecutable();
  const apps: Record<string, ApplicationSpec> = { notepad: { executable: path.join(windows, "System32", "notepad.exe") }, explorer: { executable: path.join(windows, "explorer.exe"), args: [workspace] } };
  if (vscode) apps.vscode = { executable: vscode, args: [workspace] };
  const backends: SemanticBackend[] = [new WindowsUiaBackend(apps), new StructuredApplicationsBackend(workspace, { ...options, vscodeExecutable: vscode })];
  if (options.domPageSurface) backends.push(new DomPageBackend(options.domPageSurface)); // §8.2 DOM tier (priority: dom > uia/structured)
  if (options.visionSurface) backends.push(new VisionBackend(options.visionSurface, options.authorizeVision ?? (async () => false)));
  return new SemanticRuntime(backends, stateFile);
}
