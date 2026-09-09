/**
 * Web-AI workspace layout model (plan §4/§9). Pure and shareable.
 *
 * Two display states per plan §7:
 * - MERGED: history | Boss controller | provider area all in one window
 *   (the current desktop shell keeps its interaction form).
 * - DETACHED: Boss in window A, the web-AI panes in window B; both stay in
 *   sync (plan §9).
 *
 * Inside a provider area, N full-height panes line up horizontally
 * (plan §9.1): 1 AI = one full column, 3 AI = three columns, 5 AI = five
 * columns — never two rows. This module computes deterministic pane bounds for
 * any viewport + pane count, models zoom/fit so pane sizing recomputes on
 * resize, and provides the split-merge geometry that maps either view state
 * onto window regions (MERGED: boss gutter + web region in one window;
 * DETACHED: boss window A and web-pane window B from one total screen region).
 */

export type WorkspaceViewState = "MERGED" | "DETACHED";

export const WORKSPACE_VIEW_STATES: readonly WorkspaceViewState[] = ["MERGED", "DETACHED"];

export function isWorkspaceViewState(value: unknown): value is WorkspaceViewState {
  return value === "MERGED" || value === "DETACHED";
}

/** Integer pixel region on a window/screen (origin top-left). */
export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutArea {
  width: number;
  height: number;
}

/** Boss share of total width is clamped so neither side becomes unusable. */
export const MIN_BOSS_SHARE = 0.15;
export const MAX_BOSS_SHARE = 0.75;

export interface PaneBounds {
  providerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Layout geometries are integers ≥ 0 with a minimum usable width per pane. */
export const MIN_PANE_WIDTH = 120;

/**
 * Lays out `orderedProviders` as full-height horizontal panes inside a
 * provider area of `areaWidth × areaHeight`. All panes keep full height; each
 * pane width is area width / pane count (guaranteed ≥ MIN_PANE_WIDTH when the
 * area can hold the panes; callers may cap how many panes they open).
 */
export function layoutProviderPanes(orderedProviders: readonly string[], areaWidth: number, areaHeight: number): PaneBounds[] {
  if (!Array.isArray(orderedProviders) || orderedProviders.length === 0) return [];
  if (!Number.isFinite(areaWidth) || areaWidth <= 0 || !Number.isFinite(areaHeight) || areaHeight <= 0) return [];
  if (orderedProviders.length > 5) throw new Error("At most 5 web-AI panes are supported");
  const width = Math.max(MIN_PANE_WIDTH, Math.floor(areaWidth / orderedProviders.length));
  return orderedProviders.map((providerId, index) => ({
    providerId,
    x: index * width,
    y: 0,
    width,
    height: Math.floor(areaHeight)
  }));
}

export interface PaneLayoutResult {
  bounds: PaneBounds[];
  /** True when every pane kept ≥ MIN_PANE_WIDTH (no horizontal crowding). */
  fits: boolean;
}

/** Layout + fit verdict, used by tests and by the renderer resize path. */
export function paneLayout(orderedProviders: readonly string[], areaWidth: number, areaHeight: number): PaneLayoutResult {
  const bounds = layoutProviderPanes(orderedProviders, areaWidth, areaHeight);
  const minWidth = orderedProviders.length ? Math.floor(areaWidth / orderedProviders.length) : areaWidth;
  return { bounds, fits: orderedProviders.length === 0 || minWidth >= MIN_PANE_WIDTH };
}

export interface WorkspaceLayoutState {
  view: WorkspaceViewState;
  /** Provider order left → right (persisted across relaunch). */
  displayOrder: string[];
  /** Manual zoom factor override per provider (undefined = auto-fit). */
  manualZoom: Record<string, number>;
}

export function initialWorkspaceLayout(displayOrder: string[]): WorkspaceLayoutState {
  return { view: "MERGED", displayOrder: [...displayOrder], manualZoom: {} };
}

/** Deterministic normalization of a provider order against currently-open ids. */
export function mergeOpenOrder(order: string[], openProviderIds: readonly string[]): string[] {
  const open = new Set(openProviderIds);
  const kept = order.filter((id) => open.has(id));
  const appended = openProviderIds.filter((id) => !kept.includes(id));
  return [...kept, ...appended];
}

/** Provider pane count is validated as 1|3|5 for full layout; 2/4 keep a row of 2/4 columns (legal subset). */
export function expectedPanesForWork(agentCount: number): number {
  return agentCount;
}

/** Resolves the effective zoom for a pane: manual override wins, else auto-fit. */
export function effectiveZoom(manualZoom: Record<string, number>, providerId: string, autoZoom: number): number {
  const override = manualZoom[providerId];
  return override !== undefined && Number.isFinite(override) && override > 0 ? override : autoZoom;
}

function clampBossShare(share: number): number {
  if (!Number.isFinite(share)) return MIN_BOSS_SHARE;
  return Math.min(MAX_BOSS_SHARE, Math.max(MIN_BOSS_SHARE, share));
}

/**
 * Splits a total screen/window area into a vertical Boss region (window A) and
 * a web-AI region (window B in DETACHED, the provider area in MERGED) for
 * plan §9. Both regions keep full height; `gap` is the pixel gutter between
 * them. `bossShare` is clamped to [MIN_BOSS_SHARE, MAX_BOSS_SHARE] and the web
 * region always keeps ≥ 1px (degenerate totals yield empty-but-consistent
 * regions rather than negative widths).
 */
export function splitRegions(total: LayoutArea, bossShare: number, gap = 0): { boss: RegionBounds; web: RegionBounds } {
  const width = Number.isFinite(total.width) ? Math.max(0, Math.floor(total.width)) : 0;
  const height = Number.isFinite(total.height) ? Math.max(0, Math.floor(total.height)) : 0;
  const gutter = Number.isFinite(gap) ? Math.max(0, Math.floor(gap)) : 0;
  const bossWidth = width === 0 ? 0 : Math.max(1, Math.min(width, Math.round(width * clampBossShare(bossShare))));
  const webWidth = Math.max(0, width - bossWidth - gutter);
  return {
    boss: { x: 0, y: 0, width: bossWidth, height },
    web: { x: bossWidth + gutter, y: 0, width: webWidth, height }
  };
}

/**
 * MERGED-view mapping: within one window the web-AI area sits to the right of
 * the Boss gutter (history/controller column), like the current desktop shell.
 */
export function mergedPanesRegion(total: LayoutArea, bossGutter: number): RegionBounds {
  const width = Number.isFinite(total.width) ? Math.max(0, Math.floor(total.width)) : 0;
  const height = Number.isFinite(total.height) ? Math.max(0, Math.floor(total.height)) : 0;
  const gutter = Number.isFinite(bossGutter) ? Math.max(0, Math.floor(bossGutter)) : 0;
  return { x: gutter, y: 0, width: Math.max(0, width - gutter), height };
}

/**
 * Lays `orderedProviders` out inside an absolute region (offsets are relative
 * to the region origin, so `x` starts at `region.x`). Reuses the deterministic
 * full-height horizontal column geometry of §9.1.
 */
export function layoutPanesInRegion(orderedProviders: readonly string[], region: RegionBounds): PaneBounds[] {
  const bounds = layoutProviderPanes(orderedProviders, region.width, region.height);
  return bounds.map((pane) => ({ ...pane, x: region.x + pane.x, y: region.y + pane.y }));
}
