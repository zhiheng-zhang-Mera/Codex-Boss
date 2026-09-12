/**
 * checkpoint-1 §9/§9.1/§10 — UI surface contracts, tokens and fail-closed
 * override validation, plus the honesty rules of the discovery extractor.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { UI_SURFACE_IDS } from "../../src/shared/ui-surface-ids";
import {
  UI_TOKEN_GROUPS,
  UI_TOKEN_NAMES,
  defaultSurfaceContracts,
  knownToken,
  surfaceById,
  summarizeUISurfaceRegistry,
  tokenGroupOf,
  validateSurfaceOverride,
  validateUISurfaceRegistry,
  type UISurfaceRegistry
} from "../../src/shared/ui-surface";
import { discoverUISurfaces, observedClassNames } from "../../electron/engineering/ui-surface-discovery";
import { buildWorldModel } from "../../electron/engineering/world-model";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-ui-surface-"));

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
});

describe("§9 surface vocabulary", () => {
  it("covers every surface the plan lists, exactly once", () => {
    const contracts = defaultSurfaceContracts();
    expect(contracts.map((contract) => contract.id)).toEqual([...UI_SURFACE_IDS]);
    expect(new Set(contracts.map((contract) => contract.id)).size).toBe(UI_SURFACE_IDS.length);
  });

  it("gives every surface allowed properties, default tokens and a fallback", () => {
    for (const contract of defaultSurfaceContracts()) {
      expect(contract.allowedProperties.length, contract.id).toBeGreaterThan(0);
      expect(contract.defaultTokens.length, contract.id).toBeGreaterThan(0);
      expect(contract.fallback.note.length, contract.id).toBeGreaterThan(0);
      for (const token of contract.defaultTokens) expect(knownToken(token), `${contract.id} → ${token}`).toBe(true);
    }
  });

  it("keeps §10 token groups addressable", () => {
    expect(tokenGroupOf("--boss-accent")).toBe("color");
    expect(tokenGroupOf("--boss-radius")).toBe("shape");
    expect(tokenGroupOf("--boss-blur")).toBe("effect");
    expect(UI_TOKEN_NAMES).toContain("--boss-spacing-density");
    expect(Object.keys(UI_TOKEN_GROUPS).sort()).toEqual(["color", "density", "effect", "shape", "typography"]);
  });
});

describe("§9.1/§20 fail-closed override validation", () => {
  it("accepts an allowed property with a literal or a declared token", () => {
    expect(validateSurfaceOverride({ surface: "SIDEBAR", property: "background-color", value: "#101418" }).ok).toBe(true);
    expect(validateSurfaceOverride({ surface: "SIDEBAR", property: "background-color", value: "var(--boss-bg-surface)" }).ok).toBe(true);
  });

  it("rejects an unknown surface", () => {
    const verdict = validateSurfaceOverride({ surface: "RANDOM_DIV", property: "color", value: "#fff" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("UNKNOWN_SURFACE");
  });

  it("rejects a property the surface does not allow", () => {
    const verdict = validateSurfaceOverride({ surface: "SIDEBAR", property: "position", value: "fixed" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("UNKNOWN_PROPERTY");
  });

  it("rejects an undeclared token reference", () => {
    const verdict = validateSurfaceOverride({ surface: "SIDEBAR", property: "background-color", value: "var(--boss-invented-token)" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("UNKNOWN_TOKEN");
  });

  it("rejects unsafe values", () => {
    for (const value of ["url(https://evil.example/x.png)", "javascript:alert(1)", "expression(alert(1))", "@import url(x)"]) {
      const verdict = validateSurfaceOverride({ surface: "APP_BACKGROUND", property: "background-image", value });
      expect(verdict.ok, value).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe("UNSAFE_VALUE");
    }
  });

  it("rejects an empty value", () => {
    const verdict = validateSurfaceOverride({ surface: "ACCENT", property: "color", value: "   " });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("EMPTY_VALUE");
  });

  it("exposes the contract for a surface by id", () => {
    expect(surfaceById("CODE_PANEL")?.category).toBe("CONTENT");
    expect(surfaceById("NOPE")).toBeUndefined();
  });
});

describe("§9 discovery honesty", () => {
  it("treats stylesheet classes as selectors and code classes as className literals only", () => {
    const style = observedClassNames(".sidebar { color: red; }\n.foo.bar { color: blue; }\ntransition: .2s ease;", "STYLE");
    expect(style.has("sidebar")).toBe(true);
    expect(style.has("foo")).toBe(true);
    expect(style.has("2s")).toBe(false);
    const code = observedClassNames("const x = document.body; model.root; el.className = \"card wide\";", "CODE");
    expect(code.has("body")).toBe(false);
    expect(code.has("root")).toBe(false);
    expect(code.has("card")).toBe(true);
    expect(code.has("wide")).toBe(true);
    const markup = observedClassNames("<div class=\"pane active\"></div>", "MARKUP");
    expect(markup.has("pane")).toBe(true);
    expect(markup.has("active")).toBe(true);
  });

  it("only binds a surface to classes that really exist, and reports the rest as unbound", () => {
    const workspace = path.join(ROOT, "app");
    fs.mkdirSync(path.join(workspace, "src", "renderer", "components"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "ui-fixture", private: true }), "utf8");
    fs.writeFileSync(path.join(workspace, "src", "renderer", "styles.css"), [
      ".desktop-shell { background: #000; }",
      ".history-sidebar { border-right: 1px solid #222; }",
      ".composer-footer button { color: #fff; }",
      "::-webkit-scrollbar { width: 8px; }"
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(workspace, "src", "renderer", "main.tsx"), "export const App = () => <div className=\"desktop-shell provider-choice\" />;\n", "utf8");

    const model = buildWorldModel(workspace);
    const discovery = discoverUISurfaces(model);
    const sidebar = discovery.registry.contracts.find((contract) => contract.id === "SIDEBAR");
    const accent = discovery.registry.contracts.find((contract) => contract.id === "ACCENT");
    expect(sidebar?.componentBindings.map((binding) => binding.value)).toContain(".history-sidebar");
    expect(sidebar?.componentBindings.every((binding) => binding.evidence.includes(".history-sidebar"))).toBe(true);
    // ACCENT has no matching class in this fixture, so it must be reported unbound.
    expect(accent?.componentBindings).toEqual([]);
    expect(discovery.registry.unbound).toContain("ACCENT");
    const scrollbar = discovery.registry.contracts.find((contract) => contract.id === "SCROLLBAR");
    expect(scrollbar?.componentBindings[0]).toMatchObject({ kind: "css-selector", value: "::-webkit-scrollbar" });
    expect(discovery.validation.ok).toBe(true);
  });

  it("reports a registry whose contracts contradict themselves as invalid", () => {
    const registry: UISurfaceRegistry = {
      schemaVersion: 1,
      version: "ui-surface-registry-1",
      generated_at: "2026-01-01T00:00:00.000Z",
      root: "/repo",
      contracts: defaultSurfaceContracts().slice(0, 3),
      unbound: [],
      tokens: [],
      tokens_applied: false,
      style_files: [],
      component_files: []
    };
    const validation = validateUISurfaceRegistry(registry);
    expect(validation.ok).toBe(false);
    expect(validation.problems.some((problem) => problem.includes("has no contract"))).toBe(true);
  });

  it("summarizes the registry for a durable task record", () => {
    const registry: UISurfaceRegistry = {
      schemaVersion: 1,
      version: "ui-surface-registry-1",
      generated_at: "2026-01-01T00:00:00.000Z",
      root: "/repo",
      contracts: defaultSurfaceContracts(),
      unbound: ["SCROLLBAR"],
      tokens: [{ name: "--boss-accent", group: "color", declared: false, evidence: [] }],
      tokens_applied: false,
      style_files: ["src/renderer/styles.css"],
      component_files: ["src/renderer/main.tsx"]
    };
    const summary = summarizeUISurfaceRegistry(registry);
    expect(summary.surfaces).toBe(UI_SURFACE_IDS.length);
    expect(summary.bound).toBe(0);
    expect(summary.unbound).toEqual(["SCROLLBAR"]);
    expect(summary.tokens_declared).toBe(0);
    expect(summary.tokens_applied).toBe(false);
  });
});
