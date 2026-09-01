import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Windows launcher", () => {
  it("keeps the PowerShell entrypoint ASCII-safe for Windows PowerShell 5", () => {
    const bytes = fs.readFileSync(path.join(root, "scripts", "start-codex-boss.ps1"));
    expect([...bytes].every((value) => value < 128)).toBe(true);
  });

  it("keeps the hidden host alive for the desktop application lifetime", () => {
    const launcher = fs.readFileSync(path.join(root, "Start-Codex-Boss.cmd"), "utf8");
    expect(launcher).toContain("-WaitForApp");
    expect(launcher).not.toMatch(/^start\s/mi);
  });
});
