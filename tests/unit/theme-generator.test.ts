/**
 * checkpoint-1 §14/§15/§19/§24/§26 — intent parsing, generation, visual check.
 *
 * The properties that matter: the parser explains every signal it used and never
 * silently turns a layout request into a theme; the generator is deterministic,
 * always produces a complete package and repairs unreadable text instead of
 * shipping it; the visual checker fails closed on what a user would actually see.
 */
import { describe, expect, it } from "vitest";
import { describeIntent, parseThemeIntent, requiresUiEngineering } from "../../src/shared/theme-intent";
import { fromHsl, generateThemeDraft, toHsl } from "../../src/shared/theme-generation";
import { checkThemeVisuals, DEFAULT_MAJOR_SURFACES, REQUIRED_CONTROL_IDS, type VisualCheckInput } from "../../src/shared/theme-visual-check";
import { validateThemePackage, type ThemePackage } from "../../src/shared/theme";
import { defaultSurfaceContracts } from "../../src/shared/ui-surface";
import { builtInPackages } from "../../electron/theme/builtin-themes";

const CONTRACTS = defaultSurfaceContracts();
const BASE = builtInPackages()[0];

function generate(prompt: string, base: Pick<ThemePackage, "tokens" | "overrides"> = { tokens: BASE.tokens, overrides: BASE.overrides }) {
  const intent = parseThemeIntent(prompt);
  return { intent, result: generateThemeDraft({ intent, base, contracts: CONTRACTS, id: "custom-test", name: "Test", now: "2026-01-01T00:00:00.000Z" }) };
}

function measurement(overrides: Partial<VisualCheckInput["surfaces"][number]> & { surface: VisualCheckInput["surfaces"][number]["surface"] }): VisualCheckInput["surfaces"][number] {
  return { present: true, visible: true, width: 400, height: 200, ...overrides };
}

describe("§14 theme intent parsing", () => {
  it("extracts reference, temperature, translucency, density and typography with evidence", () => {
    const intent = parseThemeIntent("做一个类似 macOS 风格、偏冷、半透明、紧凑一点的主题，字体用等宽");
    expect(intent.references.map((entry) => entry.value)).toContain("macOS");
    expect(intent.temperature?.value).toBe("COOL");
    expect(intent.temperature?.evidence).toBe("偏冷");
    expect(intent.translucency?.value.enabled).toBe(true);
    expect(intent.density?.value).toBe("COMPACT");
    expect(intent.typography?.value).toBe("MONO");
    expect(intent.usable).toBe(true);
    expect(intent.trace.length).toBeGreaterThan(3);
  });

  it("uses a named colour literally and a tone word as a direction", () => {
    expect(parseThemeIntent("强调色用 #22d3ee").accent?.value).toBe("#22d3ee");
    const tone = parseThemeIntent("整体偏青色");
    expect(tone.tones).toContain("teal");
    expect(tone.accent).toBeUndefined();
  });

  it("escalates layout and behaviour requests instead of theming them (§19)", () => {
    const move = parseThemeIntent("把侧栏挪到右边");
    expect(requiresUiEngineering(move)).toBe(true);
    expect(move.escalations[0].phrase).toBe("挪到");
    expect(move.usable).toBe(false);
    for (const prompt of ["删掉设置按钮", "新增一个导出面板", "改一下 IPC 逻辑", "重写这个页面"]) {
      const intent = parseThemeIntent(prompt);
      expect(requiresUiEngineering(intent), prompt).toBe(true);
    }
  });

  it("keeps a layout escalation separate from usable style signals", () => {
    const intent = parseThemeIntent("偏冷的主题，但把侧栏挪到右边");
    expect(intent.temperature?.value).toBe("COOL");
    expect(requiresUiEngineering(intent)).toBe(true);
  });

  it("inherits unchanged axes on a revision and adjusts the mentioned one", () => {
    const first = parseThemeIntent("macOS 风格、半透明、紧凑");
    const revised = parseThemeIntent("再透明一些", { previous: first });
    expect(revised.references.map((entry) => entry.value)).toContain("macOS");
    expect(revised.density?.value).toBe("COMPACT");
    expect(revised.translucency!.value.strength).toBeGreaterThan(first.translucency!.value.strength);
    const less = parseThemeIntent("不要那么透明", { previous: revised });
    expect(less.translucency!.value.strength).toBeLessThan(revised.translucency!.value.strength);
  });

  it("reports an unusable prompt honestly", () => {
    const intent = parseThemeIntent("帮我看看这个任务");
    expect(intent.usable).toBe(false);
    expect(intent.trace.join(" ")).toContain("no usable style signal");
    expect(describeIntent(intent)).toBe("no style signal");
  });

  it("records what the user asked to keep", () => {
    const intent = parseThemeIntent("偏冷一点，其余保持不变");
    expect(intent.preserve.length).toBeGreaterThan(0);
  });
});

