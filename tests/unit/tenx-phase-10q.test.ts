/**
 * Phase 10Q evidence test: platform-neutral contract audit + adapter seam.
 * The static audit proves src/shared/tenx contains no host-OS/Electron coupling
 * (violations would fail CI); the adapter seam shows host work is confined to
 * electron/tenx (one adapter per OS/device type, contract unchanged).
 */
import { describe, expect, it } from "vitest";
import { auditSharedContracts } from "../../electron/tenx/platform-audit";

describe("10Q platform neutrality", () => {
  it("static audit finds zero host-OS/Electron coupling in src/shared/tenx", () => {
    const root = require("node:path").resolve(__dirname, "../../src/shared/tenx");
    const result = auditSharedContracts(root);
    expect(result.files.length).toBeGreaterThanOrEqual(9);
    expect(result.violations).toEqual([]);
  });

  it("audit reports a violation when a host pattern is injected (guard works)", () => {
    // audit against a temp dir containing a deliberately bad file
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10q-"));
    try {
      fs.writeFileSync(path.join(dir, "bad.ts"), "import os from \"node:os\";\nexport const p = os.platform();\n", "utf8");
      const result = auditSharedContracts(dir);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some((item) => item.label.includes("node: builtin"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adapter seam types are host-side; shared contract stays import-free", () => {
    // host-adapter.ts is in electron/tenx; no file in src/shared/tenx imports electron or node:
    const fs = require("node:fs");
    const path = require("node:path");
    const sharedDir = path.resolve(__dirname, "../../src/shared/tenx");
    const files = fs.readdirSync(sharedDir).filter((file: string) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const file of files) {
      const content = fs.readFileSync(path.join(sharedDir, file), "utf8");
      expect(content.includes("from \"electron"), `${file} must not import electron`).toBe(false);
      expect(content.includes("from 'electron"), `${file} must not import electron`).toBe(false);
      expect(content.includes("from \"node:"), `${file} must not import node:`).toBe(false);
    }
  });
});
