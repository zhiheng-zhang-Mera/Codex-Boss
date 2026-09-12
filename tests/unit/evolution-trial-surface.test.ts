import { describe, expect, it } from "vitest";
import {
  clamp01,
  createSurfaceState,
  DEFAULT_LABEL_RULE,
  formatDuration,
  migrateSurfaceState,
  normalizeLabel,
  parseKeyValueLine,
  progressPercent,
  severityRank,
  statusTone,
  summarizeCounts,
  SURFACE_TONES,
  SURFACE_VERSION,
  themeTokenFor,
  toCsvLine,
  truncateLabel,
  uniquePreservingOrder,
} from "../../src/shared/evolution-trial-surface";

describe("evolution-trial-surface", () => {

  it("clamps finite numbers into the unit interval", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(4)).toBe(1);
  });

  it("normalizes whitespace in labels", () => {
    expect(normalizeLabel("  alpha   beta  ")).toBe("alpha beta");
  });

  it("truncates labels that are longer than the rule allows", () => {
    const rule = { maxLength: 5, ellipsis: "..." };
    expect(truncateLabel("abcdefghij", rule)).toBe("abcd...");
    expect(truncateLabel("abc", rule)).toBe("abc");
    expect(DEFAULT_LABEL_RULE.maxLength).toBeGreaterThan(0);
  });

  it("formats durations for the status strip", () => {
    expect(formatDuration(2500)).toBe("2s");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(3600000)).toBe("1h 0m");
  });

  it("computes progress percentages", () => {
    expect(progressPercent(1, 4)).toBe(25);
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(5, 4)).toBe(100);
  });

  it("maps statuses to tones", () => {
    expect(statusTone("done")).toBe("success");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("running")).toBe("info");
    expect(statusTone("mystery")).toBe("neutral");
  });

  it("ranks severities and rejects unknown values", () => {
    expect(severityRank("critical")).toBe(3);
    expect(severityRank("low")).toBe(0);
    expect(severityRank("unranked")).toBe(-1);
  });

  it("deduplicates labels while preserving their first-seen order", () => {
    expect(uniquePreservingOrder(["beta", "alpha", "beta", "gamma"])).toEqual(["beta", "alpha", "gamma"]);
  });

  it("summarizes counts deterministically", () => {
    expect(summarizeCounts({ beta: 2, alpha: 1 })).toBe("alpha=1, beta=2");
    expect(summarizeCounts({})).toBe("no counts");
  });

  it("parses key=value lines and refuses malformed ones", () => {
    expect(parseKeyValueLine("owner = alice")).toEqual({ key: "owner", value: "alice" });
    expect(() => parseKeyValueLine("malformed")).toThrow();
  });

  it("renders csv lines", () => {
    expect(toCsvLine(["alpha", 1, "beta"])).toBe("alpha,1,beta");
  });

  it("maps tones to theme tokens", () => {
    expect(themeTokenFor("success")).toBe("--tone-success");
    expect(themeTokenFor("neutral")).toBe("--tone-neutral");
  });

  it("creates and migrates surface state", () => {
    const created = createSurfaceState("info");
    expect(created.version).toBe(SURFACE_VERSION);
    expect(created).toMatchObject({ tone: "info", labels: [], counts: {} });
    const migrated = migrateSurfaceState({ tone: "warning", labels: ["a"], counts: { b: 2 } });
    expect(migrated.version).toBe(SURFACE_VERSION);
    expect(migrated).toMatchObject({ tone: "warning", labels: ["a"], counts: { b: 2 } });
    expect(migrateSurfaceState(null).tone).toBe("neutral");
  });

  it("keeps the tone vocabulary stable", () => {
    expect(SURFACE_TONES).toHaveLength(5);
    expect(SURFACE_TONES).toContain("danger");
  });

});
