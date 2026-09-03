import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRelayLine } from "../electron/remote-relay";
import { StateStore } from "../electron/store";

describe("PC remote command channels", () => {
  it("persists opt-in settings and keeps incoming commands pending for approval", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-remote-"));
    const statePath = path.join(root, "state.json");
    const store = new StateStore(statePath);
    expect(store.snapshot().remoteChannels.map((item) => item.channel)).toEqual(["wechat", "qq"]);

    store.updateRemoteChannel("wechat", true, "/boss");
    store.setRemoteChannelRuntime("wechat", "ready", "微信窗口已连接");
    const command = store.receiveRemoteCommand("wechat", "整理今天的研究记录", "文件传输助手");
    expect(command?.status).toBe("pending");
    expect(store.receiveRemoteCommand("wechat", "整理今天的研究记录", "文件传输助手")).toBeNull();

    store.setRemoteCommandStatus(command!.id, "loaded");
    const restored = new StateStore(statePath).snapshot();
    expect(restored.remoteChannels.find((item) => item.channel === "wechat")?.enabled).toBe(true);
    expect(restored.remoteChannels.find((item) => item.channel === "wechat")?.status).toBe("disabled");
    expect(restored.remoteCommands[0].status).toBe("loaded");
  });

  it("rejects unsafe prefixes and ignores malformed relay output", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-prefix-"));
    const store = new StateStore(path.join(root, "state.json"));
    expect(() => store.updateRemoteChannel("qq", true, "boss command")).toThrow(/指令前缀/);
    expect(parseRelayLine("not json")).toBeNull();
    expect(parseRelayLine('{"type":"command","channel":"other","body":"x","sourceWindow":"y"}')).toBeNull();
  });

  it("normalizes valid relay records before they reach the store", () => {
    expect(parseRelayLine('{"type":"status","channel":"qq","status":"ready","message":"QQ ready"}')).toEqual({ type: "status", channel: "qq", status: "ready", message: "QQ ready" });
    expect(parseRelayLine('{"type":"command","channel":"wechat","body":"  run tests  ","sourceWindow":"chat"}')).toEqual({ type: "command", channel: "wechat", body: "run tests", sourceWindow: "chat" });
  });
});
