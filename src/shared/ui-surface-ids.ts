/**
 * Update-Plan/checkpoint-1.md §9 — the canonical UI surface id list.
 *
 * Kept in its own file so the hosts (discovery, theme packages, validators) can
 * depend on the vocabulary without pulling in the contract table, and so the
 * list has exactly one definition. The order is the order the plan prints them.
 */
export const UI_SURFACE_IDS = [
  "APP_BACKGROUND",
  "SURFACE_PRIMARY",
  "SURFACE_SECONDARY",
  "SIDEBAR",
  "TOP_NAV",
  "CARD",
  "MODAL",
  "INPUT",
  "BUTTON_PRIMARY",
  "BUTTON_SECONDARY",
  "TEXT_PRIMARY",
  "TEXT_SECONDARY",
  "BORDER",
  "DIVIDER",
  "ACCENT",
  "SUCCESS",
  "WARNING",
  "DANGER",
  "SCROLLBAR",
  "CODE_PANEL",
  "WORKSPACE_PANEL",
  "AI_PANE",
  "STATUS_BADGE"
] as const;

export type UISurfaceId = (typeof UI_SURFACE_IDS)[number];
