import { describe, expect, it } from "vitest";
import { createOpenAlexLiteratureDeps, createCrossrefLiteratureDeps, locatePassage, reconstructAbstract, runHostLiteraturePass } from "../../electron/research/literature/host-retrieval";

const OA_WORK = {
  title: "Evidence-weighted adjudication reduces review errors in software engineering benchmarks",
  doi: "https://doi.org/10.1234/example.2026.001",
  publication_year: 2026,
  authorships: [{ author: { display_name: "Ada Lovelace" } }, { author: { display_name: "Grace Hopper" } }],
  primary_location: { source: { display_name: "Journal of Autonomous Systems" } },
  abstract_inverted_index: {
    "Evidence-weighted": [0], adjudication: [1], reduces: [2], review: [3], errors: [4], in: [5], software: [6], engineering: [7], benchmarks: [8]
  }
};

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as unknown as Response;
}

describe("host-backed literature retrieval (Overcomplete §9.3–9.5)", () => {
  it("reconstructs an OpenAlex inverted-index abstract deterministically", () => {
    expect(reconstructAbstract(OA_WORK.abstract_inverted_index)).toBe("Evidence-weighted adjudication reduces review errors in software engineering benchmarks");
    expect(reconstructAbstract(null)).toBe("");
  });

  it("locates a mechanical passage only when RQ keywords appear in the text", () => {
    const sentence = "Evidence-weighted adjudication reduces review errors in this benchmark.";
    expect(locatePassage(sentence, "Does evidence-weighted adjudication reduce review errors?")).toContain("Evidence-weighted");
    expect(locatePassage("Unrelated chemistry notes about molecules.", "evidence-weighted adjudication review errors")).toBeUndefined();
  });

  it("runs a full OpenAlex host pass: search → acquire → verify → passage locate", async () => {
    const deps = createOpenAlexLiteratureDeps({
      fetchFn: async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("/works?search=")) return jsonResponse({ results: [OA_WORK] });
        if (href.includes("/works/https://doi.org/")) return jsonResponse(OA_WORK);
        return jsonResponse({}, false);
      }
    });
    const outcome = await runHostLiteraturePass({ rq: "evidence-weighted adjudication review errors in software engineering" }, deps);
    expect(outcome.records).toHaveLength(1);
    const record = outcome.records[0];
    expect(record.title).toContain("Evidence-weighted adjudication");
    expect(record.doi).toBe("10.1234/example.2026.001");
    expect(record.sourceRef).toBe("https://doi.org/10.1234/example.2026.001");
    expect(record.authors).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(record.metadataVerified).toBe(true);
    expect(record.sourceText).toContain("Evidence-weighted adjudication reduces review errors");
    expect(record.passageLocated).toBe(true);
    expect(record.quote).toBeTruthy();
  });

  it("records honest failure when the host search is unavailable (never invents sources)", async () => {
    const deps = createOpenAlexLiteratureDeps({ fetchFn: async () => jsonResponse({}, false) });
    const outcome = await runHostLiteraturePass({ rq: "anything" }, deps);
    expect(outcome.records).toEqual([]);
    expect(outcome.attempted).toBe(0);
    expect(outcome.reasons.join(" ")).toContain("no candidates");
  });

  it("parses Crossref candidates with metadata from the API item", async () => {
    const deps = createCrossrefLiteratureDeps({
      fetchFn: async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("?query=")) {
          return jsonResponse({ message: { items: [{ DOI: "10.9999/cross.1", title: ["A crossref study"], author: [{ given: "Alan", family: "Turing" }], "container-title": ["Proc. X"], issued: { "date-parts": [[2025]] }, type: "journal-article" }] } });
        }
        return jsonResponse({}, false);
      }
    });
    const candidates = await deps.search("crossref study", 5);
    expect(candidates[0]).toMatchObject({ title: "A crossref study", doi: "10.9999/cross.1", venue: "Proc. X", year: 2025 });
  });
});
