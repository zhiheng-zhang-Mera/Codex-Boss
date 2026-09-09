import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { RemoteChannel, RemoteChannelSetting, RemoteChannelStatus } from "../src/shared/contracts";

export type RelayRecord =
  | { type: "status"; channel: RemoteChannel; status: Exclude<RemoteChannelStatus, "disabled">; message: string }
  | { type: "command"; channel: RemoteChannel; body: string; sourceWindow: string };

export function parseRelayLine(line: string): RelayRecord | null {
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

export class RemoteCommandRelay {
  private readonly processes = new Map<RemoteChannel, { child: ChildProcessWithoutNullStreams; commandPrefix: string }>();
  private readonly stopping = new WeakSet<ChildProcessWithoutNullStreams>();

  constructor(
    private readonly scriptPath: string,
    private readonly onStatus: (channel: RemoteChannel, status: RemoteChannelStatus, message: string) => void,
    private readonly onCommand: (channel: RemoteChannel, body: string, sourceWindow: string) => void
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
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", this.scriptPath, "-Channel", channel, "-CommandPrefix", commandPrefix], {
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

  private handleRecord(record: RelayRecord | null): void {
    if (!record) return;
    if (record.type === "status") this.onStatus(record.channel, record.status, record.message);
    else this.onCommand(record.channel, record.body, record.sourceWindow);
  }
}
