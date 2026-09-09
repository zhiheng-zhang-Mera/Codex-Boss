/**
 * Provider display profiles + view slots (plan Phase 2). Pure and shareable.
 *
 * Three visible web-AI pages open horizontally; the Electron host places them
 * with `webContents.setZoomFactor` (never CSS transform). This module computes
 * the zoom factor from the actual pane width against a provider-specific
 * target CSS width, and models the persisted provider order (open order →
 * left → right).
 */

export interface ProviderDisplayProfile {
  providerId: string;
  /** CSS width (px) the page was designed for at zoom 1.0. */
  targetCssWidth: number;
  minZoom: number;
  maxZoom: number;
  zoomBias: number;
}

export const DEFAULT_DISPLAY_PROFILE: ProviderDisplayProfile = { providerId: "*", targetCssWidth: 900, minZoom: 0.55, maxZoom: 1.0, zoomBias: 1.0 };

/** Applies a profile; unknown providers fall back to the default target width. */
export function profileFor(profiles: ProviderDisplayProfile[], providerId: string): ProviderDisplayProfile {
  return profiles.find((profile) => profile.providerId === providerId) ?? DEFAULT_DISPLAY_PROFILE;
}

/** zoom = (paneWidth / targetCssWidth) * zoomBias, clamped to [minZoom, maxZoom]. */
export function zoomForPaneWidth(profile: ProviderDisplayProfile, paneWidth: number): number {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) return profile.minZoom;
  const raw = (paneWidth / Math.max(1, profile.targetCssWidth)) * profile.zoomBias;
  return Math.min(profile.maxZoom, Math.max(profile.minZoom, round3(raw)));
}

export function clampZoom(zoom: number, profile: ProviderDisplayProfile): number {
  return Math.min(profile.maxZoom, Math.max(profile.minZoom, round3(zoom)));
}

export interface ProviderViewSlot {
  providerId: string;
  order: number;
  openedAt: string;
}

/** Normalizes slot order to dense 0..n-1 by (order, openedAt); unknown providers drop out. */
export function orderedProviderIds(slots: ProviderViewSlot[]): string[] {
  return [...slots]
    .filter((slot) => Boolean(slot.providerId))
    .sort((a, b) => a.order - b.order || a.openedAt.localeCompare(b.openedAt) || a.providerId.localeCompare(b.providerId))
    .map((slot) => slot.providerId);
}

/** Moves a provider one step left (−1) or right (+1) in the slot list. */
export function moveProviderSlot(slots: ProviderViewSlot[], providerId: string, direction: -1 | 1): ProviderViewSlot[] {
  const order = orderedProviderIds(slots);
  const index = order.indexOf(providerId);
  if (index < 0) return slots;
  const target = index + direction;
  if (target < 0 || target >= order.length) return slots;
  const next = [...order];
  next.splice(index, 1);
  next.splice(target, 0, providerId);
  return next.map((id, orderIndex) => {
    const slot = slots.find((item) => item.providerId === id)!;
    return { providerId: id, order: orderIndex, openedAt: slot.openedAt };
  });
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
