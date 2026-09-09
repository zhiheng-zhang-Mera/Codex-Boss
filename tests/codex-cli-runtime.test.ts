import { afterEach, describe, expect, it } from "vitest";
import { CodexCliRuntime } from "../electron/runtimes/codex/codex-cli-runtime";

const originalPath = process.env.PATH;
const originalProfile = process.env.USERPROFILE;
const originalConfigured = process.env.CODEX_BOSS_CODEX_PATH;
afterEach(() => { process.env.PATH = originalPath; process.env.USERPROFILE = originalProfile; process.env.CODEX_BOSS_CODEX_PATH = originalConfigured; });

describe("CodexCliRuntime", () => {
  it("reports a local runtime failure without failing the application when Codex is absent", async () => {
    process.env.PATH = "";
    process.env.USERPROFILE = "";
    process.env.CODEX_BOSS_CODEX_PATH = "definitely-missing-codex";
    const health = await new CodexCliRuntime(process.cwd()).healthCheck();
    expect(health).toMatchObject({ runtimeId: "codex:cli", availability: "DOWN" });
  });
});
