/**
 * Update-Plan/checkpoint-1.md §14/§15/§19/§24 — the Theme Generator.
 *
 * §14's workflow is: intent → current UI model + screenshot + current tokens →
 * style interpretation → theme draft → preview. This module owns the
 * interpretation/draft half, and it is deliberately deterministic: given the
 * same intent and the same base theme it produces the same package, with a
 * per-token decision trace (§24: which rule produced which value).
 *
 * §15 ("see the UI first"): the generator requires the current theme's tokens and
 * the §9 surface contract table as inputs, and it refuses to run without them —
 * it never writes CSS from a sentence alone. The screenshot/capture evidence is
 * recorded alongside the draft by the caller.
 *
 * §19 (generation boundary): the output is a Theme Package and nothing else. It
 * cannot add files, cannot touch components, and every override it emits is
 * checked against the surface contract before it is returned.
 */
import { contrastRatio, parseColour, type ThemePackage, type ThemeSurfaceOverride, type ThemeTokens } from "./theme";
import { knownToken, surfaceById, type UISurfaceContract } from "./ui-surface";
import { describeIntent, type ThemeIntent } from "./theme-intent";
import { contentHashOf } from "./workbook";

export const THEME_GENERATOR_VERSION = "theme-generator-1" as const;

/** A single derivation decision, kept so a draft can explain itself (§24). */
export interface ThemeGenerationDecision {
  token: string;
  value: string;
  rule: string;
  evidence: string;
}

export interface ThemeGenerationResult {
  /** A complete, self-contained package: nothing is inherited at runtime (§11). */
  pkg: ThemePackage;
  decisions: ThemeGenerationDecision[];
  /** Tokens whose readability had to be repaired after the style shift. */
  repairs: string[];
  /** Style summary recorded in the package metadata. */
  interpretation: string;
  generator: typeof THEME_GENERATOR_VERSION;
}

export interface ThemeGenerationInput {
  intent: ThemeIntent;
  /** The theme the user is currently looking at (tokens + optional overrides). */
  base: Pick<ThemePackage, "tokens" | "overrides">;
  /** §9 contract table the overrides are validated against. */
  contracts: readonly UISurfaceContract[];
  /** Package identity for the draft. */
  id: string;
  name: string;
  now: string;
  /** Recorded in metadata so a draft can point at what it was generated from. */
  captureSummary?: string;
}

/* ------------------------------------------------------------------ *
 * Colour helpers (HSL space, so a style shift is explainable)
 * ------------------------------------------------------------------ */

interface Hsl { h: number; s: number; l: number }

export function toHsl(value: string): Hsl | undefined {
  const rgb = parseColour(value);
  if (!rgb) return undefined;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: Number(lightness.toFixed(4)) };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { h: Number(hue.toFixed(2)), s: Number(saturation.toFixed(4)), l: Number(lightness.toFixed(4)) };
}

