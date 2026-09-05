import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSectionBriefs, evidenceCheckDraft, validateManuscriptPlan, type ManuscriptPlan } from "../src/shared/research-manuscript";
import { assembleManuscript } from "../electron/research/manuscript/manuscript-assembler";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-manuscript-")); dirs.push(dir); return dir; }

const plan: ManuscriptPlan = { id: "r1", claimsToSections: { c1: ["abstract", "results"], c2: ["methods"] } };
const claims = [
  { id: "c1", evidenceIds: ["stat:s1", "run:r1"] },
  { id: "c2", evidenceIds: ["run:r2"] }
];
const evidenceIds = ["stat:s1", "run:r1", "run:r2"];

describe("manuscript model (Phase 11 pure)", () => {
  it("builds evidence-scoped section briefs", () => {
    const briefs = buildSectionBriefs(plan, claims);
    const results = briefs.find((brief) => brief.section === "results")!;
    expect(results.claimIds).toEqual(["c1"]);
    expect(results.evidenceIds).toEqual(["stat:s1", "run:r1"]);
    expect(briefs.find((brief) => brief.section === "methods")?.claimIds).toEqual(["c2"]);
    expect(() => validateManuscriptPlan({ ...plan, claimsToSections: { c1: ["nope" as never] } })).toThrow();
  });

  it("evidence-checks drafts against the graph and rejects out-of-scope references", () => {
    const good = evidenceCheckDraft({ section: "results", allowedEvidenceIds: ["stat:s1", "run:r1"], content: "Accuracy @stat:s1 from @run:r1." }, new Set(evidenceIds));
    expect(good.passed).toBe(true);
    const bad = evidenceCheckDraft({ section: "results", allowedEvidenceIds: ["stat:s1"], content: "Claim depends on @run:secret." }, new Set(evidenceIds));
    expect(bad.passed).toBe(false);
    expect(bad.missingEvidence).toEqual(["run:secret"]);
  });
});

describe("manuscript assembler (Phase 11 electron)", () => {
  it("writes the manuscript tree with evidence-checked sections and audit files", async () => {
    const dir = root();
    const writer = { async write(brief: { section: string; evidenceIds: string[] }) {
      return `${brief.section} draft (rev 0) references ${brief.evidenceIds.map((id) => "@" + id).join(" and ")}`;
    } };
    const output = await assembleManuscript(dir, { title: "Multi-Agent Study", plan, claims, evidenceIds, writer });
    expect(output.sections.results.content).toContain("results draft");
    expect(fs.existsSync(path.join(dir, "r1", "manuscript", "paper.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "r1", "manuscript", "paper.tex"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "r1", "manuscript", "references.bib"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "r1", "audit", "final-audit.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "r1", "audit", "final-audit.json"), "utf8")).passed).toBe(true);
    expect(output.paperMd).toContain("# Multi-Agent Study");
  });
});
