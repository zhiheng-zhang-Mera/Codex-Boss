import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RemoteCommandRelay, parseRelayLine } from "../../electron/remote-relay";
import type { RemoteChannel, RemoteChannelSetting, RemoteChannelStatus } from "../../src/shared/contracts";

/**
 * Authoritative suite for the `remote` capability (PF-DEBT-002).
 *
 * Phase 05 §11 recorded that `remote-relay.ts` was named only by an import-boundary check, so the
 * relay's real behaviour — what it believes from the listener, when it starts and stops a channel, and
 * what it forwards into Boss — had no authoritative evidence.
 *
 * ## What is authoritative here, and what is explicitly NOT
 *
 * The relay owns two separable things:
 *
 *  1. **The input contract** — `parseRelayLine`. Given a line of the listener's stdout, what will the
 *     platform believe? This is pure and fully covered below, including the refusals.
 *  2. **The channel lifecycle** — start, dedupe, stop, forward, report. Covered below against an
 *     injected launcher, so the relay's own decisions are exercised deterministically.
 *
 * What is NOT covered, named rather than implied: the PowerShell listener `scripts/pc-chat-relay.ps1`
 * and the Windows desktop automation it drives. That requires a logged-in WeChat/QQ desktop client on a
 * Windows host, and no test on this machine can honestly claim to have verified it. The relay treats
 * that script as an untrusted line producer, which is exactly why the parsing contract above is
 * authoritative on its own.
 */

/** A controllable stand-in for a spawned relay process. */
class FakeChild extends EventEmitter {
  readonly stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  readonly stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  readonly stdin = { end: vi.fn() };
  readonly kill = vi.fn();
  /** Emit a chunk of stdout, as the real child would. */
  emitStdout(chunk: string): void {
    this.stdout.emit("data", chunk);
  }
  emitStderr(chunk: string): void {
    this.stderr.emit("data", chunk);
  }
  emitExit(code: number | null): void {
    this.emit("exit", code);
  }
}

interface Harness {
  relay: RemoteCommandRelay;
  children: Array<{ channel: string; prefix: string; child: FakeChild }>;
  statuses: Array<{ channel: RemoteChannel; status: RemoteChannelStatus; message: string }>;
  commands: Array<{ channel: RemoteChannel; body: string; sourceWindow: string }>;
}

function harness(): Harness {
  const children: Harness["children"] = [];
  const statuses: Harness["statuses"] = [];
  const commands: Harness["commands"] = [];
  const spawnChild = (_command: string, args: string[]) => {
    const child = new FakeChild();
    const channel = args[args.indexOf("-Channel") + 1]!;
    const prefix = args[args.indexOf("-CommandPrefix") + 1]!;
    children.push({ channel, prefix, child });
    return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
  };
  const relay = new RemoteCommandRelay(
    "scripts/pc-chat-relay.ps1",
    (channel, status, message) => statuses.push({ channel, status, message }),
    (channel, body, sourceWindow) => commands.push({ channel, body, sourceWindow }),
    spawnChild as never
  );
  return { relay, children, statuses, commands };
}

const enabled = (channel: RemoteChannel, commandPrefix = "boss"): RemoteChannelSetting => ({ channel, enabled: true, commandPrefix } as RemoteChannelSetting);
const disabled = (channel: RemoteChannel): RemoteChannelSetting => ({ channel, enabled: false, commandPrefix: "" } as RemoteChannelSetting);

