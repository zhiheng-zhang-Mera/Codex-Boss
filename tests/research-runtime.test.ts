import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executableAllowed, validateCommandSpec, type ResearchCommandSpec } from "../src/shared/research-command";
import { prepareResearchCommand, captureResearchArtifact, hashCommandSpec } from "../electron/research/runtime/environment-manager";
import { ResearchRuntime } from "../electron/research/runtime/research-runtime";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-resrun-")); dirs.push(dir); return dir; }

function spec(overrides: Partial<ResearchCommandSpec> = {}): ResearchCommandSpec {
  return { executable: process.execPath, args: ["-e", "console.log('BOSS_MARK_OK')"], cwd: root(), purpose: "EXPERIMENT", timeoutMs: 30000, ...overrides };
}

function specAt(cwd: string, overrides: Partial<ResearchCommandSpec> = {}): ResearchCommandSpec {
  return { executable: process.execPath, args: ["-e", "console.log('BOSS_MARK_OK')"], cwd, purpose: "EXPERIMENT", timeoutMs: 30000, ...overrides };
}

describe("research command spec (Phase 6)", () => {
  it("validates specs and rejects shell metacharacters", () => {
    expect(() => validateCommandSpec(spec())).not.toThrow();
    expect(() => validateCommandSpec(spec({ executable: "node && rm -rf /" }))).toThrow();
    expect(() => validateCommandSpec(spec({ purpose: "HACK" as never }))).toThrow();
    expect(() => validateCommandSpec(spec({ timeoutMs: 10 }))).toThrow();
    expect(executableAllowed("python")).toBe(true);
    expect(executableAllowed("python.exe")).toBe(true);
    expect(executableAllowed("blender")).toBe(false);
    expect(() => prepareResearchCommand(spec({ executable: "rm" }))).toThrow(/not allowed/i);
  });

  it("hashes command specs and captures artifacts deterministically", () => {
    const cwd = root();
    expect(hashCommandSpec(specAt(cwd))).toBe(hashCommandSpec(specAt(cwd)));
    const dir = path.join(cwd, "evidence");
    const artifact = captureResearchArtifact(dir, "run?1.txt", "hello world");
    expect(artifact.bytes).toBe(11);
    expect(fs.existsSync(artifact.file)).toBe(true);
  });
});

describe("research runtime (Phase 6)", () => {
  it("runs structured processes and verifies expected markers", async () => {
    const runtime = new ResearchRuntime();
    const result = await runtime.run(spec({ expectedOutputs: ["BOSS_MARK_OK"] }));
    expect(result.code).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.output).toContain("BOSS_MARK_OK");
    expect(runtime.stats().totalRuns).toBe(1);
  });

  it("fails when expected output is missing and enforces concurrency", { timeout: 30000 }, async () => {
    const runtime = new ResearchRuntime({ maxConcurrent: 1 });
    const missing = await runtime.run(spec({ args: ["-e", "console.log('other')"], expectedOutputs: ["BOSS_MARK_OK"] }));
    expect(missing.passed).toBe(false);
    const longRun = runtime.run(spec({ args: ["-e", "setTimeout(()=>{}, 1200)"] }));
    await expect(runtime.run(spec({ args: ["-e", "console.log('x')"] }))).rejects.toThrow(/busy/);
    await longRun;
  });

  it("captures an artifact for evidence after a run", () => {
    const dir = path.join(root(), "artifacts");
    const artifact = captureResearchArtifact(dir, "run.json", JSON.stringify({ ok: true }));
    expect(JSON.parse(fs.readFileSync(artifact.file, "utf8"))).toEqual({ ok: true });
  });
});
