import { resolveVSCodeCli } from "./vscode-cli";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { workspacePath, executeNative } from "../../engineering/native-tools";
import type { SemanticAction, SemanticBackend, SemanticResult } from "../semantic-runtime";
export interface StructuredOptions { vscodeExecutable?: string; vscodeUserDataDir?: string; readBrowser?: (providerId: string) => Promise<unknown>; }
export class StructuredApplicationsBackend implements SemanticBackend {
  readonly kind = "structured" as const;
  constructor(private readonly workspace: string, private readonly options: StructuredOptions = {}) {}
  supports(action: SemanticAction): boolean { return ["read_page", "find_control", "verify_state"].includes(action.name) && /^(?:explorer|terminal|git|vscode|browser):/.test(action.target); }
  async execute(action: SemanticAction, signal: AbortSignal): Promise<SemanticResult> {
    if (!this.supports(action)) return { status: "UNSUPPORTED" };
    if (signal.aborted) return { status: "FAILED", message: "Cancelled" };
    if (action.name === "verify_state" && !(action.expected ?? action.value)) return { status: "FAILED", message: "Expected state required" };
    const split = action.target.indexOf(":"); const app = action.target.slice(0, split); const target = action.target.slice(split + 1);
    let evidence: unknown;
    if (app === "explorer") { const directory = workspacePath(this.workspace, target || "."); evidence = { source: "filesystem", directory, entries: fs.readdirSync(directory, { withFileTypes: true }).slice(0, 2000).map((entry) => ({ name: entry.name, directory: entry.isDirectory() })) }; }
    else if (app === "terminal") { const file = workspacePath(this.workspace, target); const size = fs.statSync(file).size; if (size > 1000000) throw new Error("Terminal log exceeds read budget"); evidence = { source: "terminal_log", file, text: fs.readFileSync(file, "utf8").slice(-30000) }; }
    else if (app === "git") { if (!["status", "diff"].includes(target)) return { status: "UNSUPPORTED" }; evidence = await executeNative(this.workspace, { kind: target === "status" ? "git_status" : "git_diff" }); }
    else if (app === "browser") { if (!/^[a-zA-Z0-9_-]+$/.test(target) || !this.options.readBrowser) return { status: "UNSUPPORTED" }; evidence = { source: "browser_dom", providerId: target, state: await this.options.readBrowser(target) }; }
    else {
      const executable = this.options.vscodeExecutable;
      if (target !== "status" || !executable || !fs.existsSync(executable)) return { status: "UNSUPPORTED", message: "VS Code CLI unavailable" };
      const cli = resolveVSCodeCli(executable);
      if (!cli) return { status: "UNSUPPORTED", message: "VS Code CLI entry unavailable" };
      const output = await new Promise<string>((resolve, reject) => execFile(executable, [cli, "--status", ...(this.options.vscodeUserDataDir ? ["--user-data-dir", this.options.vscodeUserDataDir] : [])], { cwd: this.workspace, windowsHide: true, signal, timeout: 15000, maxBuffer: 1000000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }, (error, stdout, stderr) => error ? reject(new Error(String(stderr) || error.message)) : resolve(stdout)));
      if (/--status argument can only be used if Code is already running/i.test(output)) return { status: "UNSUPPORTED", message: "VS Code is installed but not running", evidence: { source: "vscode_cli_status", output } };
      evidence = { source: "vscode_cli_status", output };
    }
    if (action.name === "verify_state" && !JSON.stringify(evidence).includes(action.expected ?? action.value ?? "")) return { status: "FAILED", evidence, message: "Expected structured state absent" };
    return { status: "SUCCESS", evidence };
  }
}
