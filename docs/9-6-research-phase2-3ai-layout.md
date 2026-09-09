# 9-6 Research Phase 2 — 3-AI Horizontal Layout + Auto Zoom + Provider Order

Compact handoff for codex-boss-9-6-research-plan.md Phase 2 (§2.1–2.3). Branch `9-6-research`.

## Why

Three visible web-AI panes stacked vertically (count-3 grid rows). The plan requires the three
pages to open side-by-side horizontally (AI1 | AI2 | AI3) with full available height, readable
auto-zoom per pane width (never CSS transform), and a persisted provider display order
(open order → left → right, reorderable across restart).

## What was added

- **`src/shared/provider-view-profile.ts`** (new, pure)
  - `ProviderDisplayProfile {providerId, targetCssWidth, minZoom, maxZoom, zoomBias}` +
    `DEFAULT_DISPLAY_PROFILE` (target 900px, clamp 0.55–1.0);
  - `profileFor(profiles, providerId)` and `zoomForPaneWidth(profile, paneWidth)` —
    zoom = (width/target)·bias clamped, deterministic;
  - `ProviderViewSlot {providerId, order, openedAt}` + `orderedProviderIds` and
    `moveProviderSlot(slots, id, ±1)` — dense reorder used by the renderer.
- **`electron/provider-views.ts`** (wired)
  - `ProviderViews` accepts optional display profiles; `layout()` now calls
    `webContents.setZoomFactor(zoomForPaneWidth(…))` per pane using the **actual placed
    bounds** (never CSS transform), recomputed on every renderer layout/resize message.
- **`src/renderer/main.tsx`** (wired)
  - provider grid count-3 renders panes from a persisted `displayOrder`
    (`codex-boss:provider-display-order`); newly opened providers append, closed drop out;
    `‹ ›` pane controls move order left/right (order persists across restart).
- **`src/renderer/styles.css`**
  - `.provider-grid.count-3` → `grid-template-columns: repeat(3, minmax(0, 1fr)); rows:
    minmax(0,1fr)` (horizontal, full height) + pane-order-controls styling.
- **`tests/provider-view-profile.test.ts`** (new, 4 tests) — slot ordering/move math; zoom
  formula + clamping + provider-specific profiles/bias.
- **`tests/workflow.test.ts`** — layout-policy test updated to the new horizontal-thirds rule.

## Verification

- Targeted: `provider-view-profile` (4) + `workflow` (9) + `provider-view-navigation` PASS.
- typecheck + renderer build + electron build PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Zoom is applied in the Electron host on each `layout` call; the renderer measures pane rects
  and reports them (existing IPC), so resize re-zooms automatically.
- Drag-and-drop reorder is exposed as `‹ ›` controls (order math shared + unit tested); wiring
  HTML5 drag events on pane titles can layer on top without changing the model.

## Checkpoint

Commit with: `src/shared/provider-view-profile.ts`, `electron/provider-views.ts`,
`src/renderer/main.tsx`, `src/renderer/styles.css`, `tests/provider-view-profile.test.ts`,
`tests/workflow.test.ts`, this handoff.
