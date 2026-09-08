import { describe, expect, it } from "vitest";
import {
  effectiveZoom,
  initialWorkspaceLayout,
  isWorkspaceViewState,
  layoutPanesInRegion,
  layoutProviderPanes,
  mergedPanesRegion,
  mergeOpenOrder,
  paneLayout,
  splitRegions,
  WORKSPACE_VIEW_STATES
} from "../../src/shared/workspace-layout";

describe("workspace layout model (plan §4/§9)", () => {
  it("models MERGED and DETACHED states", () => {
    expect(WORKSPACE_VIEW_STATES).toEqual(["MERGED", "DETACHED"]);
    expect(isWorkspaceViewState("MERGED")).toBe(true);
    expect(isWorkspaceViewState("DETACHED")).toBe(true);
    expect(isWorkspaceViewState("split")).toBe(false);
  });

  it("lays out 1/3/5 panes as full-height horizontal columns (§9.1)", () => {
    const area = { width: 1500, height: 900 };
    const one = layoutProviderPanes(["a"], area.width, area.height);
    expect(one).toEqual([{ providerId: "a", x: 0, y: 0, width: 1500, height: 900 }]);

    const three = layoutProviderPanes(["a", "b", "c"], area.width, area.height);
    expect(three.map((pane) => pane.width)).toEqual([500, 500, 500]);
    expect(three.map((pane) => pane.height)).toEqual([900, 900, 900]);
    expect(three.map((pane) => pane.x)).toEqual([0, 500, 1000]);

    const five = layoutProviderPanes(["a", "b", "c", "d", "e"], 1500, 800);
    expect(five.map((pane) => pane.width)).toEqual([300, 300, 300, 300, 300]);
    expect(five.every((pane) => pane.height === 800)).toBe(true);
    // Never two rows: y stays 0 for every pane.
    expect(five.every((pane) => pane.y === 0)).toBe(true);
  });

  it("keeps panes full-height and reports the fit verdict", () => {
    const wide = paneLayout(["a", "b"], 1400, 700);
    expect(wide.fits).toBe(true);
    expect(wide.bounds[1].x).toBe(700);
    const narrow = paneLayout(["a", "b", "c"], 300, 700);
    expect(narrow.fits).toBe(false); // 100px columns crowd below the min
  });

  it("rejects more than 5 panes and degenerate areas", () => {
    expect(() => layoutProviderPanes(["1", "2", "3", "4", "5", "6"], 1500, 900)).toThrow();
    expect(layoutProviderPanes(["a"], 0, 900)).toEqual([]);
    expect(layoutProviderPanes([], 100, 100)).toEqual([]);
  });

  it("merges a persisted order with currently-open providers (relaunch persistence)", () => {
    expect(mergeOpenOrder(["b", "a"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
    expect(mergeOpenOrder(["a", "c"], ["a", "b"])).toEqual(["a", "b"]); // c dropped
    expect(mergeOpenOrder([], ["x"])).toEqual(["x"]);
  });

  it("lets a manual zoom override the auto-fit zoom and keeps state defaults", () => {
    const state = initialWorkspaceLayout(["a", "b"]);
    expect(state).toEqual({ view: "MERGED", displayOrder: ["a", "b"], manualZoom: {} });
    expect(effectiveZoom(state.manualZoom, "a", 0.85)).toBe(0.85);
    expect(effectiveZoom({ a: 1.1 }, "a", 0.85)).toBe(1.1);
    expect(effectiveZoom({ a: 1.1 }, "b", 0.85)).toBe(0.85);
  });

  it("splits a region into a Boss window and a web window for DETACHED (§9)", () => {
    const split = splitRegions({ width: 2000, height: 1000 }, 0.5);
    expect(split.boss).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
    expect(split.web).toEqual({ x: 1000, y: 0, width: 1000, height: 1000 });
    expect(split.boss.width + split.web.width).toBe(2000);
  });

  it("clamps the boss share and keeps the web region usable", () => {
    const tiny = splitRegions({ width: 2000, height: 900 }, 0.01);
    expect(tiny.boss.width).toBe(300); // 0.15 clamp of 2000
    const huge = splitRegions({ width: 2000, height: 900 }, 0.99);
    expect(huge.boss.width).toBe(1500); // 0.75 clamp of 2000
    expect(huge.web.width).toBe(500);
    const gap = splitRegions({ width: 1000, height: 800 }, 0.5, 20);
    expect(gap.boss.width).toBe(500);
    expect(gap.web.x).toBe(520);
    expect(gap.web.width).toBe(480);
  });

  it("never yields negative regions on degenerate totals", () => {
    expect(splitRegions({ width: 0, height: 0 }, 0.5)).toEqual({ boss: { x: 0, y: 0, width: 0, height: 0 }, web: { x: 0, y: 0, width: 0, height: 0 } });
    expect(splitRegions({ width: 10, height: 5 }, 0.5, 200).web.width).toBe(0);
    expect(splitRegions({ width: -5, height: 5 }, 0.5).boss.width).toBe(0);
  });

  it("maps MERGED panes to the area right of the Boss gutter", () => {
    const region = mergedPanesRegion({ width: 1800, height: 1000 }, 300);
    expect(region).toEqual({ x: 300, y: 0, width: 1500, height: 1000 });
    const panes = layoutPanesInRegion(["a", "b", "c"], region);
    expect(panes[0]).toEqual({ providerId: "a", x: 300, y: 0, width: 500, height: 1000 });
    expect(panes[2].x).toBe(1300);
    expect(panes[2].width).toBe(500);
  });

  it("lays three full-height panes inside the DETACHED web window", () => {
    const split = splitRegions({ width: 1600, height: 900 }, 0.25); // web 1200 wide
    expect(split.web).toEqual({ x: 400, y: 0, width: 1200, height: 900 });
    const panes = layoutPanesInRegion(["a", "b", "c"], split.web);
    expect(panes.map((pane) => ({ x: pane.x, width: pane.width, height: pane.height }))).toEqual([
      { x: 400, width: 400, height: 900 },
      { x: 800, width: 400, height: 900 },
      { x: 1200, width: 400, height: 900 }
    ]);
    expect(panes.every((pane) => pane.y === 0)).toBe(true); // never two rows
  });
});
