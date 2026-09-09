import { describe, expect, it } from "vitest";
import { extractJsonEntity, parseJsonObject } from "../../electron/research/semantic-json";

describe("semantic JSON extraction (malformed provider responses)", () => {
  it("extracts fenced JSON surrounded by prose", () => {
    const raw = 'Sure! Here you go:\n```json\n{"hypothesis":"H1"}\n```\nHope that helps.';
    expect(parseJsonObject(raw)).toEqual({ hypothesis: "H1" });
  });

  it("extracts the first balanced JSON region from noisy text", () => {
    const raw = 'Explanation first.\n{"votes":[{"reviewerId":"a","stance":"supports"}]} trailing words';
    expect(parseJsonObject(raw)).toMatchObject({ votes: [{ reviewerId: "a", stance: "supports" }] });
  });

  it("rejects malformed or absent JSON instead of fabricating a value", () => {
    expect(() => parseJsonObject("I could not produce JSON")).toThrow(/No valid JSON/);
    expect(() => parseJsonObject('{"broken": tru}')).toThrow(/No valid JSON/);
    expect(extractJsonEntity("")).toBeNull();
  });
});
