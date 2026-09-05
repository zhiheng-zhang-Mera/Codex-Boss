import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanRepo } from "../electron/engineering/repo-inspector";
import { buildSymbolIndex, indexFile, locateSymbol, signatureFor } from "../electron/engineering/symbol-index";
import { buildAutoHandoff, validateAutoHandoffInput } from "../src/shared/auto-handoff";
import { persistAutoHandoff } from "../electron/engineering/dev-handoff";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-devplane-")); dirs.push(dir); return dir; }

describe("symbol index (AP04)", () => {
  it("indexes exported functions/classes/types and resolves definitions by name", () => {
    const file = indexFile("src/a.ts", "export function render() {}\nexport class Parser {}\ninterface Config {}\nfunction hidden() {}");
    expect(file.exports).toEqual(["Parser", "render"]);
    expect(file.classes).toContain("Parser");
    expect(file.types).toContain("Config");
    const snapshot = { schemaVersion: 1 as const, scannedAt: "", root: "", files: ["src/a.ts", "src/b.ts"], testMap: {}, skippedDirectories: 0, fingerprint: "fp" };
    const index = buildSymbolIndex(snapshot, (file) => (file === "src/a.ts" ? "export function render() {} export class Parser {}" : "export const answer = 42;"));
    expect(locateSymbol(index, "Parser")).toEqual(["src/a.ts"]);
    expect(locateSymbol(index, "answer")).toEqual(["src/b.ts"]);
    expect(signatureFor(snapshot)).toBe("fp");
  });

  it("scans a real temp repo deterministically", () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "tool.ts"), "export function cut() {}\n");
    const snapshot = scanRepo(dir);
    const index = buildSymbolIndex(snapshot, (file) => fs.readFileSync(path.join(dir, file), "utf8"));
    expect(locateSymbol(index, "cut")).toEqual(["src/tool.ts"]);
  });
});

describe("auto handoff (AP04)", () => {
  it("builds a compact checkpoint document and validates input", () => {
    const doc = buildAutoHandoff({
      packId: "AP99z",
      title: "Seam close",
      why: "Close the remaining part",
      filesChanged: ["src/shared/x.ts"],
      evidence: [{ stepId: "test", passed: true, output: "1 passed" }],
      verification: "vitest green",
      boundaryNotes: ["default unchanged"],
      nextActions: ["run full suite"]
    });
    expect(doc.markdown).toContain("# AP99z — Seam close");
    expect(doc.markdown).toContain("Verification evidence: 1/1 passed.");
    expect(doc.markdown).toContain("## Next actions");
    expect(() => validateAutoHandoffInput({ packId: "", title: "x", why: "y", filesChanged: [], evidence: [] })).toThrow();
  });

  it("persists handoff markdown + metadata into a target directory", () => {
    const dir = root();
    const result = persistAutoHandoff(dir, {
      packId: "AP99b",
      title: "T",
      why: "W",
      filesChanged: ["src/a.ts"],
      evidence: [{ stepId: "e", passed: true }]
    });
    expect(fs.existsSync(result.markdownFile)).toBe(true);
    expect(fs.readFileSync(result.markdownFile, "utf8")).toContain("# AP99b — T");
    expect(JSON.parse(fs.readFileSync(result.metaFile, "utf8")).schemaVersion).toBe(1);
  });
});
