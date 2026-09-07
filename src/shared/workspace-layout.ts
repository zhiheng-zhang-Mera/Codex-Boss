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
 * any viewport + pane count, and models zoom/fit so pane sizing recomputes on
 * resize.
 */

export type WorkspaceViewState = "MERGED" | "DETACHED";

export const WORKSPACE_VIEW_STATES: readonly WorkspaceViewState[] = ["MERGED", "DETACHED"];

export function isWorkspaceViewState(value: unknown): value is WorkspaceViewState {
  return value === "MERGED" || value === "DETACHED";
}

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
