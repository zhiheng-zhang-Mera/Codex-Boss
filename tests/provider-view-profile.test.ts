import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY_PROFILE, clampZoom, moveProviderSlot, orderedProviderIds, profileFor, zoomForPaneWidth, type ProviderViewSlot } from "../src/shared/provider-view-profile";

const slots = (ids: string[]): ProviderViewSlot[] => ids.map((id, order) => ({ providerId: id, order, openedAt: `2026-09-06T00:00:0${order}.000Z` }));

describe("provider view slots (Phase 2)", () => {
  it("orders slots densely and drops unknown ids", () => {
    expect(orderedProviderIds(slots(["chatgpt", "gemini", "claude"]))).toEqual(["chatgpt", "gemini", "claude"]);
    const messy = slots(["claude", "chatgpt", "gemini", "missing"]);
    messy[2].order = 0; messy[0].order = 2;
    expect(orderedProviderIds(messy)).toEqual(["gemini", "chatgpt", "claude", "missing"]);
  });

  it("moves a provider left/right and reassigns dense order", () => {
    const base = slots(["chatgpt", "gemini", "claude"]);
    expect(moveProviderSlot(base, "gemini", -1).map((slot) => slot.providerId)).toEqual(["gemini", "chatgpt", "claude"]);
    expect(moveProviderSlot(base, "chatgpt", -1).map((slot) => slot.providerId)).toEqual(["chatgpt", "gemini", "claude"]);
    expect(moveProviderSlot(base, "claude", 1).map((slot) => slot.providerId)).toEqual(["chatgpt", "gemini", "claude"]);
    const moved = moveProviderSlot(base, "chatgpt", 1);
    expect(moved.map((slot) => slot.order)).toEqual([1, 0, 2].sort());
  });
});

describe("auto zoom math (Phase 2)", () => {
  it("zooms pane width against the target CSS width and clamps", () => {
    expect(zoomForPaneWidth(DEFAULT_DISPLAY_PROFILE, 900)).toBe(1);
    expect(zoomForPaneWidth(DEFAULT_DISPLAY_PROFILE, 495)).toBe(DEFAULT_DISPLAY_PROFILE.minZoom); // 495/900=0.55 below min
    expect(zoomForPaneWidth(DEFAULT_DISPLAY_PROFILE, 1200)).toBe(1); // capped at 1.0
    expect(zoomForPaneWidth(DEFAULT_DISPLAY_PROFILE, 0)).toBe(DEFAULT_DISPLAY_PROFILE.minZoom);
    expect(zoomForPaneWidth(DEFAULT_DISPLAY_PROFILE, -5)).toBe(DEFAULT_DISPLAY_PROFILE.minZoom);
  });

  it("honors provider-specific profiles and zoom bias", () => {
    const profile = { providerId: "chatgpt", targetCssWidth: 1000, minZoom: 0.6, maxZoom: 1.0, zoomBias: 0.9 };
    expect(profileFor([profile], "chatgpt")).toBe(profile);
    expect(profileFor([], "chatgpt")).toEqual(DEFAULT_DISPLAY_PROFILE);
    expect(zoomForPaneWidth(profile, 1000)).toBe(0.9);
    expect(clampZoom(2, profile)).toBe(profile.maxZoom);
    expect(clampZoom(-1, profile)).toBe(profile.minZoom);
  });
});