describe("§15 theme generation", () => {
  it("is deterministic for the same intent and base", () => {
    const first = generate("偏冷、半透明、紧凑");
    const second = generate("偏冷、半透明、紧凑");
    expect(JSON.stringify(first.result.pkg.tokens)).toBe(JSON.stringify(second.result.pkg.tokens));
    expect(first.result.decisions.map((entry) => entry.token)).toEqual(second.result.decisions.map((entry) => entry.token));
  });

  it("refuses to generate without the current tokens or the contract table (§15)", () => {
    const intent = parseThemeIntent("偏冷");
    expect(() => generateThemeDraft({ intent, base: { tokens: {}, overrides: [] }, contracts: CONTRACTS, id: "x", name: "X", now: "2026-01-01T00:00:00.000Z" })).toThrow(/current theme's tokens/);
    expect(() => generateThemeDraft({ intent, base: { tokens: BASE.tokens, overrides: [] }, contracts: [], id: "x", name: "X", now: "2026-01-01T00:00:00.000Z" })).toThrow(/contract table/);
  });

  it("always produces a complete, self-contained, valid package", () => {
    for (const prompt of ["偏冷", "更亮一点", "高对比", "直角", "胶囊", "宽松", "衬线字体", "#ff8800", "macOS 玻璃感"]) {
      const { result } = generate(prompt);
      const report = validateThemePackage(result.pkg, CONTRACTS);
      expect(report.ok, `${prompt}: ${JSON.stringify(report.diagnostics)}`).toBe(true);
      expect(result.pkg.manifest.type).toBe("CUSTOM");
      expect(result.pkg.manifest.builtIn).toBe(false);
      expect(Object.keys(result.pkg.tokens).length).toBeGreaterThan(20);
    }
  });

  it("lays a readable ramp when the user asks for the other lightness", () => {
    const light = generate("浅色主题");
    expect(light.result.pkg.tokens["--boss-bg-root"]).not.toBe(BASE.tokens["--boss-bg-root"]);
    expect(validateThemePackage(light.result.pkg, CONTRACTS).ok).toBe(true);
    const contrast = validateThemePackage(light.result.pkg, CONTRACTS).contrast;
    expect(contrast.every((entry) => entry.ok)).toBe(true);
  });

  it("applies translucency to the layers that can afford it", () => {
    const { result } = generate("半透明");
    expect(result.pkg.tokens["--boss-blur"]).not.toBe(BASE.tokens["--boss-blur"]);
    expect(result.pkg.tokens["--boss-bg-root"]).toMatch(/^#[0-9a-f]{6}[0-9a-f]{2}$/i);
    const rootAlpha = Number.parseInt(result.pkg.tokens["--boss-bg-root"].slice(-2), 16);
    const surfaceAlpha = Number.parseInt(result.pkg.tokens["--boss-bg-surface"].slice(-2), 16);
    expect(rootAlpha).toBeGreaterThan(surfaceAlpha);
  });

  it("scales density and radius from the intent", () => {
    const compact = generate("紧凑");
    const spacious = generate("宽松");
    expect(Number.parseInt(compact.result.pkg.tokens["--boss-space-1"], 10)).toBeLessThan(Number.parseInt(spacious.result.pkg.tokens["--boss-space-1"], 10));
    const rounded = generate("圆角更大");
    const sharp = generate("直角");
    expect(rounded.result.pkg.tokens["--boss-radius"]).toBe("16px");
    expect(sharp.result.pkg.tokens["--boss-radius"]).toBe("2px");
  });

  it("uses a named accent literally and only emits allowed surface overrides", () => {
    const { result } = generate("#22d3ee，圆角更大，半透明");
    expect(result.pkg.tokens["--boss-accent"]).toBe("#22d3ee");
    for (const override of result.pkg.overrides) {
      const contract = CONTRACTS.find((entry) => entry.id === override.surface);
      expect(contract, override.surface).toBeDefined();
      expect(contract!.allowedProperties).toContain(override.property);
    }
  });

  it("repairs unreadable text instead of shipping it", () => {
    // A base whose text nearly matches its background: the generator must fix it.
    const broken: Pick<ThemePackage, "tokens" | "overrides"> = { tokens: { ...BASE.tokens, "--boss-text-primary": "#101010", "--boss-bg-root": "#0c0e10", "--boss-bg-surface": "#111315", "--boss-bg-elevated": "#141719" }, overrides: [] };
    const { result } = generate("更亮一点", broken);
    expect(result.repairs.length).toBeGreaterThan(0);
    const report = validateThemePackage(result.pkg, CONTRACTS);
    expect(report.ok).toBe(true);
    expect(report.contrast.filter((entry) => entry.required >= 3).every((entry) => entry.ok)).toBe(true);
  });

  it("explains every token it changed", () => {
    const { result } = generate("偏冷、紧凑、圆角更大");
    expect(result.decisions.length).toBeGreaterThan(5);
    for (const decision of result.decisions) {
      expect(decision.token.length).toBeGreaterThan(3);
      expect(decision.rule).toMatch(/^[A-Z_]+$/);
      expect(decision.evidence.length).toBeGreaterThan(0);
    }
    expect(result.interpretation).toContain("temperature");
  });

  it("round-trips HSL without losing the colour", () => {
    for (const value of ["#0c0e10", "#22d3ee", "#ffffff", "#000000"]) {
      expect(fromHsl(toHsl(value)!)).toBe(value);
    }
    expect(fromHsl({ h: 0, s: 0, l: 0.5 })).toBe("#808080");
  });
});

describe("§26 visual regression", () => {
  const base = (overrides: Partial<VisualCheckInput> = {}): VisualCheckInput => ({
    themeId: "custom-x",
    surfaces: DEFAULT_MAJOR_SURFACES.map((surface) => measurement({ surface })),
    controls: REQUIRED_CONTROL_IDS.map((id) => ({ id, present: true, visible: true, enabled: true, width: 40, height: 24 })),
    viewport: { width: 1440, height: 900, scrollWidth: 1440, scrollHeight: 900 },
    ...overrides
  });

  it("passes a healthy theme", () => {
    const report = checkThemeVisuals(base());
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("fails when a major surface disappears", () => {
    const report = checkThemeVisuals(base({ surfaces: [measurement({ surface: "APP_BACKGROUND", present: false, visible: false, width: 0, height: 0 })] }));
    expect(report.ok).toBe(false);
    expect(report.findings.some((entry) => entry.rule === "MAJOR_SURFACE_VISIBLE")).toBe(true);
  });

  it("measures text contrast and fails on unreadable text", () => {
    const surfaces = [...base().surfaces, measurement({ surface: "TEXT_PRIMARY", color: "#111111", background: "#0f0f0f" })];
    const report = checkThemeVisuals(base({ surfaces }));
    expect(report.ok).toBe(false);
    expect(report.contrast[0].ratio).toBeLessThan(1.5);
    expect(report.findings.some((entry) => entry.rule === "TEXT_READABLE" && entry.severity === "ERROR")).toBe(true);
  });

  it("fails when a required control is missing or unusable", () => {
    const report = checkThemeVisuals(base({ controls: [{ id: "composer", present: false, visible: false, enabled: false, width: 0, height: 0 }] }));
    expect(report.ok).toBe(false);
    expect(report.findings.filter((entry) => entry.rule === "CONTROLS_VISIBLE").length).toBeGreaterThan(1);
  });

  it("catches a collapsed sidebar, a collapsed modal, an unscrollable panel and catastrophic overflow", () => {
    const surfaces = [
      ...base().surfaces,
      measurement({ surface: "SIDEBAR", width: 40, height: 80 }),
      measurement({ surface: "MODAL", width: 120, height: 100 }),
      measurement({ surface: "CODE_PANEL", overflowY: true, scrollable: false })
    ];
    const report = checkThemeVisuals(base({ surfaces, viewport: { width: 1000, height: 800, scrollWidth: 1400, scrollHeight: 800 } }));
    const rules = report.findings.map((entry) => entry.rule);
    expect(rules).toContain("SIDEBAR_USABLE");
    expect(rules).toContain("MODAL_USABLE");
    expect(rules).toContain("SCROLLING_USABLE");
    expect(rules).toContain("NO_CATASTROPHIC_OVERFLOW");
    expect(report.findings.find((entry) => entry.rule === "NO_CATASTROPHIC_OVERFLOW")?.severity).toBe("ERROR");
  });

  it("catches a transparent-on-transparent failure", () => {
    const surfaces = [...base().surfaces, measurement({ surface: "SURFACE_PRIMARY", transparentOverTransparent: true })];
    const report = checkThemeVisuals(base({ surfaces }));
    expect(report.ok).toBe(false);
    expect(report.findings.some((entry) => entry.rule === "NO_TRANSPARENT_ON_TRANSPARENT")).toBe(true);
  });

  it("warns rather than fails on a small overflow", () => {
    const report = checkThemeVisuals(base({ viewport: { width: 1000, height: 800, scrollWidth: 1040, scrollHeight: 800 } }));
    const finding = report.findings.find((entry) => entry.rule === "NO_CATASTROPHIC_OVERFLOW");
    expect(finding?.severity).toBe("WARN");
    expect(report.ok).toBe(true);
  });
});