export function fromHsl(colour: Hsl, alpha?: number): string {
  const h = ((colour.h % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, colour.s));
  const l = Math.min(1, Math.max(0, colour.l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const channel = (value: number): string => Math.round(Math.min(255, Math.max(0, (value + m) * 255))).toString(16).padStart(2, "0");
  const hex = `#${channel(r)}${channel(g)}${channel(b)}`;
  if (alpha === undefined || alpha >= 1) return hex;
  const rounded = Math.max(0, Math.min(1, alpha));
  return `${hex}${Math.round(rounded * 255).toString(16).padStart(2, "0").toUpperCase()}`;
}

/** Named tones resolved to a hue, used when the user names a colour. */
const TONE_HUES: Record<string, number> = {
  blue: 215, teal: 182, green: 145, purple: 272, pink: 330, red: 2, orange: 26, amber: 42, yellow: 52, slate: 205, graphite: 210
};

/** Target hue for a temperature shift when the user did not name a colour. */
const TEMPERATURE_HUE: Record<string, number> = { COOL: 205, WARM: 32, NEUTRAL: 0 };

function shiftHue(hue: number, target: number, weight: number): number {
  const delta = ((target - hue + 540) % 360) - 180;
  return ((hue + delta * weight) % 360 + 360) % 360;
}

/**
 * §14/§15: turns an intent into a complete draft package.
 *
 * The generator only ever *derives values*: base tokens in, shifted tokens out,
 * with a decision record per token. It emits overrides only for surfaces that
 * exist in the contract table and only with properties that surface allows.
 */
export function generateThemeDraft(input: ThemeGenerationInput): ThemeGenerationResult {
  const { intent, base, contracts } = input;
  if (!base?.tokens || !Object.keys(base.tokens).length) throw new Error("the generator needs the current theme's tokens (§15: never write CSS from a sentence alone)");
  if (!contracts.length) throw new Error("the generator needs the §9 surface contract table (§15)");

  const decisions: ThemeGenerationDecision[] = [];
  const repairs: string[] = [];
  const tokens: ThemeTokens = { ...base.tokens };
  const record = (token: string, value: string, rule: string, evidence: string): void => {
    tokens[token] = value;
    decisions.push({ token, value, rule, evidence });
  };

  /* ---- 1. lightness (dark/light) ---- */
  const wantLight = intent.lightness?.value === "LIGHT";
  const wantDark = intent.lightness?.value === "DARK";
  if (wantLight || wantDark) {
    // Re-lay the neutral ramp rather than inverting colours: the text/surface
    // relationship is what makes a theme readable.
    const ramp = wantLight
      ? { root: 0.965, surface: 1, elevated: 0.93, muted: 0.9, border: 0.83, divider: 0.88 }
      : { root: 0.045, surface: 0.07, elevated: 0.085, muted: 0.1, border: 0.19, divider: 0.17 };
    const baseHsl = toHsl(base.tokens["--boss-bg-root"] ?? "#000000") ?? { h: 210, s: 0.1, l: 0.05 };
    const saturation = Math.min(0.25, baseHsl.s);
    record("--boss-bg-root", fromHsl({ h: baseHsl.h, s: saturation, l: ramp.root }), "LIGHTNESS_SHIFT", `intent.lightness=${intent.lightness!.value} (${intent.lightness!.evidence})`);
    record("--boss-bg-surface", fromHsl({ h: baseHsl.h, s: saturation, l: ramp.surface }), "LIGHTNESS_SHIFT", "surface sits on the root ramp");
    record("--boss-bg-elevated", fromHsl({ h: baseHsl.h, s: saturation, l: ramp.elevated }), "LIGHTNESS_SHIFT", "elevated sits above the surface");
    record("--boss-bg-muted", fromHsl({ h: baseHsl.h, s: saturation, l: ramp.muted }), "LIGHTNESS_SHIFT", "muted fill");
    record("--boss-border", fromHsl({ h: baseHsl.h, s: saturation, l: ramp.border }), "LIGHTNESS_SHIFT", "hairline border");
    record("--boss-divider", fromHsl({ h: baseHsl.h, s: saturation, l: ramp.divider }), "LIGHTNESS_SHIFT", "separator");
    record("--boss-text-primary", fromHsl({ h: baseHsl.h, s: 0.08, l: wantLight ? 0.12 : 0.93 }), "LIGHTNESS_SHIFT", "primary text inverts with the ramp");
    record("--boss-text-secondary", fromHsl({ h: baseHsl.h, s: 0.08, l: wantLight ? 0.3 : 0.72 }), "LIGHTNESS_SHIFT", "secondary text");
    record("--boss-text-muted", fromHsl({ h: baseHsl.h, s: 0.08, l: wantLight ? 0.38 : 0.52 }), "LIGHTNESS_SHIFT", "muted text");
    record("--boss-code-bg", fromHsl({ h: baseHsl.h, s: saturation, l: wantLight ? 0.94 : 0.06 }), "LIGHTNESS_SHIFT", "code panel background");
    record("--boss-scrollbar-thumb", fromHsl({ h: baseHsl.h, s: saturation, l: wantLight ? 0.72 : 0.3 }), "LIGHTNESS_SHIFT", "scrollbar thumb");
    record("--boss-scrollbar-track", fromHsl({ h: baseHsl.h, s: saturation, l: ramp.elevated }), "LIGHTNESS_SHIFT", "scrollbar track");
    record("--boss-backdrop", wantLight ? "#1b1f1d55" : "#00000088", "LIGHTNESS_SHIFT", "modal backdrop follows the ramp");
    record("--boss-shadow", wantLight ? "0 10px 24px #1b1f1d22" : "0 10px 30px #00000055", "LIGHTNESS_SHIFT", "shadow weight follows the ramp");
  }

  /* ---- 2. temperature / named tones (accent + surfaces) ---- */
  const namedTone = intent.tones[0];
  const accentHsl = toHsl(base.tokens["--boss-accent"] ?? "#88ccff") ?? { h: 205, s: 0.6, l: 0.6 };
  let targetHue = accentHsl.h;
  let hueEvidence = "";
  if (intent.accent) {
    const named = toHsl(intent.accent.value);
    if (named) { targetHue = named.h; hueEvidence = `accent ${intent.accent.value} named in the request`; }
  } else if (namedTone && TONE_HUES[namedTone] !== undefined) {
    targetHue = TONE_HUES[namedTone];
    hueEvidence = `tone "${namedTone}" named in the request`;
  } else if (intent.temperature && intent.temperature.value !== "NEUTRAL") {
    targetHue = TEMPERATURE_HUE[intent.temperature.value];
    hueEvidence = `temperature ${intent.temperature.value.toLowerCase()} (${intent.temperature.evidence})`;
  }
  if (hueEvidence) {
    // A colour the user NAMED is used literally; a tone/temperature word shifts
    // the existing accent toward that hue, because the user described a
    // direction rather than a value.
    const accent = intent.accent
      ? (toHsl(intent.accent.value) ?? accentHsl)
      : { h: shiftHue(accentHsl.h, targetHue, 0.7), s: Math.max(0.35, Math.min(0.85, accentHsl.s)), l: accentHsl.l };
    record("--boss-accent", fromHsl(accent), intent.accent ? "NAMED_ACCENT" : "HUE_SHIFT", hueEvidence);
    record("--boss-accent-muted", fromHsl({ ...accent, s: accent.s * 0.7, l: Math.min(0.8, accent.l + 0.12) }), "HUE_SHIFT", `muted form of ${hueEvidence}`);
    const surfaceHsl = toHsl(tokens["--boss-bg-surface"] ?? "#111315");
    if (surfaceHsl) {
      const tinted = { h: shiftHue(surfaceHsl.h, targetHue, 0.25), s: Math.min(0.22, surfaceHsl.s + 0.08), l: surfaceHsl.l };
      record("--boss-bg-elevated", fromHsl(tinted), "SURFACE_TINT", `elevated surface tinted toward ${hueEvidence}`);
    }
    record("--boss-on-accent", (toHsl(tokens["--boss-accent"])?.l ?? 0.6) > 0.55 ? "#10140c" : "#ffffff", "ON_ACCENT", "readable foreground on the accent fill");
  }

  /* ---- 3. translucency (§10 blur/opacity) ---- */
  if (intent.translucency?.value.enabled) {
    const strength = intent.translucency.value.strength;
    const surface = toHsl(tokens["--boss-bg-surface"] ?? "#111315");
    const elevated = toHsl(tokens["--boss-bg-elevated"] ?? "#141719");
    const root = toHsl(tokens["--boss-bg-root"] ?? "#0c0e10");
    if (surface) record("--boss-bg-surface", fromHsl(surface, 1 - strength * 0.45), "TRANSLUCENCY", `translucency ${strength} (${intent.translucency.evidence})`);
    if (elevated) record("--boss-bg-elevated", fromHsl(elevated, 1 - strength * 0.3), "TRANSLUCENCY", "elevated surface is less translucent than the base");
    if (root) record("--boss-bg-root", fromHsl(root, 1 - strength * 0.15), "TRANSLUCENCY", "the canvas stays the most opaque layer");
    record("--boss-blur", `${Math.round(6 + strength * 18)}px`, "TRANSLUCENCY", "blur scales with the requested strength");
    record("--boss-opacity", (1 - strength * 0.12).toFixed(2), "TRANSLUCENCY", "global opacity eases with the requested strength");
  }

  /* ---- 4. density (§10 spacing) ---- */
  if (intent.density) {
    const scale = intent.density.value === "COMPACT" ? 0.78 : intent.density.value === "SPACIOUS" ? 1.28 : 1;
    const baseSpace = [4, 8, 14, 22];
    for (const [index, value] of baseSpace.entries()) {
      record(`--boss-space-${index + 1}`, `${Math.round(value * scale)}px`, "DENSITY_SCALE", `density ${intent.density.value.toLowerCase()} (${intent.density.evidence})`);
    }
    record("--boss-spacing-density", scale.toFixed(2), "DENSITY_SCALE", "density factor recorded for later surfaces");
    record("--boss-line-height", (1.6 + (scale - 1) * 0.25).toFixed(2), "DENSITY_SCALE", "line height follows the density");
  }

  /* ---- 5. radius ---- */
  if (intent.radius) {
    const radius = intent.radius.value === "SHARP" ? { base: 2, sm: 2, lg: 3 }
      : intent.radius.value === "SOFT" ? { base: 8, sm: 6, lg: 10 }
      : intent.radius.value === "ROUNDED" ? { base: 16, sm: 12, lg: 22 }
      : { base: 999, sm: 999, lg: 999 };
    record("--boss-radius", `${radius.base}px`, "RADIUS_SCALE", `radius ${intent.radius.value.toLowerCase()} (${intent.radius.evidence})`);
    record("--boss-radius-sm", `${radius.sm}px`, "RADIUS_SCALE", "small radius follows the scale");
    record("--boss-radius-lg", `${radius.lg}px`, "RADIUS_SCALE", "large radius follows the scale");
  }

  /* ---- 6. typography ---- */
  if (intent.typography) {
    const stacks: Record<string, string> = {
      ROUNDED: "\"Segoe UI Variable Display\", \"SF Pro Rounded\", \"Nunito\", \"Microsoft YaHei UI\", sans-serif",
      MONO: "\"Cascadia Mono\", \"JetBrains Mono\", Consolas, monospace",
      SERIF: "Georgia, \"Songti SC\", \"Noto Serif\", serif",
      SANS: "Inter, \"Segoe UI Variable\", \"Microsoft YaHei UI\", sans-serif",
      FOLLOW_BASE: tokens["--boss-font-family"] ?? "Inter, sans-serif"
    };
    record("--boss-font-family", stacks[intent.typography.value], "TYPOGRAPHY", `typography ${intent.typography.value.toLowerCase()} (${intent.typography.evidence})`);
  }

  /* ---- 7. contrast preference + readability repair ---- */
  if (intent.contrast?.value === "HIGH") {
    const text = toHsl(tokens["--boss-text-primary"] ?? "#e8e9e6");
    if (text) record("--boss-text-primary", fromHsl({ ...text, l: text.l > 0.5 ? Math.min(0.99, text.l + 0.08) : Math.max(0.01, text.l - 0.08) }), "CONTRAST_PREFERENCE", "user asked for higher contrast");
  }
  if (intent.contrast?.value === "SUBTLE") {
    const text = toHsl(tokens["--boss-text-primary"] ?? "#e8e9e6");
    if (text) record("--boss-text-primary", fromHsl({ ...text, l: text.l > 0.5 ? Math.max(0.55, text.l - 0.12) : Math.min(0.45, text.l + 0.12) }), "CONTRAST_PREFERENCE", "user asked for a softer look");
  }
  // §20 runs after generation: a style shift must never ship unreadable text.
  for (const background of ["--boss-bg-root", "--boss-bg-surface", "--boss-bg-elevated"]) {
    const against = tokens[background];
    if (!against) continue;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const text = toHsl(tokens["--boss-text-primary"] ?? "");
      if (!text) break;
      const ratio = contrastRatio(tokens["--boss-text-primary"], against) ?? 21;
      if (ratio >= 4.5) break;
      const darker = (toHsl(against)?.l ?? 0.5) > 0.5;
      const next = { ...text, l: darker ? Math.max(0.02, text.l - 0.06) : Math.min(0.99, text.l + 0.06) };
      record("--boss-text-primary", fromHsl(next), "READABILITY_REPAIR", `raised contrast against ${background} from ${ratio.toFixed(2)}:1`);
      repairs.push(`${background}: ${ratio.toFixed(2)}:1 → ${(contrastRatio(tokens["--boss-text-primary"], against) ?? 0).toFixed(2)}:1`);
    }
  }

  /* ---- 8. surface overrides, restricted to the §9 contract ---- */
  const overrides: ThemeSurfaceOverride[] = [];
  const pushOverride = (surface: string, property: string, value: string, rule: string): void => {
    const contract = surfaceById(surface, contracts);
    if (!contract) return;
    if (!contract.allowedProperties.map((item) => item.toLowerCase()).includes(property.toLowerCase())) return;
    overrides.push({ surface: contract.id, property, value });
    decisions.push({ token: `${contract.id}.${property}`, value, rule, evidence: `override allowed by the §9.1 contract of ${contract.id}` });
  };
  if (intent.translucency?.value.enabled) {
    pushOverride("TOP_NAV", "background-color", tokens["--boss-bg-elevated"] ?? "transparent", "TRANSLUCENCY_BINDING");
    pushOverride("SIDEBAR", "background-color", tokens["--boss-bg-surface"] ?? "transparent", "TRANSLUCENCY_BINDING");
  }
  if (intent.radius) {
    pushOverride("CARD", "border-radius", tokens["--boss-radius"] ?? "12px", "RADIUS_BINDING");
    pushOverride("INPUT", "border-radius", tokens["--boss-radius-sm"] ?? "8px", "RADIUS_BINDING");
  }
  if (intent.accent || namedTone || (intent.temperature && intent.temperature.value !== "NEUTRAL")) {
    pushOverride("ACCENT", "background-color", tokens["--boss-accent"] ?? "#88ccff", "ACCENT_BINDING");
  }
  // Deduplicate while keeping the deterministic order.
  const unique = overrides.filter((entry, index) => overrides.findIndex((other) => other.surface === entry.surface && other.property === entry.property) === index);

  /* ---- 9. completeness: never ship a token the contract requires but lost ---- */
  for (const token of Object.keys(base.tokens)) if (!knownToken(token) && !token.startsWith("--boss-")) delete tokens[token];

  const pkg: ThemePackage = {
    manifest: {
      schemaVersion: 1,
      id: input.id,
      name: input.name,
      type: "CUSTOM",
      version: "1.0.0",
      description: describeIntent(intent),
      createdAt: input.now,
      updatedAt: input.now,
      builtIn: false,
      deletable: true
    },
    tokens,
    overrides: unique,
    metadata: {
      schemaVersion: 1,
      createdBy: "GENERATED",
      notes: [
        `generator ${THEME_GENERATOR_VERSION}`,
        `intent: ${describeIntent(intent)}`,
        input.captureSummary ? `capture: ${input.captureSummary}` : "capture: not recorded",
        `draft hash basis: ${contentHashOf([input.id, describeIntent(intent), input.now].join("\u0000")).slice(0, 16)}`
      ]
    }
  };
  return { pkg, decisions, repairs, interpretation: describeIntent(intent), generator: THEME_GENERATOR_VERSION };
}
