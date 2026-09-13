import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Update-Plan/cleaning.md §11 — the UI path consistency pass.
 *
 * The rule: every place the Owner chooses a *directory* offers the same two
 * entries — an editable path field and a Browse button — and all of them are the
 * same component, so no surface can grow its own path semantics. This test reads
 * the real renderer sources; the running application is asserted separately by
 * `scripts/acceptance-workspace-paths.cjs` (A-01/A-02/F-01/F-02), because a
 * source scan cannot prove what the DOM renders and the DOM cannot prove no
 * fourth surface was added by hand.
 */

const PROJECT = process.cwd();
const RENDERER = path.join(PROJECT, "src", "renderer");

function rendererSources(): Array<{ file: string; text: string }> {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (/\.tsx?$/.test(entry.name)) files.push(target);
    }
  };
  walk(RENDERER);
  return files.map((file) => ({ file: path.relative(PROJECT, file).split(path.sep).join("/"), text: fs.readFileSync(file, "utf8") }));
}

/** Every `<input>` whose aria-label names a repository/workspace directory. */
function directoryPathInputs(sources: Array<{ file: string; text: string }>): Array<{ file: string; line: string }> {
  const found: Array<{ file: string; line: string }> = [];
  for (const source of sources) {
    for (const line of source.text.split(/\r?\n/)) {
      if (!/<input\b/.test(line)) continue;
      if (!/aria-label=("|')(工作区路径|工程仓库|研究仓库)("|')/.test(line)) continue;
      found.push({ file: source.file, line: line.trim() });
    }
  }
  return found;
}

describe("§11 every directory path surface is the same field", () => {
  it("the renderer contains no hand-rolled directory path input", () => {
    expect(directoryPathInputs(rendererSources())).toEqual([]);
  });

  it("the three path surfaces all render WorkspacePathField", () => {
    const sources = rendererSources();
    const usage = sources.filter((source) => source.text.includes("<WorkspacePathField"));
    const files = usage.map((source) => source.file).sort();
    expect(files).toEqual(["src/renderer/components/GoalRunPanel.tsx", "src/renderer/main.tsx"]);
    for (const aria of ["工作区路径", "工程仓库", "研究仓库"]) {
      expect(usage.some((source) => source.text.includes(`ariaLabel="${aria}"`)), `${aria} is not rendered through WorkspacePathField`).toBe(true);
    }
  });

  it("the shared field is the only place that touches the picker or the validator", () => {
    const sources = rendererSources();
    const callers = sources.filter((source) => /window\.boss\.(selectWorkspaceDirectory|validateWorkspacePath|rememberWorkspacePath|workspaceSelection)\b/.test(source.text));
    expect(callers.map((source) => source.file)).toEqual(["src/renderer/components/WorkspacePathField.tsx"]);
  });

  it("the shared field offers both entries: an editable input and a Browse button", () => {
    const field = fs.readFileSync(path.join(RENDERER, "components", "WorkspacePathField.tsx"), "utf8");
    expect(field).toContain("<input");
    expect(field).toContain("value={value}");
    expect(field).toContain("onChange=");
    expect(field).toContain("className=\"workspace-browse\"");
    expect(field).toContain("浏览");
    // The field must not rewrite what the user typed: only Browse/restore call onChange.
    expect(field).toContain("onChange(event.target.value)");
  });

  it("no renderer module implements path semantics of its own", () => {
    const offenders: string[] = [];
    for (const source of rendererSources()) {
      if (source.file.endsWith("components/WorkspacePathField.tsx")) continue;
      if (/\bnode:path\b|from "path"/.test(source.text)) offenders.push(`${source.file}: imports node path`);
      if (/\b(realpathSync|statSync|existsSync)\b/.test(source.text)) offenders.push(`${source.file}: touches the filesystem for a path decision`);
      if (/PATH_NOT_FOUND|NOT_A_DIRECTORY|NOT_ABSOLUTE/.test(source.text)) offenders.push(`${source.file}: branches on a path verdict code`);
    }
    expect(offenders).toEqual([]);
  });

  it("the shared field relies on the shared verdict labels instead of its own wording", () => {
    const field = fs.readFileSync(path.join(RENDERER, "components", "WorkspacePathField.tsx"), "utf8");
    expect(field).toContain("WORKSPACE_PATH_CODE_LABELS");
    expect(field).toContain("restoreWorkspaceField");
  });
});