describe("Phase 06 — remote: the input contract refuses anything it cannot fully understand", () => {
  it("accepts a well-formed status record", () => {
    expect(parseRelayLine(JSON.stringify({ type: "status", channel: "wechat", status: "ready", message: "listening" })))
      .toEqual({ type: "status", channel: "wechat", status: "ready", message: "listening" });
  });

  it("accepts a well-formed command record and trims the body", () => {
    expect(parseRelayLine(JSON.stringify({ type: "command", channel: "qq", body: "  run the tests  ", sourceWindow: "Chat" })))
      .toEqual({ type: "command", channel: "qq", body: "run the tests", sourceWindow: "Chat" });
  });

  it("refuses a channel the platform does not serve", () => {
    // A new channel in the listener must not silently become a Boss channel.
    expect(parseRelayLine(JSON.stringify({ type: "command", channel: "telegram", body: "x", sourceWindow: "w" }))).toBeNull();
    expect(parseRelayLine(JSON.stringify({ type: "status", channel: "telegram", status: "ready", message: "x" }))).toBeNull();
  });

  it("refuses a status the platform does not model", () => {
    expect(parseRelayLine(JSON.stringify({ type: "status", channel: "wechat", status: "confused", message: "x" }))).toBeNull();
    // `disabled` is a state Boss derives from stopping a channel, never one the listener reports.
    expect(parseRelayLine(JSON.stringify({ type: "status", channel: "wechat", status: "disabled", message: "x" }))).toBeNull();
  });

  it("refuses a record missing a required field instead of half-accepting it", () => {
    expect(parseRelayLine(JSON.stringify({ type: "status", channel: "wechat", status: "ready" }))).toBeNull();
    expect(parseRelayLine(JSON.stringify({ type: "command", channel: "wechat", body: "x" }))).toBeNull();
    expect(parseRelayLine(JSON.stringify({ type: "command", channel: "wechat", sourceWindow: "w" }))).toBeNull();
  });

  it("refuses an empty or whitespace-only command", () => {
    expect(parseRelayLine(JSON.stringify({ type: "command", channel: "wechat", body: "   ", sourceWindow: "w" }))).toBeNull();
    expect(parseRelayLine(JSON.stringify({ type: "command", channel: "wechat", body: "", sourceWindow: "w" }))).toBeNull();
  });

  it("refuses malformed input without throwing", () => {
    // The listener's stdout is untrusted: a stray log line must be ignored, never crash the relay.
    for (const line of ["", "not json", "{", "[]", "null", JSON.stringify({ type: "unknown", channel: "wechat" })]) {
      expect(parseRelayLine(line)).toBeNull();
    }
  });

  it("bounds the body and the window, so one line cannot carry unbounded text into Boss", () => {
    const huge = parseRelayLine(JSON.stringify({ type: "command", channel: "wechat", body: "x".repeat(50_000), sourceWindow: "w".repeat(5_000) })) as { body: string; sourceWindow: string };
    expect(huge.body).toHaveLength(10_000);
    expect(huge.sourceWindow).toHaveLength(200);
  });
});

