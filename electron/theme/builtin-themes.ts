/**
 * Update-Plan/checkpoint-1.md §12/§11 — the permanently built-in themes.
 *
 * Light and Dark ship as COMPLETE, self-contained packages (tokens, overrides,
 * metadata), exactly like a custom theme: §11 forbids a dependency chain, so a
 * built-in may never be "the parent" of a custom theme at runtime. They are
 * BUILT_IN / LOCKED / NON_DELETABLE and are the §21 fallback targets.
 *
 * Dark's values are the values this application already renders today, so
 * activating Dark is visually a no-op; Light is a genuine second theme. Both are
 * validated by the same §20 validator as any user theme — a built-in gets no
 * exemption.
 */
import {
  THEME_SCHEMA_VERSION,
  type ThemePackage,
  DEFAULT_THEME_ID,
  BUILT_IN_THEME_IDS
} from "../../src/shared/theme";

/** Shape/typography tokens shared by both built-ins (still per-package data). */
const SHARED_TOKENS: Record<string, string> = {
  "--boss-radius": "12px",
  "--boss-radius-sm": "8px",
  "--boss-radius-lg": "16px",
  "--boss-border-width": "1px",
  "--boss-blur": "10px",
  "--boss-opacity": "1",
  "--boss-transition": "160ms ease",
  "--boss-font-family": "Inter, \"Segoe UI Variable\", \"Microsoft YaHei UI\", sans-serif",
  "--boss-font-mono": "\"Cascadia Mono\", Consolas, \"Courier New\", monospace",
  "--boss-font-size": "12px",
  "--boss-line-height": "1.6",
  "--boss-letter-spacing": "0",
  "--boss-spacing-density": "0.9",
  "--boss-space-1": "4px",
  "--boss-space-2": "8px",
  "--boss-space-3": "14px",
  "--boss-space-4": "22px",
  "--boss-shadow": "0 10px 30px #00000055",
  "--boss-scrollbar-thumb": "#3a4042",
  "--boss-scrollbar-track": "#141719",
  "--boss-code-bg": "#101315",
  "--boss-accent-muted": "#b7d77c",
  "--boss-backdrop": "#00000088"
};

const DARK_TOKENS: Record<string, string> = {
  ...SHARED_TOKENS,
  "--boss-bg-root": "#0c0e10",
  "--boss-bg-surface": "#111315",
  "--boss-bg-elevated": "#141719",
  "--boss-bg-muted": "#1a1d1f",
  "--boss-text-primary": "#e8e9e6",
  "--boss-text-secondary": "#aeb3b4",
  "--boss-text-muted": "#73797c",
  "--boss-accent": "#d9f99d",
  "--boss-on-accent": "#18200f",
  "--boss-border": "#2a2d2f",
  "--boss-divider": "#272c2e",
  "--boss-success": "#9dde7c",
  "--boss-warning": "#e2cf77",
  "--boss-danger": "#e59a69"
};

const LIGHT_TOKENS: Record<string, string> = {
  ...SHARED_TOKENS,
  "--boss-bg-root": "#f4f6f2",
  "--boss-bg-surface": "#ffffff",
  "--boss-bg-elevated": "#eaece7",
  "--boss-bg-muted": "#e2e5df",
  "--boss-text-primary": "#1b1f1d",
  "--boss-text-secondary": "#4a5350",
  "--boss-text-muted": "#5c6462",
  "--boss-accent": "#5f8a1f",
  "--boss-on-accent": "#ffffff",
  "--boss-border": "#ccd2cb",
  "--boss-divider": "#dde1da",
  "--boss-success": "#2f8f4e",
  "--boss-warning": "#a86a12",
  "--boss-danger": "#b3382a",
  "--boss-shadow": "0 10px 24px #1b1f1d22",
  "--boss-scrollbar-thumb": "#b6bdb8",
  "--boss-scrollbar-track": "#eaece7",
  "--boss-code-bg": "#f0f2ec",
  "--boss-accent-muted": "#8fb35a",
  "--boss-backdrop": "#1b1f1d55"
};

function packageFor(id: string, name: string, description: string, tokens: Record<string, string>): ThemePackage {
  return {
    manifest: {
      schemaVersion: THEME_SCHEMA_VERSION,
      id,
      name,
      type: "BUILT_IN",
      version: "1.0.0",
      description,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      builtIn: true,
      deletable: false
    },
    tokens: { ...tokens },
    overrides: [],
    metadata: { schemaVersion: THEME_SCHEMA_VERSION, createdBy: "BUILT_IN", notes: ["shipped with the application; locked and non-deletable (checkpoint-1 §12)"] }
  };
}

export const BUILT_IN_THEME_PACKAGES: readonly ThemePackage[] = [
  packageFor("builtin-dark", "Dark", "The application's original dark appearance, expressed as semantic tokens.", DARK_TOKENS),
  packageFor("builtin-light", "Light", "A high-contrast light appearance built from the same semantic tokens.", LIGHT_TOKENS)
];

/** Deterministic lookup used by the registry and by the acceptance suite. */
export function builtInPackages(): ThemePackage[] {
  return BUILT_IN_THEME_PACKAGES.map((pkg) => structuredClone(pkg));
}

/** True when `id` names one of the two permanent built-ins (§12). */
export function isBuiltInThemeId(id: string): boolean {
  return (BUILT_IN_THEME_IDS as readonly string[]).includes(id);
}

export { DEFAULT_THEME_ID };
