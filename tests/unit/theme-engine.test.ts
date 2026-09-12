/**
 * checkpoint-1 §10–§13, §20–§22 — theme package, validator and lifecycle.
 *
 * These cases pin the rules the plan states: every §20 check fires, a built-in is
 * locked and never exempt from validation, an invalid theme can never become
 * active, deletion follows the §22 order, and a theme is a self-contained package
 * so removing one can never break another.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ThemeService } from "../../electron/theme/theme-service";
import { builtInPackages, isBuiltInThemeId } from "../../electron/theme/builtin-themes";
import { ThemeStorage } from "../../electron/theme/theme-storage";
import { defaultSurfaceContracts } from "../../src/shared/ui-surface";
import {
  REQUIRED_THEME_TOKENS,
  THEME_SCHEMA_VERSION,
  contrastRatio,
  findTokenCycle,
  parseColour,
  planActivation,
  planThemeDeletion,
  renderThemeCss,
  themePackageHash,
  validateThemePackage,
  type ThemePackage,
  type ThemeRecord
} from "../../src/shared/theme";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-theme-"));
const CONTRACTS = defaultSurfaceContracts();

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
});

let counter = 0;
function newService(): ThemeService {
  counter += 1;
  const directory = path.join(ROOT, `svc-${counter}`);
  return new ThemeService({ root: path.join(directory, "themes"), registryFile: path.join(directory, "themes.json"), now: () => "2026-01-01T00:00:00.000Z" });
}

function customPackage(overrides: Partial<ThemePackage> = {}): ThemePackage {
  const dark = builtInPackages()[0];
  return {
    manifest: {
      schemaVersion: THEME_SCHEMA_VERSION,
      id: "custom-test",
      name: "Test Theme",
      type: "CUSTOM",
      version: "1.0.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      builtIn: false,
      deletable: true
    },
    tokens: { ...dark.tokens, "--boss-accent": "#ff8800" },
    overrides: [{ surface: "SIDEBAR", property: "background-color", value: "#101010" }],
    metadata: { schemaVersion: THEME_SCHEMA_VERSION, createdBy: "GENERATED", notes: [] },
    ...overrides
  };
}

function rulesOf(report: ReturnType<typeof validateThemePackage>): string[] {
  return [...new Set(report.diagnostics.map((entry) => `${entry.rule}:${entry.severity}`))].sort();
}

describe("§20 theme validator", () => {
  it("accepts both shipped built-ins with no errors", () => {
    for (const pkg of builtInPackages()) {
      const report = validateThemePackage(pkg, CONTRACTS, { now: "2026-01-01T00:00:00.000Z" });
      expect(report.ok, `${pkg.manifest.id}: ${JSON.stringify(report.diagnostics)}`).toBe(true);
      expect(report.state).toBe("VALIDATING");
      expect(report.contrast.length).toBeGreaterThan(0);
      expect(report.contrast.every((entry) => entry.ok), pkg.manifest.id).toBe(true);
    }
  });

  it("accepts a well-formed custom package", () => {
    const report = validateThemePackage(customPackage(), CONTRACTS);
    expect(report.ok).toBe(true);
    expect(report.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a broken schema", () => {
    const pkg = customPackage();
    const broken: ThemePackage = { ...pkg, manifest: { ...pkg.manifest, id: "Bad Id!", version: "one", builtIn: true, deletable: true } };
    expect(rulesOf(validateThemePackage(broken, CONTRACTS))).toContain("SCHEMA:ERROR");
  });

  it("rejects missing required tokens and unknown tokens", () => {
    const missing = customPackage({ tokens: { "--boss-bg-root": "#000" } });
    expect(rulesOf(validateThemePackage(missing, CONTRACTS))).toContain("REQUIRED_TOKENS:ERROR");
    const unknown = customPackage();
    unknown.tokens = { ...unknown.tokens, "--boss-invented": "#fff" };
    expect(rulesOf(validateThemePackage(unknown, CONTRACTS))).toContain("UNKNOWN_TOKEN:ERROR");
    const notBoss = customPackage();
    notBoss.tokens = { ...notBoss.tokens, "--other-token": "#fff" };
    expect(rulesOf(validateThemePackage(notBoss, CONTRACTS))).toContain("UNKNOWN_TOKEN:ERROR");
  });

  it("rejects an unsupported property, a locked surface and a layout override", () => {
    const property = customPackage({ overrides: [{ surface: "WORKSPACE_PANEL", property: "position", value: "fixed" }] });
    expect(rulesOf(validateThemePackage(property, CONTRACTS))).toEqual(expect.arrayContaining(["UNSUPPORTED_PROPERTY:ERROR", "LAYOUT_OVERFLOW:ERROR"]));
    const unknownSurface = customPackage({ overrides: [{ surface: "NOT_A_SURFACE" as never, property: "color", value: "#fff" }] });
    expect(rulesOf(validateThemePackage(unknownSurface, CONTRACTS))).toContain("UNSUPPORTED_PROPERTY:ERROR");
  });

  it("rejects broken var() references and token cycles", () => {
    const brokenTokens = { ...customPackage().tokens, "--boss-accent": "var(--boss-nope)" };
    expect(rulesOf(validateThemePackage(customPackage({ tokens: brokenTokens }), CONTRACTS))).toContain("BROKEN_REFERENCE:ERROR");
    const cyclic = { ...customPackage().tokens, "--boss-accent": "var(--boss-bg-muted)", "--boss-bg-muted": "var(--boss-accent)" };
    const report = validateThemePackage(customPackage({ tokens: cyclic }), CONTRACTS);
    expect(rulesOf(report)).toContain("TOKEN_CYCLE:ERROR");
    expect(findTokenCycle(cyclic).length).toBeGreaterThan(0);
  });

  it("rejects executable content, external imports and filesystem escapes", () => {
    for (const css of ["body { background: url(https://evil.example/x.png); }", "@import \"https://evil.example/x.css\";", "a { background: url(../../etc/passwd); }", "<script>alert(1)</script>", "a { width: expression(alert(1)); }"]) {
      const report = validateThemePackage(customPackage({ css }), CONTRACTS);
      expect(report.ok, css).toBe(false);
      expect(rulesOf(report).some((rule) => /SCRIPT_INJECTION|EXTERNAL_IMPORT|FILESYSTEM_ESCAPE/.test(rule)), css).toBe(true);
    }
  });

  it("rejects an unparsable stylesheet", () => {
    const report = validateThemePackage(customPackage({ css: ".a { color: red" }), CONTRACTS);
    expect(rulesOf(report)).toContain("INVALID_CSS:ERROR");
  });

  it("flags critical contrast as an error and lower contrast as a warning", () => {
    const unreadable = customPackage({ tokens: { ...customPackage().tokens, "--boss-text-primary": "#0d0d0d", "--boss-bg-root": "#0c0c0c" } });
    const report = validateThemePackage(unreadable, CONTRACTS);
    expect(report.ok).toBe(false);
    expect(report.diagnostics.some((entry) => entry.rule === "CRITICAL_CONTRAST" && entry.severity === "ERROR")).toBe(true);
    const subtle = customPackage({ tokens: { ...customPackage().tokens, "--boss-text-muted": "#4a4a4a" } });
    const subtleReport = validateThemePackage(subtle, CONTRACTS);
    expect(subtleReport.diagnostics.some((entry) => entry.rule === "CRITICAL_CONTRAST" && entry.severity === "WARN")).toBe(true);
    expect(subtleReport.ok).toBe(true);
  });

  it("measures contrast with WCAG luminance and refuses unparsable colours", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("var(--x)", "#000000")).toBeUndefined();
    expect(parseColour("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseColour("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseColour("tomato")).toBeUndefined();
  });

  it("detects a built-in whose bytes no longer match the shipped hash", () => {
    const pkg = builtInPackages()[0];
    const report = validateThemePackage(pkg, CONTRACTS, { expectedBuiltInHash: "0".repeat(64) });
    expect(rulesOf(report)).toContain("BUILT_IN_INTEGRITY:ERROR");
  });

  it("requires every declared token to be part of the shipped vocabulary", () => {
    const pkg = builtInPackages()[0];
    for (const token of REQUIRED_THEME_TOKENS) expect(pkg.tokens[token], token).toBeTruthy();
  });
});

describe("§9.1/§10 rendering", () => {
  it("renders tokens on :root and overrides against the observed surface bindings", () => {
    const contracts = defaultSurfaceContracts().map((contract) => contract.id === "SIDEBAR"
      ? { ...contract, componentBindings: [{ kind: "css-class" as const, value: ".history-sidebar", file: "src/renderer/styles.css", evidence: "class .history-sidebar observed" }] }
      : contract);
    const css = renderThemeCss({ tokens: { "--boss-accent": "#abc" }, overrides: [{ surface: "SIDEBAR", property: "background-color", value: "#101010" }] }, contracts);
    expect(css).toContain(":root {");
    expect(css).toContain("--boss-accent: #abc;");
    expect(css).toContain(".history-sidebar { background-color: #101010; }");
  });

  it("emits nothing for a surface with no observed binding (never a guessed selector)", () => {
    const css = renderThemeCss({ tokens: {}, overrides: [{ surface: "SIDEBAR", property: "background-color", value: "#101010" }] }, defaultSurfaceContracts());
    expect(css).not.toContain("background-color");
  });
});

describe("§21/§22 activation and deletion plans", () => {
  const record = (overrides: Partial<ThemeRecord> = {}): ThemeRecord => ({
    id: "custom-x",
    name: "X",
    type: "CUSTOM",
    version: "1.0.0",
    builtIn: false,
    deletable: true,
    path: "custom-x",
    hash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    state: "INSTALLED",
    validation: { ok: true, state: "VALIDATING", diagnostics: [], contrast: [], checkedAt: "2026-01-01T00:00:00.000Z", hash: "a".repeat(64) },
    preview: false,
    ...overrides
  });

  it("falls back to the built-in default for a missing, invalid, quarantined or disabled theme", () => {
    expect(planActivation(undefined, { requestedId: "nope" }).fallbackThemeId).toBe("builtin-dark");
    expect(planActivation(record({ state: "INVALID" }), { requestedId: "custom-x" }).code).toBe("INVALID");
    expect(planActivation(record({ state: "QUARANTINED" }), { requestedId: "custom-x" }).code).toBe("QUARANTINED");
    expect(planActivation(record({ state: "DISABLED" }), { requestedId: "custom-x" }).code).toBe("DISABLED");
    const stale = record({ hash: "b".repeat(64) });
    expect(planActivation(stale, { requestedId: "custom-x" }).code).toBe("INVALID");
  });

  it("activates a validated record", () => {
    const plan = planActivation(record(), { requestedId: "custom-x" });
    expect(plan.ok).toBe(true);
    expect(plan.themeId).toBe("custom-x");
  });

  it("refuses to delete a built-in and orders a custom deletion correctly", () => {
    const builtIn = record({ id: "builtin-light", builtIn: true, deletable: false, type: "BUILT_IN" });
    expect(planThemeDeletion(builtIn, { activeThemeId: "builtin-light", remaining: [builtIn] }).code).toBe("BUILT_IN_LOCKED");
    const activePlan = planThemeDeletion(record(), { activeThemeId: "custom-x", remaining: [record(), builtIn] });
    expect(activePlan.ok).toBe(true);
    expect(activePlan.steps).toEqual(["VERIFY_NOT_BUILT_IN", "SWITCH_FALLBACK", "UNREGISTER", "DELETE_PACKAGE", "VALIDATE_REMAINING"]);
    expect(activePlan.fallbackThemeId).toBe("builtin-light");
    const inactivePlan = planThemeDeletion(record(), { activeThemeId: "builtin-dark", remaining: [record()] });
    expect(inactivePlan.steps).toContain("KEEP_ACTIVE");
    expect(inactivePlan.steps).not.toContain("SWITCH_FALLBACK");
  });
});

describe("§11/§12/§13 service lifecycle", () => {
  it("materializes and locks both built-ins on bootstrap", () => {
    const service = newService();
    const boot = service.bootstrap();
    expect(boot.activeThemeId).toBe("builtin-dark");
    expect(boot.fallback).toBe(false);
    const records = service.list();
    expect(records.map((entry) => entry.id)).toEqual(["builtin-dark", "builtin-light"]);
    expect(records.every((entry) => entry.builtIn && !entry.deletable && entry.validation?.ok)).toBe(true);
    expect(isBuiltInThemeId("builtin-light")).toBe(true);
    expect(fs.existsSync(path.join(service.root(), "builtin-dark", "theme.json"))).toBe(true);
    expect(fs.existsSync(path.join(service.root(), "builtin-light", "tokens.json"))).toBe(true);
  });

  it("refuses to delete a built-in and keeps the registry intact", () => {
    const service = newService();
    service.bootstrap();
    const result = service.delete("builtin-light");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("locked built-in");
    expect(service.list().map((entry) => entry.id)).toEqual(["builtin-dark", "builtin-light"]);
  });

  it("installs, activates, edits and deletes a custom theme with the §22 order", () => {
    const service = newService();
    service.bootstrap();
    const duplicate = service.duplicate("builtin-light", { id: "custom-paper", name: "Paper" });
    expect(duplicate.ok).toBe(true);
    expect(service.list().map((entry) => entry.id)).toContain("custom-paper");

    const activated = service.activate("custom-paper");
    expect(activated.ok).toBe(true);
    expect(activated.activeThemeId).toBe("custom-paper");
    expect(service.snapshot().tokens["--boss-bg-root"]).toBe("#f4f6f2");

    const edited = service.update("custom-paper", { tokens: { ...service.packageOf("custom-paper")!.tokens, "--boss-accent": "#123456" } });
    expect(edited.ok).toBe(true);
    expect(service.snapshot().tokens["--boss-accent"]).toBe("#123456");

    const deleted = service.delete("custom-paper");
    expect(deleted.ok).toBe(true);
    expect(deleted.fallback).toBe(true);
    expect(deleted.activeThemeId).toBe("builtin-dark");
    expect(service.list().map((entry) => entry.id)).toEqual(["builtin-dark", "builtin-light"]);
    expect(fs.existsSync(path.join(service.root(), "custom-paper"))).toBe(false);
  });

  it("quarantines an invalid package instead of activating it", () => {
    const service = newService();
    service.bootstrap();
    const bad = customPackage({ manifest: { ...customPackage().manifest, id: "custom-bad" }, tokens: { "--boss-bg-root": "#000" } });
    const result = service.install(bad);
    expect(result.ok).toBe(false);
    expect(result.state).toBe("QUARANTINED");
    const activation = service.activate("custom-bad");
    expect(activation.ok).toBe(false);
    expect(activation.activeThemeId).toBe("builtin-dark");
    expect(activation.fallback).toBe(true);
    expect(service.snapshot().fallback).toBe(true);
  });

  it("refuses a custom theme that collides with a built-in id", () => {
    const service = newService();
    service.bootstrap();
    const collision = customPackage({ manifest: { ...customPackage().manifest, id: "builtin-dark" } });
    const result = service.install(collision);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("collides with a built-in");
    expect(service.activeRecord()?.id).toBe("builtin-dark");
  });

  it("refuses an edit that would break the theme and keeps the last valid revision", () => {
    const service = newService();
    service.bootstrap();
    service.duplicate("builtin-dark", { id: "custom-keep", name: "Keep" });
    const before = service.snapshot();
    const broken = service.update("custom-keep", { tokens: { "--boss-bg-root": "#000" } });
    expect(broken.ok).toBe(false);
    expect(broken.reason).toContain("REQUIRED_TOKENS");
    if (before.activeThemeId === "custom-keep") expect(service.snapshot().tokens["--boss-bg-root"]).not.toBe("#000");
    expect(service.packageOf("custom-keep")!.tokens["--boss-bg-surface"]).toBeTruthy();
  });

  it("cannot edit or rename a built-in, and can rename a custom theme", () => {
    const service = newService();
    service.bootstrap();
    expect(service.update("builtin-dark", { tokens: {} }).ok).toBe(false);
    expect(service.rename("builtin-dark", "Other").ok).toBe(false);
    service.duplicate("builtin-dark", { id: "custom-name", name: "First" });
    const renamed = service.rename("custom-name", "Second");
    expect(renamed.ok).toBe(true);
    expect(service.list().find((entry) => entry.id === "custom-name")?.name).toBe("Second");
  });

  it("disabling the active custom theme switches to the built-in", () => {
    const service = newService();
    service.bootstrap();
    service.duplicate("builtin-light", { id: "custom-off", name: "Off" });
    service.activate("custom-off");
    const disabled = service.disable("custom-off");
    expect(disabled.ok).toBe(true);
    expect(disabled.activeThemeId).toBe("builtin-dark");
    expect(disabled.fallback).toBe(true);
    expect(service.list().find((entry) => entry.id === "custom-off")?.state).toBe("DISABLED");
  });

  it("survives a restart and quarantines a theme whose package disappeared", () => {
    const directory = path.join(ROOT, "restart");
    const options = { root: path.join(directory, "themes"), registryFile: path.join(directory, "themes.json"), now: () => "2026-01-01T00:00:00.000Z" };
    const first = new ThemeService(options);
    first.bootstrap();
    first.duplicate("builtin-light", { id: "custom-restart", name: "Restart" });
    first.activate("custom-restart");
    fs.rmSync(path.join(directory, "themes", "custom-restart"), { recursive: true, force: true });

    const second = new ThemeService(options);
    const boot = second.bootstrap();
    expect(boot.activeThemeId).toBe("builtin-dark");
    expect(boot.fallback).toBe(true);
    expect(second.list().find((entry) => entry.id === "custom-restart")?.state).toBe("QUARANTINED");
    expect(second.diagnostics().some((line) => line.includes("quarantined"))).toBe(true);
  });

  it("is a no-op for deleting an unknown theme", () => {
    const service = newService();
    service.bootstrap();
    expect(service.delete("custom-missing").ok).toBe(false);
  });
});

describe("§20 storage safety", () => {
  it("refuses a theme id that would escape the theme root", () => {
    const storage = new ThemeStorage(path.join(ROOT, "escape", "themes"));
    expect(() => storage.directoryFor("../outside")).toThrow(/invalid theme id/);
    expect(() => storage.directoryFor("custom/../../etc")).toThrow(/invalid theme id/);
    expect(storage.read("../outside")).toBeUndefined();
  });

  it("round-trips a package including its optional stylesheet", () => {
    const storage = new ThemeStorage(path.join(ROOT, "roundtrip", "themes"));
    const pkg = customPackage({ css: ".history-sidebar { opacity: 0.98; }" });
    const record = storage.write(pkg, { state: "INSTALLED", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(record.hash).toBe(themePackageHash(pkg));
    const read = storage.read("custom-test");
    expect(read?.tokens["--boss-accent"]).toBe("#ff8800");
    expect(read?.css).toContain("opacity");
    expect(storage.list()).toEqual(["custom-test"]);
    storage.remove("custom-test");
    expect(storage.exists("custom-test")).toBe(false);
  });
});