describe("Phase 06 — remote: the channel lifecycle", () => {
  it("starts only the enabled channel and reports waiting", () => {
    const { relay, children, statuses } = harness();
    relay.sync([enabled("wechat"), disabled("qq")]);
    expect(children.map((item) => item.channel)).toEqual(["wechat"]);
    expect(statuses[0]).toMatchObject({ channel: "wechat", status: "waiting" });
    relay.dispose();
  });

  it("does not restart a channel whose command prefix is unchanged", () => {
    // `sync` is called on every settings change; restarting an unchanged listener would drop the
    // user's session repeatedly.
    const { relay, children } = harness();
    relay.sync([enabled("wechat", "boss")]);
    relay.sync([enabled("wechat", "boss")]);
    expect(children).toHaveLength(1);
    relay.dispose();
  });

  it("restarts a channel when its command prefix changes", () => {
    const { relay, children } = harness();
    relay.sync([enabled("wechat", "boss")]);
    relay.sync([enabled("wechat", "chief")]);
    expect(children).toHaveLength(2);
    expect(children[1]!.prefix).toBe("chief");
    // The replaced listener is stopped, not left running alongside the new one.
    expect(children[0]!.child.kill).toHaveBeenCalled();
    relay.dispose();
  });

  it("stops a channel that was disabled, and says so", () => {
    const { relay, children, statuses } = harness();
    relay.sync([enabled("wechat")]);
    relay.sync([disabled("wechat")]);
    expect(children[0]!.child.kill).toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({ channel: "wechat", status: "disabled" });
    relay.dispose();
  });

  it("forwards a parsed command into Boss", () => {
    const { relay, children, commands } = harness();
    relay.sync([enabled("wechat")]);
    children[0]!.child.emitStdout(`${JSON.stringify({ type: "command", channel: "wechat", body: "ship it", sourceWindow: "Chat" })}\n`);
    expect(commands).toEqual([{ channel: "wechat", body: "ship it", sourceWindow: "Chat" }]);
    relay.dispose();
  });

  it("reassembles a record split across chunks, so framing is not assumed", () => {
    // A pipe delivers arbitrary chunks; treating each chunk as a line would drop real commands.
    const { relay, children, commands } = harness();
    relay.sync([enabled("wechat")]);
    const line = JSON.stringify({ type: "command", channel: "wechat", body: "split", sourceWindow: "w" });
    children[0]!.child.emitStdout(line.slice(0, 20));
    expect(commands).toHaveLength(0);
    children[0]!.child.emitStdout(`${line.slice(20)}\n`);
    expect(commands).toEqual([{ channel: "wechat", body: "split", sourceWindow: "w" }]);
    relay.dispose();
  });

  it("forwards every complete line in one chunk", () => {
    const { relay, children, commands } = harness();
    relay.sync([enabled("wechat")]);
    const first = JSON.stringify({ type: "command", channel: "wechat", body: "one", sourceWindow: "w" });
    const second = JSON.stringify({ type: "command", channel: "wechat", body: "two", sourceWindow: "w" });
    children[0]!.child.emitStdout(`${first}\r\n${second}\n`);
    expect(commands.map((item) => item.body)).toEqual(["one", "two"]);
    relay.dispose();
  });

  it("reports a status record from the listener", () => {
    const { relay, children, statuses } = harness();
    relay.sync([enabled("qq")]);
    children[0]!.child.emitStdout(`${JSON.stringify({ type: "status", channel: "qq", status: "ready", message: "found the window" })}\n`);
    expect(statuses.at(-1)).toMatchObject({ channel: "qq", status: "ready", message: "found the window" });
    relay.dispose();
  });

  it("ignores an unparseable line and keeps working", () => {
    // The listener may log. Losing the relay to a stray line would be worse than ignoring it.
    const { relay, children, commands } = harness();
    relay.sync([enabled("wechat")]);
    children[0]!.child.emitStdout("some diagnostic output\n");
    children[0]!.child.emitStdout(`${JSON.stringify({ type: "command", channel: "wechat", body: "still here", sourceWindow: "w" })}\n`);
    expect(commands.map((item) => item.body)).toEqual(["still here"]);
    relay.dispose();
  });

  it("reports an unexpected exit as an error, carrying the listener's stderr", () => {
    const { relay, children, statuses } = harness();
    relay.sync([enabled("wechat")]);
    children[0]!.child.emitStderr("no window found");
    children[0]!.child.emitExit(1);
    const last = statuses.at(-1)!;
    expect(last.status).toBe("error");
    expect(last.message).toContain("no window found");
    relay.dispose();
  });

  it("does NOT report a deliberate stop as an error", () => {
    // The distinction the `stopping` set exists for: a channel the user turned off must not appear as
    // a failure, or the UI cries wolf on every settings change.
    const { relay, children, statuses } = harness();
    relay.sync([enabled("wechat")]);
    relay.sync([disabled("wechat")]);
    children[0]!.child.emitExit(0);
    expect(statuses.filter((entry) => entry.status === "error")).toEqual([]);
    relay.dispose();
  });

  it("reports a launcher failure rather than pretending the channel started", () => {
    const statuses: Array<{ channel: RemoteChannel; status: RemoteChannelStatus; message: string }> = [];
    const spawnChild = () => {
      const child = new FakeChild();
      // The real `spawn` emits `error` asynchronously when the executable cannot be launched.
      queueMicrotask(() => child.emit("error", new Error("powershell not found")));
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    };
    const relay = new RemoteCommandRelay("s.ps1", (channel, status, message) => statuses.push({ channel, status, message }), () => {}, spawnChild as never);
    relay.sync([enabled("wechat")]);
    return Promise.resolve().then(() => {
      expect(statuses.some((entry) => entry.status === "error" && entry.message.includes("powershell not found"))).toBe(true);
      relay.dispose();
    });
  });

  it("disposes every running channel", () => {
    const { relay, children } = harness();
    relay.sync([enabled("wechat"), enabled("qq")]);
    expect(children).toHaveLength(2);
    relay.dispose();
    for (const item of children) expect(item.child.kill).toHaveBeenCalled();
  });

  it("tolerates a channel stopped when nothing was running", () => {
    const { relay, statuses } = harness();
    // `sync` on an all-disabled setting is the startup path, and must not report a phantom stop.
    relay.sync([disabled("wechat"), disabled("qq")]);
    expect(statuses).toEqual([]);
    relay.dispose();
  });
});
