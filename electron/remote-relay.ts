import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { RemoteChannel, RemoteChannelSetting, RemoteChannelStatus } from "../src/shared/contracts";

type RelayRecord =
  | { type: "status"; channel: RemoteChannel; status: Exclude<RemoteChannelStatus, "disabled">; message: string }
  | { type: "command"; channel: RemoteChannel; body: string; sourceWindow: string };

/**
 * Parse one line of the relay script's stdout.
 *
 * Exported because it is the relay's whole input contract and it is PURE: given a line, this decides
 * what the platform will believe. It was module-private and therefore untested — the `remote`
 * capability had no authoritative suite at all (PF-DEBT-002) — and the parsing rules are exactly the
 * part that must not drift: an unrecognized channel, a missing field or a malformed record has to be
 * refused rather than half-accepted.
 *
 * Returns `unknown` on purpose: the shape is asserted by the tests that exercise it, so the union does
 * not need to be part of the module's published surface.
 */
export function parseRelayLine(line: string): unknown {
  try {
    const value = JSON.parse(line) as Partial<RelayRecord>;
    if (value.channel !== "wechat" && value.channel !== "qq") return null;
    if (value.type === "status" && ["waiting", "ready", "error"].includes(String(value.status)) && typeof value.message === "string") return value as RelayRecord;
    if (value.type === "command" && typeof value.body === "string" && value.body.trim() && typeof value.sourceWindow === "string") return { type: "command", channel: value.channel, body: value.body.trim().slice(0, 10000), sourceWindow: value.sourceWindow.slice(0, 200) };
    return null;
  } catch {
    return null;
  }
}

/** How a relay child process is launched. Injectable so the relay's own behaviour is testable. */
type RelaySpawn = (command: string, args: string[], options: { windowsHide: boolean; stdio: ["pipe", "pipe", "pipe"] }) => ChildProcessWithoutNullStreams;

export class RemoteCommandRelay {
  private readonly processes = new Map<RemoteChannel, { child: ChildProcessWithoutNullStreams; commandPrefix: string }>();
  private readonly stopping = new WeakSet<ChildProcessWithoutNullStreams>();

  constructor(
    private readonly scriptPath: string,
    private readonly onStatus: (channel: RemoteChannel, status: RemoteChannelStatus, message: string) => void,
    private readonly onCommand: (channel: RemoteChannel, body: string, sourceWindow: string) => void,
    /**
     * The launcher. Defaults to the real `spawn`; a test injects one so the relay's lifecycle —
     * dedupe by command prefix, status reporting, command forwarding, exit handling, disposal — is
     * exercised without claiming to have verified a PowerShell script this host may not run.
     */
    private readonly spawnChild: RelaySpawn = spawn as unknown as RelaySpawn
  ) {}

  sync(settings: RemoteChannelSetting[]): void {
    for (const channel of ["wechat", "qq"] as const) {
      const setting = settings.find((item) => item.channel === channel);
      if (setting?.enabled) this.start(channel, setting.commandPrefix);
      else this.stop(channel);
    }
  }

  dispose(): void {
    for (const channel of [...this.processes.keys()]) this.stop(channel);
  }

  private start(channel: RemoteChannel, commandPrefix: string): void {
    const existing = this.processes.get(channel);
    if (existing?.commandPrefix === commandPrefix) return;
    if (existing) this.stop(channel);
    const child = this.spawnChild("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", this.scriptPath, "-Channel", channel, "-CommandPrefix", commandPrefix], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.end();
    this.processes.set(channel, { child, commandPrefix });
    this.onStatus(channel, "waiting", "正在查找已登录的桌面客户端窗口");
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) this.handleRecord(parseRelayLine(line));
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-1000); });
    child.on("error", (error) => {
      if (this.processes.get(channel)?.child === child) this.processes.delete(channel);
      this.onStatus(channel, "error", `无法启动本机监听器：${error.message}`);
    });
    child.on("exit", (code) => {
      if (this.processes.get(channel)?.child === child) this.processes.delete(channel);
      if (this.stopping.has(child)) return;
      this.onStatus(channel, "error", `本机监听器已退出 (${code ?? "unknown"})${stderr.trim() ? `：${stderr.trim()}` : ""}`);
    });
  }

  private stop(channel: RemoteChannel): void {
    const running = this.processes.get(channel);
    if (!running) return;
    const { child } = running;
    this.stopping.add(child);
    child.kill();
    this.processes.delete(channel);
    this.onStatus(channel, "disabled", "远程指令监听已关闭");
  }

  /** Narrow a parsed line back to the record union. A line that is not a record is dropped, not guessed. */
  private handleRecord(record: unknown): void {
    if (!record || typeof record !== "object") return;
    const value = record as RelayRecord;
    if (value.type === "status") this.onStatus(value.channel, value.status, value.message);
    else if (value.type === "command") this.onCommand(value.channel, value.body, value.sourceWindow);
  }
}
