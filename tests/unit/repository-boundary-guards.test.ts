import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeRoots, RUNTIME_OWNED_PATHS } from "../../electron/runtime-paths";

/**
 * Architecture guards (Codex-Boss convergence book, Phase C/D/E/L).
 *
 * These are the constraints the cleanup round exists to establish: the rules a
 * later change must not silently undo. Each one is written against the real
 * sources, so re-introducing the pattern fails here instead of surviving review.
 */

const PROJECT = process.cwd();

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-guards-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** Every TypeScript source under the given roots, repo-relative POSIX paths. */
function sources(roots: string[]): Array<{ file: string; text: string }> {
  const found: Array<{ file: string; text: string }> = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (/\.tsx?$/.test(entry.name)) {
        found.push({ file: path.relative(PROJECT, target).split(path.sep).join("/"), text: fs.readFileSync(target, "utf8") });
      }
    }
  };
  for (const root of roots) walk(path.join(PROJECT, root));
  return found;
}

const IMPORT_PATTERN = /(?:^|\n)\s*import[^;\n]*from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(text: string): string[] {
  const specifiers: string[] = [];
  for (const match of text.matchAll(IMPORT_PATTERN)) specifiers.push(match[1] ?? match[2] ?? "");
  return specifiers;
}

describe("Phase L — module dependency boundaries", () => {
  it("src/shared never imports the Electron side", () => {
    const offenders: string[] = [];
    for (const source of sources(["src/shared"])) {
      for (const specifier of importsOf(source.text)) {
        if (/^(electron|\.\.\/\.\.\/electron)/.test(specifier)) offenders.push(`${source.file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the renderer never imports the Electron side", () => {
    const offenders: string[] = [];
    for (const source of sources(["src/renderer"])) {
      for (const specifier of importsOf(source.text)) {
        if (/^(electron|\.\.\/\.\.\/electron|\.\.\/electron)/.test(specifier)) offenders.push(`${source.file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the Electron side never imports the renderer", () => {
    const offenders: string[] = [];
    for (const source of sources(["electron"])) {
      for (const specifier of importsOf(source.text)) {
        if (specifier.includes("src/renderer") || specifier.includes("../renderer")) offenders.push(`${source.file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the canonical path model does not depend on Electron", () => {
    for (const file of ["electron/workspace/path-utils.ts", "electron/workspace/task-workspace.ts", "electron/workspace/workspace-selection.ts", "electron/workspace/workspace-picker.ts"]) {
      const text = fs.readFileSync(path.join(PROJECT, file), "utf8");
      expect(importsOf(text).filter((specifier) => /^electron$/.test(specifier)), `${file} imports electron`).toEqual([]);
    }
    // Only the Electron-facing adapter may name the dialog API.
    const picker = fs.readFileSync(path.join(PROJECT, "electron/workspace/workspace-picker.ts"), "utf8");
    expect(picker).not.toContain("showOpenDialog");
  });
});

describe("Phase E — one runtime root model", () => {
  it("derives every root from the install root", () => {
    const roots = runtimeRoots({ installRoot: "C:\\app" });
    expect(roots.installRoot).toBe(path.resolve("C:\\app"));
    expect(roots.appData).toBe(path.join(path.resolve("C:\\app"), "runtime-data"));
    expect(roots.cache).toBe(path.join(path.resolve("C:\\app"), ".cache"));
    expect(roots.history).toBe(path.join(path.resolve("C:\\app"), "history"));
    expect(roots.acceptance).toBe(path.join(path.resolve("C:\\app"), "artifacts", "acceptance"));
    expect(roots.research).toBe(path.join(path.resolve("C:\\app"), "runtime-data", ".boss", "research"));
    expect(roots.temp).toBe(path.join(path.resolve("C:\\app"), ".cache", "tmp"));
  });

  it("moves the durable roots to a data-directory override, keeping the install root separate", () => {
    const roots = runtimeRoots({ installRoot: "C:\\app", dataRootOverride: "D:\\isolated" });
    expect(roots.installRoot).toBe(path.resolve("C:\\app"));
    expect(roots.appData).toBe(path.resolve("D:\\isolated"));
    expect(roots.cache.startsWith(path.resolve("D:\\isolated"))).toBe(true);
    expect(roots.history.startsWith(path.resolve("D:\\isolated"))).toBe(true);
    // Nothing the app owns may land in the installation once an override is set.
    for (const root of [roots.appData, roots.cache, roots.history, roots.acceptance, roots.research, roots.temp]) {
      expect(root.startsWith(path.resolve("C:\\app"))).toBe(false);
    }
  });

  it("no subsystem spells a runtime root directory itself", () => {
    // The directory names exist in exactly one module. A second module building
    // `<some root>/runtime-data` by hand is how two data roots appear; it must go
    // through `runtimeRoots`/`appDataUnder` instead. Naming the directory inside a
    // scan skip-list is not construction and is allowed.
    const offenders: string[] = [];
    for (const source of sources(["electron", "src"])) {
      if (source.file === "electron/runtime-paths.ts") continue;
      if (source.file.startsWith("electron/engineering/autonomous-evolution")) continue; // root-trust surface, out of scope this round
      for (const line of source.text.split(/\r?\n/)) {
        if (/path\.join\([^)]*["']runtime-data["']/.test(line)) offenders.push(`${source.file}: joins runtime-data itself`);
        if (/path\.join\([^)]*["']\.cache["']/.test(line)) offenders.push(`${source.file}: joins .cache itself`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the declared runtime paths git-ignored (the guard is not vacuous)", () => {
    // The full check lives in workspace-path-ownership.test.ts; this asserts the
    // declaration still exists so the two cannot drift apart.
    expect(RUNTIME_OWNED_PATHS.length).toBeGreaterThanOrEqual(8);
  });
});

describe("Phase C — the autonomous mutation recovery rule", () => {
  const mainCommander = fs.readFileSync(path.join(PROJECT, "electron/commander/main-commander.ts"), "utf8");
  const engineeringMain = fs.readFileSync(path.join(PROJECT, "electron/main.ts"), "utf8");

  it("the autonomous engineering goal is the only entry that mutates without an Owner confirming each edit", () => {
    // `runEngineeringGoal` is the autonomous route; it must take the recovery
    // point BEFORE the driver is constructed and must roll back through the
    // exception-safe helper for every non-converged terminal state.
    const goalStart = mainCommander.indexOf("async runEngineeringGoal(");
    expect(goalStart).toBeGreaterThan(0);
    const body = mainCommander.slice(goalStart, mainCommander.indexOf("\n  /**", goalStart));
    const captureAt = body.indexOf("await captureRecoveryPoint(");
    const driverAt = body.indexOf("new EngineeringLoopDriver(");
    const runAt = body.indexOf("await driver.run()");
    expect(captureAt).toBeGreaterThan(0);
    expect(driverAt).toBeGreaterThan(captureAt);       // no driver without a recovery point
    expect(runAt).toBeGreaterThan(driverAt);
    expect(body).toContain("if (!preserveWorkspaceAfter(summary.state))");
    expect(body).toContain("await restoreRecoveryPoint(");
    expect(body).toContain("new EngineeringRecoveryError(error, recovery)");
  });

  it("the goal IPC channel is the only autonomous mutating engineering channel", () => {
    // Split the composition root into `ipcMain.handle(...)` blocks and find the
    // ones whose body drives the autonomous goal loop.
    const blocks = engineeringMain.split("ipcMain.handle(").slice(1);
    const autonomousChannels = blocks
      .map((block) => ({ channel: block.slice(1, block.indexOf('"', 1)), body: block.slice(0, block.indexOf("ipcMain.handle(") === -1 ? block.length : block.indexOf("ipcMain.handle(")) }))
      .filter((block) => block.body.includes("runEngineeringGoal("))
      .map((block) => block.channel);
    expect(autonomousChannels).toEqual(["boss:engineering-goal-run"]);
  });

  it("keeps the recovery primitives in one module with a single production caller", () => {
    const callers = sources(["electron"]).filter((source) => source.file !== "electron/engineering/engineering-recovery.ts" && /captureRecoveryPoint\(|restoreRecoveryPoint\(/.test(source.text));
    expect(callers.map((source) => source.file)).toEqual(["electron/commander/main-commander.ts"]);
  });

  it("documents why the Owner-driven plan route is not silently rolled back", () => {
    // `executePlan` writes through `applyScopedChanges` without a recovery point
    // ON PURPOSE: the Owner dispatched that task, the product surfaces
    // PARTIAL_STATE and keeps partial work for them. The distinction is the
    // rule, so it is asserted rather than left to memory.
    const verification = fs.readFileSync(path.join(PROJECT, "electron/engineering/verification.ts"), "utf8");
    expect(verification).toContain("export function applyScopedChanges(");
    expect(verification).not.toContain("captureRecoveryPoint");
    const doc = fs.readFileSync(path.join(PROJECT, "docs/engineering-recovery-audit.md"), "utf8");
    expect(doc).toContain("Owner-driven");
    expect(doc).toContain("PARTIAL_STATE");
  });
});

describe("Phase D — one containment predicate", () => {
  it("is defined once and only delegated to", () => {
    const canonical = fs.readFileSync(path.join(PROJECT, "electron/workspace/path-utils.ts"), "utf8");
    expect(canonical).toContain("export function isInsideWorkspace(");
    // Every other local containment helper must delegate to it rather than
    // recompute the arithmetic; a private wrapper is fine, a second
    // implementation is not.
    const wrappers = sources(["electron", "src"]).filter((source) => source.file !== "electron/workspace/path-utils.ts" && /function isInsideWorkspace\(|function isInside\(/.test(source.text));
    for (const wrapper of wrappers) {
      const body = wrapper.text.slice(wrapper.text.indexOf("function isInside"), wrapper.text.indexOf("function isInside") + 400);
      expect(body, `${wrapper.file} recomputes containment instead of delegating`).toMatch(/pathContainment\(/);
    }
    expect(wrappers.map((source) => source.file).sort()).toEqual([
      "electron/commander/workbook-dispatch.ts",
      "electron/emergency-control/evolution-kill-switch.ts",
      "electron/root-authority/execution-profile.ts",
      "electron/self-evolution/mutation-context.ts",
      "electron/stable-candidate/runtime-isolation.ts"
    ]);
  });
});
