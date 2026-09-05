import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { metricFigureSvg } from "../src/shared/research-figures";
import { assembleManuscript, type ManuscriptOptions } from "../electron/research/manuscript/manuscript-assembler";
import type { ManuscriptPlan } from "../src/shared/research-manuscript";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-fig-")); dirs.push(dir); return dir; }

const plan: ManuscriptPlan = { id: "r1", claimsToSections: { c1: ["results"] } };
const claims = [{ id: "c1", evidenceIds: ["stat:s1"] }];
const writer = { async write(brief: { section: string; evidenceIds: string[] }) { return `draft ${brief.evidenceIds.join(",")}`; } };

describe("deterministic figure generation (Phase 11 / Final Acceptance J)", () => {
  it("renders identical SVG bytes for identical inputs and escapes user text", () => {
    const bars = [{ label: "run 1", value: 9 }, { label: "run 2", value: 11 }];
    const a = metricFigureSvg(bars, { title: "accuracy", yLabel: "score" });
    const b = metricFigureSvg(bars, { title: "accuracy", yLabel: "score" });
    expect(a).toBe(b);
    expect(a).toContain("<svg");
    expect(a).toContain("run 1");
    const unsafe = metricFigureSvg([{ label: "<script>", value: 3 }], { title: "a<b&c" });
    expect(unsafe).not.toContain("<script>");
    expect(unsafe).toContain("&lt;script&gt;");
  });
});

describe("manuscript figure writing", () => {
  it("writes supplied figures into manuscript/figures/ and reports their names", async () => {
    const dir = root();
    const svg = metricFigureSvg([{ label: "a", value: 1 }], { title: "T" });
    const options: ManuscriptOptions = { title: "T", plan, claims, evidenceIds: ["stat:s1"], writer, figures: [{ name: "runs.svg", svg }] };
    const output = await assembleManuscript(path.join(dir, "research"), options);
    expect(output.figures).toEqual(["runs.svg"]);
    const file = path.join(dir, "research", "r1", "manuscript", "figures", "runs.svg");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(svg);
    // paper.md and paper.tex embed exactly the figure files that were written.
    const paperMd = fs.readFileSync(path.join(dir, "research", "r1", "manuscript", "paper.md"), "utf8");
    expect(paperMd).toContain("![runs.svg](figures/runs.svg)");
    const paperTex = fs.readFileSync(path.join(dir, "research", "r1", "manuscript", "paper.tex"), "utf8");
    expect(paperTex).toContain("\\includegraphics[width=\\linewidth]{runs.svg}");
    // Returned in-memory content matches the files.
    expect(output.paperMd).toContain("![runs.svg](figures/runs.svg)");
    expect(output.paperTex).toContain("\\includegraphics");
  });

  it("leaves figures empty when none supplied (backward compatible)", async () => {
    const dir = root();
    const output = await assembleManuscript(path.join(dir, "research"), { title: "T", plan, claims, evidenceIds: ["stat:s1"], writer });
    expect(output.figures).toEqual([]);
  });
});
